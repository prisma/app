#!/usr/bin/env bun
/**
 * Populate `.env` (from `.env.example`) with the credentials the example apps need
 * to deploy against Prisma Cloud.
 *
 *   bun scripts/setup-env.ts          # or: pnpm setup:env
 *
 * What it does:
 *   1. Copies `.env.example` -> `.env` if `.env` doesn't exist yet.
 *   2. Authenticates the Prisma CLI (browser OAuth) if you aren't already logged in.
 *   3. Lists your workspaces and lets you pick one -> PRISMA_WORKSPACE_ID.
 *   4. Prompts for a service token -> PRISMA_SERVICE_TOKEN. Service tokens can only
 *      be minted in the Prisma Console (there is no CLI/API to create one — verified:
 *      `/v1/service-tokens` 404s), so the script links you there and reads the paste.
 *   5. Generates a stable ALCHEMY_PASSWORD if one isn't set (never overwrites it —
 *      it must stay constant or Alchemy can't decrypt existing local state).
 *
 * Re-runnable: existing values are kept unless you choose to replace them.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = process.env.SETUP_ENV_FILE ?? path.join(root, ".env"); // override for tests
const EXAMPLE = path.join(root, ".env.example");

// Override with e.g. PRISMA_CLI="prisma" if you have the CLI installed globally.
const CLI = (process.env.PRISMA_CLI ?? "bunx @prisma/cli@latest").split(" ");

export interface Workspace {
  id: string;
  name?: string;
  active?: boolean;
}

/** Pull the workspace list out of `auth workspace list --json`, tolerating shape drift. */
export function parseWorkspaces(stdout: string): Workspace[] {
  const start = stdout.search(/[[{]/);
  if (start < 0) return [];
  let parsed: any;
  for (let end = stdout.length; end > start; end--) {
    try {
      parsed = JSON.parse(stdout.slice(start, end));
      break;
    } catch {}
  }
  if (!parsed) return [];
  const activeId = parsed.result?.context?.activeWorkspaceId ?? parsed.context?.activeWorkspaceId;
  const items: unknown = Array.isArray(parsed)
    ? parsed
    : parsed.result?.items ?? parsed.items ?? parsed.workspaces ?? parsed.data ?? [];
  return (Array.isArray(items) ? items : [])
    .map((w: any) => {
      const id = w.id ?? w.workspaceId ?? w.workspace?.id;
      return {
        id,
        name: w.name ?? w.displayName ?? w.slug ?? w.workspace?.name,
        active: id === activeId || w.status === "active",
      } as Workspace;
    })
    .filter((w) => typeof w.id === "string");
}

/** Set/replace a `KEY=value` line in a .env body, preserving everything else. */
export function upsertEnv(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
}

function cli(args: string[], capture = false) {
  const [cmd, ...base] = CLI;
  return spawnSync(cmd, [...base, ...args], {
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
}

async function getEnv(key: string): Promise<string> {
  const m = (await readFile(ENV, "utf8")).match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

async function setEnv(key: string, value: string): Promise<void> {
  await writeFile(ENV, upsertEnv(await readFile(ENV, "utf8"), key, value));
}

async function main() {
  // Interactive on a TTY; when stdin is piped (tests / CI), read all answers up
  // front and serve them from a queue — a single readline over a pipe closes on
  // EOF between prompts. Created inside main() so importing this file for tests
  // never touches stdin.
  const isTTY = Boolean(process.stdin.isTTY);
  let rl: readline.Interface | undefined;
  let mute = false;
  const queue: string[] = [];
  if (isTTY) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const rlInternal = rl as unknown as { _writeToOutput: (s: string) => void };
    const echo = rlInternal._writeToOutput.bind(rlInternal);
    rlInternal._writeToOutput = (s: string) => {
      if (!mute) echo(s);
    };
  } else {
    process.stdin.setEncoding("utf8");
    const all: string = await new Promise((res) => {
      let data = "";
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => res(data));
    });
    queue.push(...all.split("\n"));
  }
  const ask = (q: string): Promise<string> => {
    if (rl) return new Promise((res) => rl!.question(q, (a) => res(a.trim())));
    const a = (queue.shift() ?? "").trim();
    console.log(q + a);
    return Promise.resolve(a);
  };
  const askSecret = (q: string): Promise<string> => {
    if (rl)
      return new Promise((res) => {
        rl!.question(q, (a) => ((mute = false), process.stdout.write("\n"), res(a.trim())));
        mute = true; // question() printed the prompt synchronously; hide what's typed next
      });
    process.stdout.write(q + "\n"); // don't echo the secret
    return Promise.resolve((queue.shift() ?? "").trim());
  };
  const close = () => rl?.close();

  // 1. .env exists ------------------------------------------------------------
  if (!existsSync(EXAMPLE)) {
    console.error(`Missing ${EXAMPLE}`);
    process.exit(1);
  }
  if (existsSync(ENV)) {
    console.log("• .env exists — filling in any missing values (existing ones are kept)");
  } else {
    await copyFile(EXAMPLE, ENV);
    console.log("• Created .env from .env.example");
  }

  // 2. Authenticate the CLI ---------------------------------------------------
  if (cli(["auth", "whoami", "--json"], true).status === 0) {
    console.log("• Prisma CLI already authenticated");
  } else {
    console.log("\n• Not logged in — running `auth login` (opens your browser)…");
    if (cli(["auth", "login"]).status !== 0) {
      console.error("auth login failed — re-run once you're logged in.");
      process.exit(1);
    }
  }

  // 3. Pick a workspace -------------------------------------------------------
  console.log("\n• Fetching your workspaces…");
  const list = cli(["auth", "workspace", "list", "--json"], true);
  const workspaces = parseWorkspaces(list.stdout ?? "");
  let workspaceId: string;
  if (workspaces.length === 0) {
    console.log("  Couldn't parse the workspace list. Raw output:\n");
    console.log((list.stdout ?? "") + (list.stderr ?? ""));
    workspaceId = await ask("  Enter the workspace id (wksp_…): ");
  } else {
    workspaces.forEach((w, i) =>
      console.log(`  [${i + 1}] ${w.name ?? "(unnamed)"} — ${w.id}${w.active ? "  (active)" : ""}`),
    );
    const def = Math.max(1, workspaces.findIndex((w) => w.active) + 1);
    const pick = await ask(`  Which workspace? [1-${workspaces.length}] (default ${def}) `);
    workspaceId = (pick === "" ? workspaces[def - 1] : workspaces[Number(pick) - 1])?.id ?? "";
  }
  if (!workspaceId) {
    console.error("No workspace selected.");
    close();
    process.exit(1);
  }
  await setEnv("PRISMA_WORKSPACE_ID", workspaceId);
  console.log(`• PRISMA_WORKSPACE_ID = ${workspaceId}`);

  // 4. Service token (Console-only) -------------------------------------------
  const existingToken = await getEnv("PRISMA_SERVICE_TOKEN");
  const replace =
    !existingToken ||
    (await ask("• PRISMA_SERVICE_TOKEN is already set — replace it? [y/N] ")).toLowerCase() === "y";
  if (replace) {
    console.log(
      `\n  Create a service token in the Prisma Console (there is no CLI/API for this):\n` +
        `    https://console.prisma.io  →  your workspace (${workspaceId})  →  Settings → Service Tokens\n` +
        `    → New Service Token, then copy it (it's shown only once).`,
    );
    const token = await askSecret("  Paste PRISMA_SERVICE_TOKEN (input hidden): ");
    if (token) {
      await setEnv("PRISMA_SERVICE_TOKEN", token);
      console.log("• PRISMA_SERVICE_TOKEN set");
    } else {
      console.log("• No token entered — set PRISMA_SERVICE_TOKEN before deploying.");
    }
  } else {
    console.log("• Keeping existing PRISMA_SERVICE_TOKEN");
  }

  // 5. ALCHEMY_PASSWORD -------------------------------------------------------
  if (await getEnv("ALCHEMY_PASSWORD")) {
    console.log("• ALCHEMY_PASSWORD already set — leaving it (must stay constant)");
  } else {
    await setEnv("ALCHEMY_PASSWORD", randomBytes(24).toString("hex"));
    console.log("• Generated ALCHEMY_PASSWORD");
  }

  close();
  console.log(
    `\n.env is ready. Deploy the example (source .env — the CLI's --env-file doesn't populate process.env):\n` +
      `  cd examples/storefront-auth && ( set -a; . ../../.env; set +a; pnpm exec alchemy deploy --yes )`,
  );
}

if (import.meta.main) {
  await main();
}
