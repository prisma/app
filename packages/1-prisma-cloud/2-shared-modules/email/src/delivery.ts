/**
 * The `Delivery` interface `handlers.ts`'s `send` calls for modes `resend`
 * and `smtp`. Retries live inside the shared policy wrapper (a later
 * dispatch wraps `delivery-resend.ts`/`delivery-smtp.ts` with it) — this
 * interface sees only the final outcome of an attempt, plus how many
 * provider tries it took to reach that outcome.
 */
import type { EmailRow } from './outbox-store.ts';

export type DeliveryResult =
  | { readonly ok: true; readonly providerMessageId: string | null; readonly attempts: number }
  | { readonly ok: false; readonly error: string; readonly attempts: number };

export interface Delivery {
  deliver(row: EmailRow): Promise<DeliveryResult>;
}
