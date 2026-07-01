import { Listr } from "listr2";
import { flushCapturedLog } from "./log.js";
const immediateReporter = { managed: false, flush: flushCapturedLog };
export class PlanExecutionError extends Error {
    completed;
    failures;
    constructor(message, completed, failures) {
        super(message);
        this.name = "PlanExecutionError";
        this.completed = completed;
        this.failures = failures;
    }
}
function failureMessage(prefix, failures) {
    const first = failures[0];
    if (first instanceof Error && first.message)
        return `${prefix}: ${first.message}`;
    if (first !== undefined)
        return `${prefix}: ${String(first)}`;
    return prefix;
}
export function sequence(items) {
    return { __wtenvPlanGroup: true, mode: "sequence", items };
}
export function parallel(items) {
    return { __wtenvPlanGroup: true, mode: "parallel", items };
}
export function isPlanGroup(node) {
    return (typeof node === "object" &&
        node !== null &&
        !Array.isArray(node) &&
        "__wtenvPlanGroup" in node &&
        node.__wtenvPlanGroup === true);
}
export function normalizePlan(plan) {
    if (isPlanGroup(plan))
        return plan;
    return sequence(Array.isArray(plan) ? plan : [plan]);
}
export function flattenPlan(plan) {
    const node = normalizePlan(plan);
    const flattened = [];
    for (const item of node.items) {
        if (isPlanGroup(item)) {
            flattened.push(...flattenPlan(item));
        }
        else {
            flattened.push(item);
        }
    }
    return flattened;
}
export function invertPlan(plan) {
    const node = normalizePlan(plan);
    if (node.mode === "parallel") {
        return parallel(node.items.map((item) => (isPlanGroup(item) ? invertPlan(item) : item)));
    }
    return sequence([...node.items].reverse().map((item) => (isPlanGroup(item) ? invertPlan(item) : item)));
}
export async function executePlan(plan, run, opts = {}) {
    const node = normalizePlan(plan);
    const completed = await executeNode(node, run, opts);
    return isPlanGroup(completed) ? completed : sequence(completed ? [completed] : []);
}
async function executeNode(node, run, opts) {
    if (!isPlanGroup(node)) {
        const result = await run(node, immediateReporter);
        return result === false ? undefined : node;
    }
    if (node.mode === "sequence") {
        const completed = [];
        for (const item of node.items) {
            try {
                const completedItem = await executeNode(item, run, opts);
                if (completedItem)
                    completed.push(completedItem);
            }
            catch (err) {
                if (err instanceof PlanExecutionError) {
                    if (err.completed.items.length > 0)
                        completed.push(err.completed);
                    const failures = [...err.failures];
                    throw new PlanExecutionError(failureMessage("Plan execution failed", failures), sequence(completed), failures);
                }
                throw new PlanExecutionError(failureMessage("Plan execution failed", [err]), sequence(completed), [err]);
            }
        }
        return sequence(completed);
    }
    // A parallel group whose direct children are all leaves is the common case
    // (a flat list of plugins, or a flat list of shell commands) and the one
    // that benefits from a spinner list — show progress instead of executing
    // silently until something finishes.
    if (opts.label && node.items.length > 0 && node.items.every((item) => !isPlanGroup(item))) {
        return executeParallelWithProgress(node.items, run, opts.label);
    }
    const settled = await Promise.allSettled(node.items.map((item) => executeNode(item, run, opts)));
    const completed = [];
    const failures = [];
    for (const result of settled) {
        if (result.status === "fulfilled") {
            if (result.value)
                completed.push(result.value);
        }
        else {
            const err = result.reason;
            if (err instanceof PlanExecutionError) {
                if (err.completed.items.length > 0)
                    completed.push(err.completed);
                failures.push(...err.failures);
            }
            else {
                failures.push(err);
            }
        }
    }
    if (failures.length > 0) {
        throw new PlanExecutionError(failureMessage("Parallel plan execution failed", failures), parallel(completed), failures);
    }
    return parallel(completed);
}
// Runs a flat parallel batch of leaf items behind a listr2 task list: each
// item's label IS its header line, ticking from a spinner to ✓/✗ as it
// settles, with its captured detail output appended directly beneath it —
// in place, as soon as that item finishes, not interleaved with still-running
// siblings. Falls back to plain sequential lines when stdout isn't a TTY.
async function executeParallelWithProgress(items, run, label) {
    // Indexed by original position, not completion order — matches the
    // declaration-order contract the rest of plan.ts keeps for `completed`.
    const succeeded = new Array(items.length).fill(false);
    const failures = [];
    const tasks = items.map((item, i) => ({
        title: label(item),
        rendererOptions: { persistentOutput: true, outputBar: Infinity },
        async task(_ctx, task) {
            let output;
            const reporter = {
                managed: true,
                flush(o) {
                    output = o;
                },
            };
            try {
                const result = await run(item, reporter);
                if (output)
                    task.output = output;
                succeeded[i] = result !== false;
            }
            catch (err) {
                if (output)
                    task.output = output;
                failures.push(err);
                throw err;
            }
        },
    }));
    await new Listr(tasks, {
        concurrent: true,
        exitOnError: false,
        // Keep the item's own label as the title on failure — the default
        // collapses it into the error message, losing which item failed.
        rendererOptions: { collapseErrors: false },
    }).run();
    const completed = items.filter((_, i) => succeeded[i]);
    if (failures.length > 0) {
        throw new PlanExecutionError(failureMessage("Parallel plan execution failed", failures), parallel(completed), failures);
    }
    return parallel(completed);
}
