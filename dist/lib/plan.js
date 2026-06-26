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
export async function executePlan(plan, run) {
    const node = normalizePlan(plan);
    const completed = await executeNode(node, run);
    return isPlanGroup(completed) ? completed : sequence(completed ? [completed] : []);
}
async function executeNode(node, run) {
    if (!isPlanGroup(node)) {
        const result = await run(node);
        return result === false ? undefined : node;
    }
    if (node.mode === "sequence") {
        const completed = [];
        for (const item of node.items) {
            try {
                const completedItem = await executeNode(item, run);
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
    const settled = await Promise.allSettled(node.items.map((item) => executeNode(item, run)));
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
