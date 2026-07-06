// Runtime bundle entry (app-owned). This service declares no inputs, so the
// pipeline resolves only context fields — no connections to define.
import { runHost } from "@makerkit/core/runtime";
import service from "./service";

runHost(service);
