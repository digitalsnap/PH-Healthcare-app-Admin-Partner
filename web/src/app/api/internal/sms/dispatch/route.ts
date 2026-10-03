import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { carrierFromEnv } from "@/lib/sms/carrier";
import { dispatchDueSms, supabaseOutbox } from "@/lib/sms/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";

/** Whether the request carries the scheduler's secret. Compared in constant time. */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Sends the due messages in the SMS outbox. Meant to be called by a scheduler
 * every minute or so, with `Authorization: Bearer <CRON_SECRET>`.
 *
 * Until a carrier is configured (SMS_CARRIER), this does nothing and says so:
 * messages simply stay queued. The response carries counts only.
 */
export async function POST(request: Request) {
  if (!authorised(request)) return new NextResponse(null, { status: 401 });

  const carrier = carrierFromEnv();
  if (!carrier) return NextResponse.json({ error: "no_carrier_configured" }, { status: 503 });

  const summary = await dispatchDueSms(supabaseOutbox(createAdminClient()), carrier);
  return NextResponse.json(summary);
}
