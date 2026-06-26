export type PlanMode = "sequence" | "parallel";

export interface PlanGroup<T> {
  __wtenvPlanGroup: true;
  mode: PlanMode;
  items: PlanNode<T>[];
}

export type PlanNode<T> = T | PlanGroup<T>;
export type PlanInput<T> = PlanNode<T> | PlanNode<T>[];

type PlanRunner<T> = (item: T) => Promise<boolean | void> | boolean | void;

export class PlanExecutionError<T> extends Error {
  completed: PlanGroup<T>;
  failures: unknown[];

  constructor(message: string, completed: PlanGroup<T>, failures: unknown[]) {
    super(message);
    this.name = "PlanExecutionError";
    this.completed = completed;
    this.failures = failures;
  }
}

function failureMessage(prefix: string, failures: unknown[]): string {
  const first = failures[0];
  if (first instanceof Error && first.message) return `${prefix}: ${first.message}`;
  if (first !== undefined) return `${prefix}: ${String(first)}`;
  return prefix;
}

export function sequence<T>(items: PlanNode<T>[]): PlanGroup<T> {
  return { __wtenvPlanGroup: true, mode: "sequence", items };
}

export function parallel<T>(items: PlanNode<T>[]): PlanGroup<T> {
  return { __wtenvPlanGroup: true, mode: "parallel", items };
}

export function isPlanGroup<T>(node: PlanInput<T>): node is PlanGroup<T> {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    "__wtenvPlanGroup" in node &&
    node.__wtenvPlanGroup === true
  );
}

export function normalizePlan<T>(plan: PlanInput<T>): PlanGroup<T> {
  if (isPlanGroup(plan)) return plan;
  return sequence(Array.isArray(plan) ? plan : [plan]);
}

export function flattenPlan<T>(plan: PlanInput<T>): T[] {
  const node = normalizePlan(plan);
  const flattened: T[] = [];
  for (const item of node.items) {
    if (isPlanGroup(item)) {
      flattened.push(...flattenPlan(item));
    } else {
      flattened.push(item);
    }
  }
  return flattened;
}

export function invertPlan<T>(plan: PlanInput<T>): PlanGroup<T> {
  const node = normalizePlan(plan);
  if (node.mode === "parallel") {
    return parallel(node.items.map((item) => (isPlanGroup(item) ? invertPlan(item) : item)));
  }
  return sequence(
    [...node.items].reverse().map((item) => (isPlanGroup(item) ? invertPlan(item) : item))
  );
}

export async function executePlan<T>(
  plan: PlanInput<T>,
  run: PlanRunner<T>
): Promise<PlanGroup<T>> {
  const node = normalizePlan(plan);
  const completed = await executeNode(node, run);
  return isPlanGroup(completed) ? completed : sequence(completed ? [completed] : []);
}

async function executeNode<T>(
  node: PlanNode<T>,
  run: PlanRunner<T>
): Promise<PlanNode<T> | undefined> {
  if (!isPlanGroup(node)) {
    const result = await run(node);
    return result === false ? undefined : node;
  }

  if (node.mode === "sequence") {
    const completed: PlanNode<T>[] = [];
    for (const item of node.items) {
      try {
        const completedItem = await executeNode(item, run);
        if (completedItem) completed.push(completedItem);
      } catch (err) {
        if (err instanceof PlanExecutionError) {
          if (err.completed.items.length > 0) completed.push(err.completed);
          const failures = [...err.failures];
          throw new PlanExecutionError(
            failureMessage("Plan execution failed", failures),
            sequence(completed),
            failures
          );
        }
        throw new PlanExecutionError(
          failureMessage("Plan execution failed", [err]),
          sequence(completed),
          [err]
        );
      }
    }
    return sequence(completed);
  }

  const settled = await Promise.allSettled(node.items.map((item) => executeNode(item, run)));
  const completed: PlanNode<T>[] = [];
  const failures: unknown[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      if (result.value) completed.push(result.value);
    } else {
      const err = result.reason;
      if (err instanceof PlanExecutionError) {
        if (err.completed.items.length > 0) completed.push(err.completed);
        failures.push(...err.failures);
      } else {
        failures.push(err);
      }
    }
  }

  if (failures.length > 0) {
    throw new PlanExecutionError(
      failureMessage("Parallel plan execution failed", failures),
      parallel(completed),
      failures
    );
  }

  return parallel(completed);
}
