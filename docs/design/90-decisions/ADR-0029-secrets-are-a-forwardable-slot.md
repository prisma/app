# ADR-0029: Secrets are a forwardable slot

## Decision

A secret is its own kind of input slot — not a config param, not a service
dependency. A module declares that it *needs* a secret without naming where the
value comes from; the application that composes the module binds that need to a
real platform secret and forwards it in; the service reads the value back through
a wrapper that refuses to print itself. Here is the whole lifecycle — a reusable
auth module that needs a signing key:

```ts
// 1. The reusable module declares a nameless NEED. It never learns which
//    platform variable will feed it. (secret() is from @prisma/composer)
const auth = compute({
  name: 'auth',
  secrets: { signingKey: secret() },
  build: /* … */,
});

// 2. The application binds that need to a platform env var and provisions the
//    module. Only the app names the variable. (envSecret() is from the target,
//    @prisma/composer-prisma-cloud)
export default module('app', ({ provision }) => {
  provision(auth, { secrets: { signingKey: envSecret('AUTH_SIGNING_KEY') } });
});

// 3. Inside the service, the value reads back as a SecretBox — redacted unless
//    you explicitly ask for it.
const { signingKey } = auth.secrets();   // SecretBox<string>
sign(payload, signingKey.expose());      // expose() is the one deliberate reader
```

Everything else in this ADR is those three pieces:

- **`secret()` is the *need*** — a nameless slot a service or module declares.
  Because it carries no name, a module can forward its own need down into a child
  it provisions (`provision(child, { secrets: { key: ctx.secrets.key } })`),
  exactly the way it forwards an ordinary dependency input.
- **`envSecret('NAME')` is the *source*** — the value that satisfies a need,
  naming the platform variable to read. Only the application writes it, so the
  module underneath stays free of any platform name.
- **`secrets()` is the *read*** — a third accessor alongside `load()` (for
  dependencies) and `config()` (for params). It returns one `SecretBox<string>`
  per slot. A `SecretBox` prints `[REDACTED]` from every stringify path
  (`toString`, `toJSON`, `valueOf`, `inspect`), so a stray log or serialize can't
  leak it; `.expose()` is the single call that hands back the raw value.

**The framework carries the name, never the value.** At deploy, the service's
environment gets a *pointer* — the name of the platform variable, not its
contents:

```
COMPOSE_AUTH_SIGNINGKEY = "AUTH_SIGNING_KEY"
```

At boot the service does a two-step lookup: read that pointer to learn the
platform variable's name, then read that variable — which the platform injects
into the running instance — to get the actual value, and wrap it in a
`SecretBox`. So the secret's value never passes through the framework's own typed
config, the generated deploy program, deploy state, or a log line. Only its name
does, and a name is as safe to write and diff as any other key.

Before it provisions anything, **deploy preflight** checks that every bound name
exists on the platform for the target stage. A name that is missing there but
present in the deploy shell's own environment is pushed up with a single
write-only API call — it is never recorded as managed infrastructure, so even
then the value never lands in deploy state. A name missing from both places
fails the deploy early, with the list of what to set.

Finally, the **need lives in core and the source lives in the target**.
`secret()` and the `SecretSource` it is bound to are `@prisma/composer`; core
forwards a source around but treats it as opaque and never reads inside it. The
constructor that *builds* a source is the deploy target's: Prisma Cloud ships
`envSecret('NAME')`, which validates an env-var name and wraps it. A different
target could ship `vaultSecret({ path, key })` with no change to core. This is
the same declaration-versus-encoding split ADR-0018/0019 drew for config params,
applied to secrets.

## Reasoning

**Why a distinct slot, rather than a flag on a param.** The obvious shortcut is a
`secret: true` flag on an ordinary config value. But then *every* place that
touches config — logging, serialization, introspection, a new export added a year
from now — has to remember to check the flag and redact. Sensitivity that depends
on everyone remembering leaks eventually. Making a secret a different *kind* of
value, read back as a `SecretBox`, moves that guarantee into the type: the value
is redacted by default and `expose()` marks the one place code means to read it.

**Why names cross the boundary and values don't.** The deploy machine, the
generated deploy program, and deploy state are all things we inspect, diff, and
sometimes print — none of them was built to hold a secret safely. Rather than
teach each of them to guard a value, the framework simply never carries one; it
carries the platform variable's *name* and lets the platform inject the value
straight into the running instance. As a bonus, this is already the shape a
future secrets-manager integration wants: nothing to unwind, because nothing
downstream ever held the value.

**Why the module declares a need and the app binds it.** If a reusable auth
module hard-coded the variable name it reads, every application using it would be
forced onto that one name, and two apps could never give it different secrets.
Declaring a nameless need and letting the composing application bind it keeps the
module genuinely reusable — the same rail ordinary inputs already forward on, so
secrets needed no new composition machinery.

## Consequences

- Every generated key carries a reserved `COMPOSE_` prefix, so a framework-written
  key can never collide with — and silently overwrite — a variable the user
  provisioned themselves.
- Every wired secret is required. An "optional secret" would be a separate
  construct, not a setting on this one.
- Rotation is: change the value on the platform, then redeploy. That is the
  platform's own semantics — a running instance's environment is frozen when the
  instance is created — not something the framework adds.
- A secret slot and a service's own param may not share a name, because they would
  generate the same config key. A dependency may share a name freely, because its
  keys carry extra segments.

## Alternatives considered

- **A secret as a param facet, named at the service.** The service would carry the
  platform variable name itself. Rejected: that name can't be forwarded through
  composition, so a reusable module would have to hard-code it — the opposite of
  reusable.
- **A secret as an ordinary dependency.** Rejected: it would read back as a client
  through `load()`, and its sensitivity would ride on a flag rather than the type —
  the same remember-to-redact leak the distinct slot removes.
- **Sourcing the value from the deploy machine's environment as a default.**
  Rejected: it lands the actual value in deploy state, and gives no way to check
  the value is present before provisioning begins.
- **Unprefixed generated keys.** Rejected: a generated key could collide with a
  user-provisioned variable of the same name and overwrite it.

## Related

- [ADR-0016](ADR-0016-a-module-has-the-same-boundary-as-a-service.md) — the
  input-forwarding rail secrets ride on.
- [ADR-0019](ADR-0019-the-target-owns-config-serialization.md) — the
  declaration-versus-encoding split this applies to secrets.
- [ADR-0021](ADR-0021-params-are-read-through-config-not-load.md) — `load()`,
  `config()`, and `secrets()` as three separate read channels.
- [`../10-domains/config-params.md`](../10-domains/config-params.md) — the config
  model, with a secrets summary.
