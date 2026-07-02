/**
 * The provisioning surface of the control plane: lower a service's Loaded
 * graph onto the existing prisma-alchemy providers. Kept off the `.` entry so
 * authoring a service (`defineService`, `postgres`) never drags in Alchemy,
 * Effect, or the provider bundle.
 */
export { lower, toResourcePlan } from "../lower.ts";
export type { LowerOptions, ResourcePlan } from "../lower.ts";
