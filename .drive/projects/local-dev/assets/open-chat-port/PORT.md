# What the open-chat port changed

The port repo (`open-chat`) is owned by a different user and was not
writable from the proving session, so the work happened on a full copy
(including `.git`) and produced one real commit there. This file is the
reviewable summary of that commit; the raw diff lives in the copy, not in
this repo.

One commit: **feat(composer): switch to `prisma-composer dev`, drop
`scripts/dev.ts`** — 10 files, +423/−621 (most of it `bun.lock` churn from
the dependency switch and the 169-line `scripts/dev.ts` deletion).

By file:

- `package.json` + `bun.lock` — point `@prisma/composer` and
  `@prisma/composer-prisma-cloud` at locally packed tarballs (`file:`
  deps plus `overrides`, so bun cannot resolve a stale nested copy of the
  published version). This is the "framework under test" mechanism; a
  published release would make it plain version bumps.
- `module.ts` + `src/composer/service.ts` — switch the chat service's
  build descriptor to `node()`'s directory form: ship `dist/` as a whole
  with entry `composer/start.js`, instead of a single bundled file.
- `src/composer/start.ts` — the launcher resolved its dynamic import of
  the app server against a source-tree-relative path that only worked
  when the file was never moved; it now resolves against its own runtime
  location. Also: the typed `StreamsClient` has no raw url/apiKey
  accessor, so the launcher reads those off the address-free env channel
  via the public `configKey()` helper.
- `prisma-composer.config.ts` — `state:` takes a state descriptor
  directly (`prismaState()`), not a thunk returning one; the port
  predated that API settling.
- `module.ts` (streams) — the streams module no longer takes a `secrets`
  option and the consumer needs no `streamsKey` slot: the bearer key
  rides the `durableStreams()` dependency automatically (ADR-0031).
- `scripts/dev.ts` — deleted (169 lines). Its replacement is the whole
  point: `prisma-composer dev module.ts`. The app's own fast hot-reload
  loop (`bun run dev`) is untouched.
- `.gitignore`, `README.md`, `FRICTION.md` — ignore
  `.prisma-composer/`/`.alchemy/`/`vendor/`, document the new dev
  command, port-side friction notes.

Every friction item hit on the way is in [FRICTION-S6.md](FRICTION-S6.md).
