/**
 * The SMS carrier boundary. Transactional SMS is one-way only: confirmations,
 * reminders and notices. No carrier has been chosen yet, so none is
 * implemented here — only the shape one has to fit.
 *
 * To add a carrier:
 *   1. Implement SmsCarrier in a new file in this folder (it calls the
 *      carrier's HTTP API with credentials read from server-only env vars).
 *   2. Register it in CARRIERS below under a short name.
 *   3. Set SMS_CARRIER to that name. Nothing else changes: the outbox, the
 *      message wording and the dispatch job already exist.
 */

export type SmsSendResult =
  | { ok: true; providerRef: string }
  /** `error` is a short carrier code, never the message or the phone number. */
  | { ok: false; error: string; retryable: boolean };

export interface SmsCarrier {
  readonly name: string;
  /** `to` is an E.164 number (+639XXXXXXXXX). Must not throw: report failure in the result. */
  send(message: { to: string; body: string }): Promise<SmsSendResult>;
}

const CARRIERS: Record<string, () => SmsCarrier> = {};

/** The configured carrier, or null when none is set up (nothing is sent). */
export function carrierFromEnv(name: string | undefined = process.env.SMS_CARRIER): SmsCarrier | null {
  if (!name) return null;
  const create = CARRIERS[name];
  if (!create) throw new Error(`Unknown SMS_CARRIER "${name}"`);
  return create();
}
