export type PlanMode = "sequence" | "parallel";
export interface PlanGroup<T> {
    __wtenvPlanGroup: true;
    mode: PlanMode;
    items: PlanNode<T>[];
}
export type PlanNode<T> = T | PlanGroup<T>;
export type PlanInput<T> = PlanNode<T> | PlanNode<T>[];
export interface PlanReporter {
    readonly managed: boolean;
    flush(output: string): void;
}
type PlanRunner<T> = (item: T, reporter: PlanReporter) => Promise<boolean | void> | boolean | void;
export interface ExecutePlanOptions<T> {
    label?: (item: T) => string;
}
export declare class PlanExecutionError<T> extends Error {
    completed: PlanGroup<T>;
    failures: unknown[];
    constructor(message: string, completed: PlanGroup<T>, failures: unknown[]);
}
export declare function sequence<T>(items: PlanNode<T>[]): PlanGroup<T>;
export declare function parallel<T>(items: PlanNode<T>[]): PlanGroup<T>;
export declare function isPlanGroup<T>(node: PlanInput<T>): node is PlanGroup<T>;
export declare function normalizePlan<T>(plan: PlanInput<T>): PlanGroup<T>;
export declare function flattenPlan<T>(plan: PlanInput<T>): T[];
export declare function invertPlan<T>(plan: PlanInput<T>): PlanGroup<T>;
export declare function executePlan<T>(plan: PlanInput<T>, run: PlanRunner<T>, opts?: ExecutePlanOptions<T>): Promise<PlanGroup<T>>;
export {};
