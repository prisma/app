import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The bundler firewall (H2, node-owned loads): `node()`'s `assembler` field
 * must reach @prisma/app's `ServiceNode.loadAssembler()`/`assemble()` as
 * DATA — a plain string the node carries — never as the literal argument of
 * an `import()`/`require()` call here. A literal would get followed and
 * inlined by the wrapper's own bundler (tsdown, which sets `noExternal:
 * [/^@prisma\//]`), dragging this pack's own tsdown-powered assemble.ts
 * into the runtime artifact it's meant to build.
 */
describe("node()'s factory carries no static import edge to /assemble", () => {
  test('index.ts never calls import()/require() with a literal /assemble specifier', () => {
    const source = fs.readFileSync(path.join(import.meta.dir, '..', 'index.ts'), 'utf8');

    expect(source).toContain("'@prisma/app-node/assemble'");
    expect(source).not.toMatch(/(?:import|require)\s*\(\s*["'][^"']*\/assemble["']\s*\)/);
  });
});
