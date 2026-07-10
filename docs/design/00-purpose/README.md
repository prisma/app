# Purpose: what is the Prisma App Framework?

**The Prisma App Framework lets you write an application as connected components
and turns it into a running, deployed system — without wiring infrastructure by
hand.**

Each component — a **System** — owns its services and resources and exposes typed
**inputs and outputs**; you build a system by connecting one System's outputs to
another's inputs. The framework turns that model into the resources to provision,
Alchemy provisions them onto a deployment target, and targets like Prisma Cloud
plug in as extension packs.

## What the framework owns, and what it borrows

The framework's job is **composition** — the System model, the typed connections
between Systems, and the topology they produce. It borrows everything underneath
rather than reinventing it:

- **Alchemy** — the resource model and the provisioning engine.
- **Prisma Next** — data contracts, the interface to data resources.
- **Prisma Cloud** — hosting, as one deployment target (shipped as an extension pack).

## Read next

- [Goals](goals.md) — the concrete aims that deliver this purpose.
- [Guiding principles](../01-principles/guiding-principles.md) · [Architectural principles](../01-principles/architectural-principles.md).
- [Domain model](../03-domain-model/) — Systems, inputs/outputs, resources, the topology, and how it layers onto Alchemy and Prisma Cloud.
