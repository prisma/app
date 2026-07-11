# Design decisions — stage-as-branch slice

Numbered log of mid-flight decisions that amend the spec/plan. Each records the
trigger, what was learned, the decision, and the affected artefacts (Drive I12).

## 1. Branch idempotency is client-side; the API has no `ifExists` field

- **Trigger:** falsified assumption, found during D1 implementation. Spec §4 and plan
  D1 described creating a Branch "via `POST /v1/projects/:id/branches` (`ifExists:
  "return"`)" as if server-side create-or-return idempotency existed.
- **Learned:** it does not. Verified against `@prisma/management-api-sdk@1.47.0` (and
  the live OpenAPI): `POST /v1/projects/{projectId}/branches` accepts only `gitName` +
  `isDefault` (`additionalProperties: false`); a duplicate `gitName` returns `409`. The
  matching read, `GET …/branches?gitName=X`, **is** a real server-side exact-match
  filter returning ≤1 row.
- **Decision:** keep the spec's *outcome* (idempotent create-if-absent keyed by
  `gitName`) and implement idempotency client-side: observe via `GET ?gitName=`, `POST`
  only when absent, and on a racing `409` re-observe and adopt the winner. This mirrors
  the adopt-oldest/tolerate-races idiom already in `state/bootstrap.ts`. The mechanism
  changed; no architectural decision changed.
- **Affected:** spec §4 (rewritten), plan D1 (rewritten), `packages/alchemy/src/container.ts`
  (`resolveBranch`). Confirms spec §4's positional-role note: the API doc states the first
  Branch is `role=production`, later Branches `role=preview`, server-owned regardless of
  body — so explicit role control stays deferred.

## 2. Branch attachment is a PATCH, and ids are read at lowering time (not `PrismaCloudOptions`)

- **Trigger:** falsified assumption, found while grounding D3. Spec §6 said the `Database`/
  `ComputeService` **create bodies accept `branchId`**; spec §2/§7 said the ids arrive via a
  new `PrismaCloudOptions.projectId`/`fromEnv()`.
- **Learned (verified against `@prisma/management-api-sdk@1.47.0`):**
  1. `POST /v1/projects/:id/databases` create body has **no `branchId`** — a database is created
     project-scoped and **attached to a Branch by `PATCH /v1/databases/:id` with `{ branchId }`**.
     (`.../compute-services` create *does* accept `branchId`, but D3a uses the same PATCH mechanism
     for both providers for uniformity — a harmless extra idempotent call for compute. Corrected
     from an earlier claim that neither create body accepted it — the D3 Opus review caught it
     against SDK line 8628.) `EnvironmentVariable`'s create body accepts `branchId` + `class`
     directly. `Connection`/`Deployment` are not branch members (they inherit via their parent).
  2. There is no `fromEnv()`/`PrismaCloudOptions` id path today — the target reads env in
     `resolveOptions`. And the CLI evaluates `prismaCloud()` in the **parent** at config-load
     (before `ensureContainers` computes the ids), so `projectId` **cannot be required at
     construction** — it must be read at **lowering time** in `application.provision` (child
     only).
- **Decision:** (a) providers gain an optional `branchId`; when set they PATCH-attach the
  resource after observe-or-create on **every** reconcile (idempotent, self-healing); unset =
  no PATCH = current behavior. (b) `resolveOptions` reads `PRISMA_PROJECT_ID`/`PRISMA_BRANCH_ID`
  **without requiring them**; the required check for `projectId` lives in `application.provision`.
  No `PrismaCloudOptions` field is added (config-file override deferred). Outcome (branch-isolated
  resources + `class` mechanical) is unchanged; only the mechanism was mis-specified.
- **Affected:** spec §2/§5/§6/§7 (rewritten); plan D3 split into **D3a** (providers, `@prisma/
  alchemy`) → **D3b** (target, `@prisma/app-cloud`); `packages/alchemy/src/postgres/Database.ts`,
  `.../compute/ComputeService.ts`, `packages/app-cloud/src/control.ts`.

## 3. Compute-service create-then-PATCH collides with production on a live deploy

- **Trigger:** mid-flight obstacle, found on a real `prisma-app deploy --stage staging`.
- **Symptom:** the create step of `ComputeService.reconcile` failed outright:
  `compute_service:already_exists: An app named "auth" already exists on branch "main"`.
  The PATCH that was meant to attach the service to the staging Branch never ran — the
  preceding create was rejected.
- **Root cause:** decision #2 above put `ComputeService` on the same project-scoped
  create-then-PATCH mechanism as `Database`, treating the extra PATCH as "harmless." It
  is not harmless: compute-service names are unique **per Branch**, not per project. A
  project-scoped `POST /v1/projects/:id/compute-services` (no `branchId`) always lands on
  the project's default (`main`) Branch. If a same-named service already exists there —
  here, the production `auth` service — the create collides with it before the PATCH step
  is ever reached.
- **Decision:** `ComputeService` stops using PATCH. It passes `branchId` directly in the
  create body (`POST /v1/projects/:id/compute-services`, body `{ displayName, regionId?,
  branchId? }`), creating the service on the target Branch from the start — no collision,
  no PATCH. Re-verified the create body accepts `branchId`: SDK
  `postV1ProjectsByProjectIdCompute-services`, `index.d.ts:8628`. `Database` is unaffected
  and stays exactly as decision #2 (create body has no `branchId`, so it must stay
  create-then-PATCH) — this was verified working on the same live deploy.
- **Affected:** spec §6 (rewritten — providers no longer share one PATCH mechanism);
  `packages/alchemy/src/compute/ComputeService.ts` (`reconcile`, drops the PATCH branch);
  `packages/alchemy/src/__tests__/ComputeService.test.ts` (reconcile tests rewritten for
  create-body `branchId`, no PATCH).
