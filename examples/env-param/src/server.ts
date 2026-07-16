// The app's own entrypoint (the build adapter's `entry`) — the pack-printed
// bootstrap dynamically imports this AFTER main.run(address, boot) has
// re-keyed the platform environment address-free, so service.config() below
// reads it directly, with no address.

import service from './service.ts';

const { greeting, port } = service.config();

// Bind all interfaces — Compute routes external HTTP to the VM, so a
// loopback-only listener would be unreachable.
Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch: () =>
    Response.json({
      // The live proof: the env-sourced param, read through config() at
      // runtime — schema-validated, unredacted.
      greeting,
    }),
});
