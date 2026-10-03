/**
 * Turns an outbox row (template + params + locale) into the text that is
 * sent. The body is composed only at send time, from fixed wording in the
 * message files, so no free text and no health detail is ever stored or sent:
 * a booking code, a time, a place.
 */

import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import fil from "../../../messages/fil.json";

export const SMS_TEMPLATES = [
  "booking_confirmed",
  "booking_rescheduled",
  "booking_cancelled",
  "appointment_reminder",
  "reservation_ready",
  "reservation_cancelled",
  "refill_ready",
  "refill_declined",
] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

export type SmsLocale = "en" | "fil";

/** What the database puts in sms_message.params. All optional: a missing value is left out. */
export type SmsParams = {
  booking_code?: string | null;
  /** UTC ISO instant. */
  starts_at?: string | null;
  facility_name?: string | null;
};

const MESSAGES = { en, fil };

/** One SMS segment in the GSM alphabet. Longer texts are split and billed per segment. */
export const SMS_SEGMENT_LENGTH = 160;

/** The time as the patient reads it: always Asia/Manila, whatever the server's zone. */
function whenIn(locale: SmsLocale, startsAt: string): string {
  return new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(startsAt))
    // Some locales put a narrow no-break space before AM/PM; SMS wants plain spaces.
    .replace(/[\u202f\u00a0]/g, " ");
}

export function renderSms(template: SmsTemplate, params: SmsParams, locale: SmsLocale): string {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "sms" });
  return t(template, {
    code: params.booking_code ?? "",
    when: params.starts_at ? whenIn(locale, params.starts_at) : "",
    place: params.facility_name ?? "",
  })
    .replace(/\s+/g, " ")
    .trim();
}
