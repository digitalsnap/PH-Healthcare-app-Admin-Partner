/**
 * The sender job: take due messages from the outbox, hand each to the
 * carrier, record what happened. Safe to run from several places at once —
 * the database hands each message to one caller only (claim_due_sms).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsCarrier, SmsSendResult } from "./carrier";
import { renderSms, SMS_TEMPLATES, type SmsLocale, type SmsParams, type SmsTemplate } from "./render";

export type QueuedSms = {
  id: string;
  to_phone: string;
  template: string;
  params: SmsParams;
  locale: string;
};

/** Where queued messages come from and where results go. */
export interface SmsOutbox {
  claim(limit: number): Promise<QueuedSms[]>;
  complete(id: string, result: SmsSendResult): Promise<void>;
}

export type DispatchSummary = { claimed: number; sent: number; retried: number; failed: number };

export const DEFAULT_BATCH = 50;

export async function dispatchDueSms(
  outbox: SmsOutbox,
  carrier: SmsCarrier,
  limit: number = DEFAULT_BATCH,
): Promise<DispatchSummary> {
  const messages = await outbox.claim(limit);
  const summary: DispatchSummary = { claimed: messages.length, sent: 0, retried: 0, failed: 0 };

  for (const message of messages) {
    const template = SMS_TEMPLATES.find((known) => known === message.template);
    let result: SmsSendResult;
    if (!template) {
      // Wording for this template does not exist; retrying cannot help.
      result = { ok: false, error: "unknown_template", retryable: false };
    } else {
      try {
        result = await carrier.send({
          to: message.to_phone,
          body: renderSms(template as SmsTemplate, message.params, message.locale === "en" ? "en" : ("fil" as SmsLocale)),
        });
      } catch {
        // A carrier must not throw, but one that does must not stop the batch.
        result = { ok: false, error: "carrier_threw", retryable: true };
      }
    }

    await outbox.complete(message.id, result);
    if (result.ok) summary.sent += 1;
    else if (result.retryable) summary.retried += 1;
    else summary.failed += 1;
  }
  return summary;
}

/** The real outbox: the sms_message table, through its two service-role functions. */
export function supabaseOutbox(admin: SupabaseClient): SmsOutbox {
  return {
    async claim(limit) {
      const { data, error } = await admin.rpc("claim_due_sms", { p_limit: limit });
      if (error) throw new Error("claim_due_sms failed");
      return (data ?? []) as QueuedSms[];
    },
    async complete(id, result) {
      const { error } = await admin.rpc("complete_sms", {
        p_id: id,
        p_sent: result.ok,
        p_provider_ref: result.ok ? result.providerRef : null,
        p_error: result.ok ? null : result.error,
        p_retryable: result.ok ? true : result.retryable,
      });
      if (error) throw new Error("complete_sms failed");
    },
  };
}
