// Runtime bundle entry (app-owned). This service declares no inputs, so the
// bare runtime() suffices — no client factories.
import { runHost } from "@makerkit/core/runtime";
import { runtime } from "@makerkit/prisma-cloud/runtime";
import service from "./service";

runHost(service, runtime());
