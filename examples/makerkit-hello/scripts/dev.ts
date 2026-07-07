// Local dev convenience (not part of the deploy artifact — main.ts stays a
// pure re-export). Boots the service directly via its own run(); a lone
// service's address is "" (the codec's unprefixed case), so it reads plain
// DB_URL/PORT from the local environment.
import service from "../src/service.ts";

await service.run("");
