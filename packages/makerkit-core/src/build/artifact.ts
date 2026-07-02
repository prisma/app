import { $ } from "bun";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Builds a Prisma Compute deploy artifact whose entrypoint is the MakerKit
 * host shim. Generates a small entry that imports the user service's default
 * export (the `defineService` handle) and hands it to `runHost`, bundles that
 * for the `bun` target, writes `compute.manifest.json` pointing at it, and
 * packs the result into a `.tar.gz`. The user service is bundled in; the shim
 * wraps it.
 */
export interface BuildServiceArtifactOptions {
  /** Path to the user service module (default export = the defineService handle). */
  service: string;
  /** Path the final `.tar.gz` artifact should be written to. */
  outFile: string;
}

export interface BuildServiceArtifactResult {
  outFile: string;
  sha256: string;
}

const MANIFEST_VERSION = "1";
const BUNDLE_BASENAME = "index";

/** Generates the shim entrypoint source that wraps a user service at `serviceImportPath`. */
export function hostEntrySource(serviceImportPath: string): string {
  return [
    `import { runHost } from "@makerkit/core/runtime";`,
    `import service from ${JSON.stringify(serviceImportPath)};`,
    ``,
    `runHost(service);`,
    ``,
  ].join("\n");
}

export async function buildServiceArtifact(
  options: BuildServiceArtifactOptions,
): Promise<BuildServiceArtifactResult> {
  const service = path.resolve(options.service);
  const outFile = path.resolve(options.outFile);

  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), "makerkit-artifact-"));

  // Generate the shim entry NEXT TO the user service so Node/Bun module
  // resolution walks up into the same node_modules the service already uses —
  // otherwise `@makerkit/core/runtime` (and the service's own deps) won't
  // resolve from a temp dir. Import the service by a relative path.
  const serviceDir = path.dirname(service);
  const entryFile = path.join(serviceDir, `.makerkit-host-entry.${process.pid}.ts`);
  const relServiceImport = `./${path.basename(service)}`;

  try {
    await fs.promises.writeFile(entryFile, hostEntrySource(relServiceImport));

    const build = await Bun.build({
      entrypoints: [entryFile],
      target: "bun",
      sourcemap: "external",
      outdir: staging,
      naming: `${BUNDLE_BASENAME}.js`,
    });

    if (!build.success) {
      const messages = build.logs.map((log) => log.message).join("\n");
      throw new Error(`Bun.build failed for ${service}:\n${messages}`);
    }

    const entrypoint = `${BUNDLE_BASENAME}.js`;
    const manifest = { manifestVersion: MANIFEST_VERSION, entrypoint };
    await fs.promises.writeFile(
      path.join(staging, "compute.manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
    await $`tar -czf ${outFile} -C ${staging} .`;

    const sha256 = await hashFile(outFile);
    return { outFile, sha256 };
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
    await fs.promises.rm(entryFile, { force: true });
    await fs.promises.rm(`${entryFile}.map`, { force: true });
  }
}

async function hashFile(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(file).arrayBuffer());
  return hasher.digest("hex");
}

if (import.meta.main) {
  const service = process.argv[2];
  const outFile = process.argv[3];

  if (!service || !outFile) {
    console.error("Usage: bun build/artifact.ts <serviceModule> <outFile>");
    process.exit(1);
  }

  const result = await buildServiceArtifact({ service, outFile });
  console.log(`Built ${result.outFile}`);
  console.log(`sha256: ${result.sha256}`);
}
