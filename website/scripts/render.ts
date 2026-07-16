/**
 * Docs rendering, as a library so the test can drive it without touching the
 * filesystem output. The site's content is the canonical guides in
 * docs/guides/, rendered to HTML (markdown-it + shiki).
 *
 * Link rewriting is the one non-obvious job: a guide's relative links are
 * written relative to docs/guides/. A link that stays inside docs/guides/
 * (another guide) becomes a site route; any link that escapes it (examples/,
 * docs/design/, gotchas.md) becomes a GitHub URL, because those files don't
 * exist in the deployed site.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';

export interface Guide {
  readonly slug: string;
  readonly title: string;
  readonly html: string;
}

const here = dirname(fileURLToPath(import.meta.url));
export const guidesDir = join(here, '..', '..', 'docs', 'guides');

const GITHUB_TREE = 'https://github.com/prisma/composer/tree/main';
const GITHUB_BLOB = 'https://github.com/prisma/composer/blob/main';

// Sidebar order. A guide file not listed here sorts after these, alphabetically.
const ORDER = ['getting-started', 'building-an-app', 'testing', 'deploying'];

const LANG_ALIAS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'shellscript',
  bash: 'shellscript',
  json: 'json',
  jsonc: 'jsonc',
};

export const slugOf = (file: string): string => file.replace(/\.md$/, '');

/**
 * A guide's relative href → the site route or GitHub URL it should point to.
 * Pure: depends only on its inputs. Throws on an intra-guide link to a slug
 * that isn't a real guide, so a dead site link fails the build.
 */
export function rewriteHref(href: string, knownSlugs: ReadonlySet<string>): string {
  if (/^https?:\/\//.test(href) || href.startsWith('#')) return href;

  const [pathPart = '', hash] = href.split('#');
  const resolved = posix.normalize(posix.join('docs/guides', pathPart));

  if (resolved.startsWith('docs/guides/') && resolved.endsWith('.md')) {
    const slug = slugOf(resolved.slice('docs/guides/'.length));
    if (!knownSlugs.has(slug)) {
      throw new Error(`Guide link to unknown slug "${slug}" (from href "${href}")`);
    }
    return `/guides/${slug}${hash ? `#${hash}` : ''}`;
  }

  const trimmed = resolved.replace(/\/$/, '');
  const lastSegment = trimmed.split('/').pop() ?? '';
  const isDir = href.endsWith('/') || !lastSegment.includes('.');
  const base = isDir ? GITHUB_TREE : GITHUB_BLOB;
  return `${base}/${trimmed}${hash ? `#${hash}` : ''}`;
}

function titleOf(markdown: string, slug: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug;
}

function orderIndex(slug: string): number {
  const i = ORDER.indexOf(slug);
  return i === -1 ? ORDER.length : i;
}

/** Reads docs/guides/, renders every *.md, and returns them in sidebar order. */
export async function renderGuides(): Promise<Guide[]> {
  const files = readdirSync(guidesDir).filter((f) => f.endsWith('.md'));
  const knownSlugs = new Set(files.map(slugOf));

  const highlighter = await createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: ['typescript', 'tsx', 'shellscript', 'json', 'jsonc'],
  });

  const md = new MarkdownIt({
    html: false,
    linkify: false,
    highlight: (code, lang) =>
      highlighter.codeToHtml(code, {
        lang: LANG_ALIAS[lang] ?? 'text',
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      }),
  });

  // shiki emits its own <pre>; return it verbatim instead of the default
  // <pre><code> wrapping.
  md.renderer.rules.fence = (tokens, idx, options) => {
    const token = tokens[idx];
    if (!token) return '';
    const lang = token.info.trim().split(/\s+/)[0] ?? '';
    return options.highlight?.(token.content, lang, '') || token.content;
  };

  const defaultLinkOpen =
    md.renderer.rules['link_open'] ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token?.attrGet('href') ?? null;
    if (token && href !== null) token.attrSet('href', rewriteHref(href, knownSlugs));
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return files
    .map((file) => {
      const slug = slugOf(file);
      const markdown = readFileSync(join(guidesDir, file), 'utf8');
      return { slug, title: titleOf(markdown, slug), html: md.render(markdown) };
    })
    .sort((a, b) => orderIndex(a.slug) - orderIndex(b.slug) || a.slug.localeCompare(b.slug));
}
