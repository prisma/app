// Runtime bundle entry (app-owned): the driver import lives HERE.
import { runHost } from "@makerkit/core/runtime";
import { runtime } from "@makerkit/prisma-cloud/runtime";
import { SQL } from "bun";
import service from "./service.ts";

// A Prisma Postgres direct connection is closed when it goes idle (and when
// the service scales to zero). Bun.SQL surfaces that as an async error with
// no awaiter, which would otherwise crash the process into a 502 restart
// loop. Keep the process alive; the pool reconnects on the next query.
process.on("uncaughtException", (err) => console.error("uncaughtException", err));
process.on("unhandledRejection", (err) => console.error("unhandledRejection", err));

runHost(
  service,
  runtime({
    clients: {
      // One connection, closed client-side once idle (before the server drops
      // it) and re-established on demand — resilient to scale-to-zero.
      postgres: ({ url }) => new SQL({ url, max: 1, idleTimeout: 10 }),
    },
  }),
);
