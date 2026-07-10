# Agent Rules Index

Curated rules for agents and developers — quick, actionable guidance.

## Canonical home & sync

Every rule has a single canonical home: `.agents/rules/<name>.mdc` — the only
git-tracked copy. Rule files must use the `.mdc` extension; the harnesses load
`.mdc` only, so a `.md` rule is silently dead (`pnpm lint:rules:symlinks`
rejects them). The `.cursor/rules/` and `.claude/rules/` trees are git-ignored
presentation mirrors containing nothing but relative symlinks back into
`.agents/rules/`.

```bash
pnpm rules:sync           # Consolidate stray rules + (re)generate the symlink trees
pnpm lint:rules:symlinks  # Fail if a tree is out of sync with canonical (runs in CI)
```

`rules:sync` also runs from `prepare`, so `pnpm install` rebuilds the trees
automatically. **Add or edit rules at the canonical path** (`.agents/rules/`);
a rule dropped only into `.cursor/rules` is git-ignored and will be lost.
