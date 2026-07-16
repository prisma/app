import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { guidesDir, renderGuides, rewriteHref, slugOf } from '../scripts/render.ts';

const KNOWN = new Set(['getting-started', 'building-an-app', 'testing', 'deploying']);

describe('rewriteHref', () => {
  it('leaves external and anchor links untouched', () => {
    expect(rewriteHref('https://bun.sh', KNOWN)).toBe('https://bun.sh');
    expect(rewriteHref('#databases', KNOWN)).toBe('#databases');
  });

  it('turns an intra-guide link into a site route, preserving the anchor', () => {
    expect(rewriteHref('building-an-app.md', KNOWN)).toBe('/guides/building-an-app');
    expect(rewriteHref('building-an-app.md#secrets', KNOWN)).toBe(
      '/guides/building-an-app#secrets',
    );
  });

  it('sends a file that escapes docs/guides/ to a GitHub blob URL', () => {
    expect(rewriteHref('../../gotchas.md', KNOWN)).toBe(
      'https://github.com/prisma/composer/blob/main/gotchas.md',
    );
    expect(rewriteHref('../design/10-domains/testing.md', KNOWN)).toBe(
      'https://github.com/prisma/composer/blob/main/docs/design/10-domains/testing.md',
    );
  });

  it('sends a directory that escapes docs/guides/ to a GitHub tree URL', () => {
    expect(rewriteHref('../../examples/store/', KNOWN)).toBe(
      'https://github.com/prisma/composer/tree/main/examples/store',
    );
  });

  it('throws on an intra-guide link to a slug that does not exist', () => {
    expect(() => rewriteHref('nope.md', KNOWN)).toThrow(/unknown slug/);
  });
});

describe('renderGuides', () => {
  it('produces exactly one guide per docs/guides/*.md file', async () => {
    const files = readdirSync(guidesDir).filter((f) => f.endsWith('.md'));
    const guides = await renderGuides();
    expect(new Set(guides.map((g) => g.slug))).toEqual(new Set(files.map(slugOf)));
  });

  it('gives every guide a non-empty title and rendered html', async () => {
    for (const g of await renderGuides()) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.html).toContain('<');
    }
  });

  it('rewrites every link — no raw relative path or bare .md survives in the html', async () => {
    for (const g of await renderGuides()) {
      for (const [, href] of g.html.matchAll(/href="([^"]*)"/g)) {
        if (href === undefined) continue;
        expect(href).not.toMatch(/^\.\.?\//); // no ./ or ../
        // a .md target is only allowed as part of a GitHub URL
        if (href.includes('.md')) expect(href).toContain('github.com');
      }
    }
  });

  it('points every in-site /guides/ link at a real guide', async () => {
    const guides = await renderGuides();
    const slugs = new Set(guides.map((g) => g.slug));
    for (const g of guides) {
      for (const [, href] of g.html.matchAll(/href="\/guides\/([^"#]+)/g)) {
        if (href === undefined) continue;
        expect(slugs.has(href)).toBe(true);
      }
    }
  });
});
