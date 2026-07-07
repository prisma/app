// Local dev convenience (not part of the deploy artifact — main.ts stays a
// pure re-export). Boots the service directly via its own run(); this
// service's address depends on the hex it's provisioned into at deploy —
// for standalone local dev it's run unaddressed ("" — unprefixed keys).
import service from "../src/service.ts";

await service.run("");
