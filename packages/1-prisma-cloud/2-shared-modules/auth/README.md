# @internal/auth

Signup, login, sessions, and JWT verification as a composed module wrapping
[Better Auth](https://better-auth.com), published as
`@prisma/composer-prisma-cloud/auth`.

This package is under construction. What exists today:

- `./pack` — the `auth` contract space as a Prisma Next extension pack
  (`authPack`): the Better Auth tables (pinned `better-auth` version, plugins
  `jwt` + `bearer` + `admin` + `magicLink`) as an authored contract with
  shipped migrations. A consumer lists it in their `prisma-next.config.ts`
  and their normal migration step creates and evolves the auth tables beside
  their own.

The module factory, service, ports, and local-dev server land in subsequent
slices; the full README (contract scope, wiring, local dev) lands with them.
