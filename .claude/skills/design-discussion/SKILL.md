---
name: design-discussion
description: Facilitate MakerKit design discussions and update docs/design (principles, domain docs) and add ADRs for decisions using the documented workflow and templates.
---

# Design discussion (MakerKit)

## When to use

Use this skill when the user is doing architecture/design work (domain modeling, bounded contexts, entrypoints, streaming model, control/execution planes) and wants to **record outcomes** in the design documentation system.

## Instructions

1. **Read-first**
   - `docs/design/README.md`
   - `docs/design/99-process/README.md`
   - Relevant docs in `docs/design/01-principles/`, `docs/design/10-domains/`, `docs/design/90-decisions/`

2. **Facilitate**
   - Ask 1–3 focused questions to resolve ambiguity.
   - Separate **exploration** from **decisions**.

3. **Record outcomes**
   - If it’s a long-lived constraint: update a principles doc.
   - If it refines boundaries/interfaces/invariants: update the relevant domain doc (or create one using the domain template).
   - If we “picked an answer”: create an ADR (short, specific) and link it from the relevant domain doc(s).

4. **Use templates**
   - Templates live in `docs/design/99-process/templates/`.

5. **DDD/Clean alignment checks**
   - Ensure glossary terms are consistent.
   - Ensure dependency direction is preserved (composition points vs primitives).
   - Ensure control-plane vs execution-plane responsibilities are explicitly captured where relevant.

## Outputs

- Updated or new docs under `docs/design/`
- Optional new ADR(s) under `docs/design/90-decisions/`
- Short summary of what changed and what remains open

