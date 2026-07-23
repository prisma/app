/**
 * Bundling probe for barrel-invariants.test.ts: imports the authoring
 * barrel the way a consumer graph would, and re-exports enough that
 * nothing is tree-shaken away.
 */
export * from '../../exports/index.ts';
