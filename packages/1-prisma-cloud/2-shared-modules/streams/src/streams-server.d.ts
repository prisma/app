// @prisma/streams-server ships raw TypeScript compiled by Bun at runtime; it
// does not typecheck under this repo's compiler settings. The compute entry
// exports nothing we consume — shadow it so tsc stays out of their source.
// The bundler ignores this declaration and resolves the real files.
// WARNING: the shadow declares no members, so a TYPED import from /compute
// (or any other @prisma/streams-server/* subpath) fails typecheck — only the
// side-effect form `import '@prisma/streams-server/compute'` works.
declare module '@prisma/streams-server/compute' {}
