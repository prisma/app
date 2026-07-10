/**
 * Barrel for @prisma/app-assemble's consumers — @prisma/app-cli today, the future
 * programmatic deploy API second. Public surface: assembleServices() (the
 * orchestration), AssembleError (this package's own typed failure — no CLI
 * concepts leak through it), and the seams a caller substitutes in tests
 * (RunAssembler) or reuses for its own entry-anchored resolution
 * (importFromEntry — see resolve-from-entry.ts's doc comment for why the
 * CLI's pack-target seam reuses this instead of its own copy).
 */

export { AssembleError } from './assemble-error.ts';
export type { AssembledServices, RunAssembler } from './assemble-services.ts';
export { assembleServices } from './assemble-services.ts';
export { importFromEntry } from './resolve-from-entry.ts';
