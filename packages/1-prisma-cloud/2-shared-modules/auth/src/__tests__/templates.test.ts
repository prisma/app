/**
 * `authTemplates` + `safeLink` (spec § Templates and email touchpoints):
 * pinned subjects, HTML escaping of every interpolation that lands in
 * markup, the bare-URL plain-text part, and `safeLink`'s origin check.
 */
import { describe, expect, test } from 'bun:test';
import { authTemplates, safeLink } from '../templates.ts';

describe('authTemplates — pinned subjects and content shape', () => {
  test('verification: pinned subject, one heading, one paragraph, one link, bare-URL text', () => {
    const url = 'https://app.example/verify?token=abc';
    const rendered = authTemplates.verification.render({ url, appName: 'auth' });
    expect(rendered.subject).toBe('Verify your email address');
    expect(rendered.html).toContain('<h1>');
    expect((rendered.html.match(/<h1>/g) ?? []).length).toBe(1);
    expect((rendered.html.match(/<p>/g) ?? []).length).toBe(1);
    expect((rendered.html.match(/<a /g) ?? []).length).toBe(1);
    expect(rendered.html).toContain(`href="${url}"`);
    expect(rendered.text).toBe(url);
  });

  test('passwordReset: pinned subject', () => {
    const url = 'https://app.example/reset?token=abc';
    const rendered = authTemplates.passwordReset.render({ url, appName: 'auth' });
    expect(rendered.subject).toBe('Reset your password');
    expect(rendered.html).toContain(`href="${url}"`);
    expect(rendered.text).toBe(url);
  });

  test('magicLink: pinned subject interpolates appName', () => {
    const url = 'https://app.example/magic?token=abc';
    const rendered = authTemplates.magicLink.render({ url, appName: 'auth' });
    expect(rendered.subject).toBe('Sign in to auth');
    expect(rendered.html).toContain(`href="${url}"`);
    expect(rendered.text).toBe(url);
  });

  test('every render is a plain synchronous function (no .tsx precompile caveat)', () => {
    const result = authTemplates.verification.render({
      url: 'https://app.example/v',
      appName: 'auth',
    });
    expect(result).not.toBeInstanceOf(Promise);
  });

  test('the url is HTML-escaped in the href — a malicious link cannot break out of the attribute', () => {
    const url = 'https://app.example/verify?token=a"><script>alert(1)</script>';
    const rendered = authTemplates.verification.render({ url, appName: 'auth' });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&quot;&gt;&lt;script&gt;');
    // The plain-text part carries the bare, UNescaped URL — it is not markup.
    expect(rendered.text).toBe(url);
  });

  test('every one of & < > " \' is escaped in the rendered href', () => {
    const crafted = 'https://app.example/v?a=&b=<&c=>&d="&e=\'';
    const rendered = authTemplates.verification.render({ url: crafted, appName: 'auth' });
    expect(rendered.html).toContain('&amp;');
    expect(rendered.html).toContain('&lt;');
    expect(rendered.html).toContain('&gt;');
    expect(rendered.html).toContain('&quot;');
    expect(rendered.html).toContain('&#39;');
  });

  test('appName is HTML-escaped in the magic-link heading', () => {
    const rendered = authTemplates.magicLink.render({
      url: 'https://app.example/magic',
      appName: '<b>evil</b>',
    });
    expect(rendered.html).not.toContain('<b>evil</b>');
    expect(rendered.html).toContain('&lt;b&gt;evil&lt;/b&gt;');
  });
});

describe('safeLink', () => {
  const baseUrl = 'https://app.example';

  test('returns the url unchanged when the origin matches', () => {
    const url = 'https://app.example/verify?token=abc';
    expect(safeLink(url, baseUrl)).toBe(url);
  });

  test('throws when the origin does not match', () => {
    expect(() => safeLink('https://evil.example/verify', baseUrl)).toThrow(/does not match/);
  });

  test('a matching scheme+host but different port is a different origin', () => {
    expect(() => safeLink('https://app.example:8443/verify', baseUrl)).toThrow(/does not match/);
  });

  test('throws on a malformed url (new URL parse failure)', () => {
    expect(() => safeLink('not a url', baseUrl)).toThrow();
  });
});
