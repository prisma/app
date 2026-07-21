/**
 * The `Delivery` interface `handlers.ts`'s `send` calls for modes `resend`
 * and `smtp`. Retries live inside the shared policy wrapper (a later
 * dispatch wraps `delivery-resend.ts`/`delivery-smtp.ts` with it) — this
 * interface sees only the final outcome of an attempt.
 */
import type { EmailRow } from './outbox-store.ts';

export type DeliveryResult =
  | { readonly ok: true; readonly providerMessageId: string | null }
  | { readonly ok: false; readonly error: string };

export interface Delivery {
  deliver(row: EmailRow): Promise<DeliveryResult>;
}
