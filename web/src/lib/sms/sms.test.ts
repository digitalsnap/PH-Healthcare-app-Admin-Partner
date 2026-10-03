import { describe, expect, it } from "vitest";
import { carrierFromEnv, type SmsCarrier, type SmsSendResult } from "./carrier";
import { dispatchDueSms, type QueuedSms, type SmsOutbox } from "./dispatch";
import { renderSms, SMS_SEGMENT_LENGTH, SMS_TEMPLATES } from "./render";

const PARAMS = {
  booking_code: "J7BXUJ",
  starts_at: "2026-10-05T01:00:00Z", // 9:00 AM in Manila
  facility_name: "Synthetic Diagnostic Center – Hub City Branch",
};

describe("renderSms", () => {
  it("has wording for every template in both languages, within one SMS segment", () => {
    for (const template of SMS_TEMPLATES) {
      for (const locale of ["en", "fil"] as const) {
        const body = renderSms(template, PARAMS, locale);
        expect(body.length, `${template}/${locale}: ${body}`).toBeGreaterThan(20);
        expect(body.length, `${template}/${locale}: ${body}`).toBeLessThanOrEqual(SMS_SEGMENT_LENGTH);
        expect(body).not.toMatch(/[{}]/);
      }
    }
  });

  it("shows the time in Manila, not UTC", () => {
    const body = renderSms("booking_confirmed", PARAMS, "en");
    expect(body).toContain("9:00");
    expect(body).toMatch(/Oct/);
    expect(body).toContain("J7BXUJ");
  });

  it("writes Filipino when asked", () => {
    expect(renderSms("booking_confirmed", PARAMS, "fil")).not.toBe(renderSms("booking_confirmed", PARAMS, "en"));
  });

  it("sticks to the GSM alphabet so a message stays one segment", () => {
    for (const template of SMS_TEMPLATES) {
      for (const locale of ["en", "fil"] as const) {
        // The facility name is data; the fixed wording must be plain ASCII.
        const body = renderSms(template, { ...PARAMS, facility_name: "Clinic" }, locale);
        expect(body, `${template}/${locale}`).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });

  it("copes with missing details without leaving placeholders behind", () => {
    const body = renderSms("booking_cancelled", {}, "en");
    expect(body).not.toMatch(/[{}]/);
    expect(body).not.toMatch(/\s{2,}/);
  });
});

describe("carrierFromEnv", () => {
  it("sends nothing when no carrier is configured", () => {
    expect(carrierFromEnv(undefined)).toBeNull();
    expect(carrierFromEnv("")).toBeNull();
  });

  it("fails loudly on a carrier name it does not know", () => {
    expect(() => carrierFromEnv("carrier-pigeon")).toThrow(/Unknown SMS_CARRIER/);
  });
});

describe("dispatchDueSms", () => {
  const message = (id: string, template = "booking_confirmed"): QueuedSms => ({
    id,
    to_phone: "+639170000000",
    template,
    params: PARAMS,
    locale: "en",
  });

  function harness(queued: QueuedSms[], respond: (to: string, body: string, index: number) => SmsSendResult) {
    const completed = new Map<string, SmsSendResult>();
    const sent: string[] = [];
    const outbox: SmsOutbox = {
      claim: async (limit) => queued.slice(0, limit),
      complete: async (id, result) => void completed.set(id, result),
    };
    const carrier: SmsCarrier = {
      name: "fake",
      send: async ({ to, body }) => {
        sent.push(body);
        return respond(to, body, sent.length - 1);
      },
    };
    return { outbox, carrier, completed, sent };
  }

  it("sends each claimed message and records the carrier's reference", async () => {
    const { outbox, carrier, completed, sent } = harness([message("a"), message("b")], (_to, _body, index) => ({
      ok: true,
      providerRef: `ref-${index}`,
    }));
    expect(await dispatchDueSms(outbox, carrier)).toEqual({ claimed: 2, sent: 2, retried: 0, failed: 0 });
    expect(completed.get("b")).toEqual({ ok: true, providerRef: "ref-1" });
    expect(sent[0]).toContain("J7BXUJ");
  });

  it("separates failures worth retrying from final ones", async () => {
    const { outbox, carrier } = harness([message("a"), message("b"), message("c")], (_to, _body, index) =>
      index === 0
        ? { ok: true, providerRef: "ref" }
        : { ok: false, error: index === 1 ? "busy" : "invalid_number", retryable: index === 1 },
    );
    expect(await dispatchDueSms(outbox, carrier)).toEqual({ claimed: 3, sent: 1, retried: 1, failed: 1 });
  });

  it("does not let one bad message or a throwing carrier stop the batch", async () => {
    const { outbox, carrier, completed } = harness(
      [message("a", "telegram_from_the_future"), message("b"), message("c")],
      (_to, _body, index) => {
        if (index === 0) throw new Error("socket hang up");
        return { ok: true, providerRef: "ref" };
      },
    );
    expect(await dispatchDueSms(outbox, carrier)).toEqual({ claimed: 3, sent: 1, retried: 1, failed: 1 });
    expect(completed.get("a")).toEqual({ ok: false, error: "unknown_template", retryable: false });
    expect(completed.get("b")).toEqual({ ok: false, error: "carrier_threw", retryable: true });
  });

  it("asks the outbox for no more than the batch size", async () => {
    const { outbox, carrier } = harness([message("a"), message("b"), message("c")], () => ({
      ok: true,
      providerRef: "ref",
    }));
    expect((await dispatchDueSms(outbox, carrier, 2)).claimed).toBe(2);
  });
});
