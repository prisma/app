import { fileURLToPath } from "node:url";
import { buildServiceArtifact } from "@makerkit/core/build";

/** Bundles the shim-wrapped service into the deployable artifact. */
const service = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const outFile = fileURLToPath(new URL("../dist/hello.tar.gz", import.meta.url));

const result = await buildServiceArtifact({ service, outFile });
console.log(`Built ${result.outFile}`);
console.log(`sha256: ${result.sha256}`);
