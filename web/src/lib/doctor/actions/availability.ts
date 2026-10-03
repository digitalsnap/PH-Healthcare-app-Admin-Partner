"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failed, SAVED, type FormState } from "@/lib/admin/form-state";
import { idSchema } from "@/lib/admin/schemas";
import { BOOKING_ERROR_CODES } from "@/lib/scheduling";
import { doctorContext, DOCTOR_HOME } from "../context";
import { parseExceptionForm, parseProfileForm, parseRuleForm } from "../schemas";
import { syncSchedule } from "../slots";

const AVAILABILITY_PATH = `${DOCTOR_HOME}/availability`;

function refresh() {
  revalidatePath(DOCTOR_HOME, "layout");
}

export async function updateProfile(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, practitioner } = await doctorContext();
  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return parsed.state;

  // Only specialties: PRC fields are set by the admin, and the database
  // refuses any attempt to change them from here.
  const { error } = await supabase
    .from("practitioner")
    .update({ specialties: parsed.data.specialties })
    .eq("id", practitioner.id);
  if (error) return failed("generic");
  refresh();
  return SAVED;
}

/** Requests an affiliation. It stays pending until the internal team approves it. */
export async function addAffiliation(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, practitioner } = await doctorContext();
  const facilityId = idSchema.safeParse(formData.get("facility_id"));
  if (!facilityId.success) return failed("invalidChoice");

  // Row-level security only shows verified facilities, so this also checks that.
  const { data: facility } = await supabase
    .from("facility")
    .select("id")
    .eq("id", facilityId.data)
    .maybeSingle();
  if (!facility) return failed("invalidChoice");

  const { error } = await supabase
    .from("practitioner_facility")
    .insert({ practitioner_id: practitioner.id, facility_id: facilityId.data });
  if (error) return failed(error.code === "23505" ? "duplicate" : "generic");
  refresh();
  return SAVED;
}

export async function removeAffiliation(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, practitioner } = await doctorContext();
  const facilityId = idSchema.safeParse(formData.get("facility_id"));
  if (!facilityId.success) return failed("generic");

  const { data: schedule } = await supabase
    .from("schedule")
    .select("id")
    .eq("practitioner_id", practitioner.id)
    .eq("facility_id", facilityId.data)
    .maybeSingle();
  if (schedule) return failed("affiliationInUse");

  const { error } = await supabase
    .from("practitioner_facility")
    .delete()
    .eq("practitioner_id", practitioner.id)
    .eq("facility_id", facilityId.data);
  if (error) return failed("generic");
  refresh();
  return SAVED;
}

/** A doctor has one schedule per clinic whose affiliation the team has approved. */
async function scheduleFor(
  supabase: Awaited<ReturnType<typeof doctorContext>>["supabase"],
  practitionerId: string,
  facilityId: string,
): Promise<string | null> {
  const { data: affiliation } = await supabase
    .from("practitioner_facility")
    .select("id")
    .eq("practitioner_id", practitionerId)
    .eq("facility_id", facilityId)
    .eq("status", "approved")
    .maybeSingle();
  if (!affiliation) return null;

  const { data: existing } = await supabase
    .from("schedule")
    .select("id")
    .eq("practitioner_id", practitionerId)
    .eq("facility_id", facilityId)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created } = await supabase
    .from("schedule")
    .insert({ practitioner_id: practitionerId, facility_id: facilityId })
    .select("id")
    .single();
  return (created?.id as string | undefined) ?? null;
}

export async function addRule(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, practitioner } = await doctorContext();
  const parsed = parseRuleForm(formData);
  if (!parsed.ok) return parsed.state;
  const { facility_id: facilityId, valid_to: validTo, ...rule } = parsed.data;

  const scheduleId = await scheduleFor(supabase, practitioner.id, facilityId);
  if (!scheduleId) return failed("notAffiliated");

  const { error } = await supabase
    .from("availability_rule")
    .insert({ ...rule, schedule_id: scheduleId, valid_to: validTo ?? null, mode: "in_person" });
  if (error) return failed("generic");

  if (!(await syncSchedule(supabase, scheduleId))) return failed("generic");
  refresh();
  redirect(AVAILABILITY_PATH);
}

export async function deleteRule(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await doctorContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { data } = await supabase
    .from("availability_rule")
    .delete()
    .eq("id", id.data)
    .select("schedule_id")
    .maybeSingle();
  if (!data) return failed("generic");

  if (!(await syncSchedule(supabase, data.schedule_id as string))) return failed("generic");
  refresh();
  return SAVED;
}

export async function addException(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await doctorContext();
  const parsed = parseExceptionForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase.from("schedule_exception").insert(parsed.data);
  if (error) return failed("generic");

  if (!(await syncSchedule(supabase, parsed.data.schedule_id))) return failed("generic");
  refresh();
  return SAVED;
}

export async function deleteException(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await doctorContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");

  const { data } = await supabase
    .from("schedule_exception")
    .delete()
    .eq("id", id.data)
    .select("schedule_id")
    .maybeSingle();
  if (!data) return failed("generic");

  if (!(await syncSchedule(supabase, data.schedule_id as string))) return failed("generic");
  refresh();
  return SAVED;
}

/**
 * Publishing opens a schedule to bookings by generating its slots. The
 * database refuses to publish for a practitioner without PRC verification;
 * trying anyway files a verification request with the internal team.
 */
export async function setPublished(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, practitioner } = await doctorContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("generic");
  const publish = formData.get("publish") === "true";

  // Still refused without PRC verification — but the attempt is recorded, so
  // the internal team sees this doctor waiting in their queue.
  if (publish && practitioner.prc_verified_at === null) {
    if (practitioner.verification_requested_at === null) {
      await supabase
        .from("practitioner")
        .update({ verification_requested_at: new Date().toISOString() })
        .eq("id", practitioner.id);
      refresh();
    }
    return failed("verificationRequested");
  }

  const { error } = await supabase.from("schedule").update({ is_published: publish }).eq("id", id.data);
  if (error) {
    return failed(error.code === BOOKING_ERROR_CODES.practitionerNotPrcVerified ? "prcNotVerified" : "generic");
  }

  if (!(await syncSchedule(supabase, id.data))) return failed("generic");
  refresh();
  return SAVED;
}
