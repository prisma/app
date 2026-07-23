/**
 * The verification / password-reset / magic-link email content (spec §
 * Templates and email touchpoints). Plain sync render functions — the merged
 * email contract allows async `render` for react-email, but auth's content
 * is simple enough to stay sync and skip the `.tsx` precompile deploy
 * caveat. Every HTML interpolation goes through `escapeHtml`; the link is
 * validated with `safeLink` before it ever reaches a template (called from
 * `auth-options.ts`'s send callbacks, the one place the deploy's `baseUrl`
 * is available — template `data` itself only carries `url`/`appName`).
 */
import { defineTemplates } from '@internal/email';
import { type } from 'arktype';

const templateData = type({ url: 'string', appName: 'string' });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parses `url` and throws unless it shares `baseUrl`'s origin — the throw
 * aborts the send, so an off-origin link never gets mailed. Called from the
 * send callbacks before a link reaches a template.
 */
export function safeLink(url: string, baseUrl: string): string {
  const origin = new URL(url).origin;
  const expected = new URL(baseUrl).origin;
  if (origin !== expected) {
    throw new Error(
      `auth templates: link origin "${origin}" does not match the app origin "${expected}"`,
    );
  }
  return url;
}

function body(heading: string, message: string, url: string): { html: string; text: string } {
  const link = escapeHtml(url);
  return {
    html: `<h1>${heading}</h1><p>${message} <a href="${link}">${link}</a></p>`,
    text: url,
  };
}

export const authTemplates = defineTemplates({
  verification: {
    data: templateData,
    render: ({ url }) => ({
      subject: 'Verify your email address',
      ...body(
        'Verify your email address',
        'Click the link below to verify your email address.',
        url,
      ),
    }),
  },
  passwordReset: {
    data: templateData,
    render: ({ url }) => ({
      subject: 'Reset your password',
      ...body('Reset your password', 'Click the link below to reset your password.', url),
    }),
  },
  magicLink: {
    data: templateData,
    render: ({ url, appName }) => ({
      subject: `Sign in to ${appName}`,
      ...body(`Sign in to ${escapeHtml(appName)}`, 'Click the link below to sign in.', url),
    }),
  },
});

export type AuthTemplates = typeof authTemplates;
