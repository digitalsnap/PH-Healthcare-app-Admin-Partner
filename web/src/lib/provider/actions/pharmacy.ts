"use server";

import { revalidatePath } from "next/cache";
import { logAccess } from "@/lib/admin/audit";
import { failed, SAVED, type FormState } from "@/lib/admin/form-state";
import { bookingError } from "@/lib/scheduling/operations";
import { createAdminClient } from "@/lib/supabase/admin";
import { facilityContext, PROVIDER_HOME } from "../context";
import {
  parseRefillForm,
  parseRefillStatusForm,
  parseReservationForm,
  parseReservationStatusForm,
  parseStockForm,
  REFILL_NEXT,
  RESERVATION_NEXT,
  type RefillStatus,
  type ReservationStatus,
} from "../schemas";

type Supabase = Awaited<ReturnType<typeof facilityContext>>["supabase"];

function refresh() {
  revalidatePath(PROVIDER_HOME, "layout");
}

/**
 * "Confirmed today": a new stock report row, never an edit of an old one, so
 * the history of what was confirmed and when is kept.
 */
export async function confirmStock(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "stock");
  const parsed = parseStockForm(formData);
  if (!parsed.ok) return parsed.state;

  const { error } = await supabase.from("stock_report").insert({
    facility_id: facility.id,
    service_id: parsed.data.service_id,
    available: parsed.data.available,
    reporter_type: "pharmacy",
    reported_by: actorId,
  });
  if (error) return failed("generic");
  refresh();
  return SAVED;
}

/** A returning patient must be one this facility already serves. */
async function knownPatient(supabase: Supabase, patientId: string | null): Promise<boolean> {
  if (!patientId) return true;
  const { data } = await supabase.from("patient_profile").select("id").eq("id", patientId).maybeSingle();
  return data !== null;
}

/** Only medicines can be reserved or refilled. */
async function isMedicine(supabase: Supabase, serviceId: string): Promise<boolean> {
  const { data } = await supabase
    .from("service")
    .select("id")
    .eq("id", serviceId)
    .eq("service_type", "medicine")
    .maybeSingle();
  return data !== null;
}

/**
 * A hold for pickup, made at the counter with the patient's consent. It is not
 * a sale and not a prescription: the patient presents theirs when they collect.
 */
export async function createReservation(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "reservations");
  const parsed = parseReservationForm(formData);
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;
  if (!(await isMedicine(supabase, input.service_id))) return failed("invalidChoice");
  if (!(await knownPatient(supabase, input.patient_id))) return failed("patientRequired");

  const { error } = await createAdminClient().rpc("create_counter_reservation", {
    p_facility_id: facility.id,
    p_actor_id: actorId,
    p_service_id: input.service_id,
    p_quantity: input.quantity,
    p_hold_until: input.hold_until,
    p_patient_id: input.patient_id,
    p_full_name: input.full_name,
    p_phone: input.phone,
  });
  if (error) return failed(bookingError(error.code));
  refresh();
  return SAVED;
}

export async function setReservationStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "reservations");
  const parsed = parseReservationStatusForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data: current } = await supabase
    .from("reservation")
    .select("id, status, patient_id")
    .eq("id", parsed.data.id)
    .eq("facility_id", facility.id)
    .maybeSingle();
  if (!current) return failed("generic");
  if (!RESERVATION_NEXT[current.status as ReservationStatus].includes(parsed.data.status)) {
    return failed("transitionNotAllowed");
  }

  const { error } = await supabase.from("reservation").update({ status: parsed.data.status }).eq("id", current.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: `reservation.${parsed.data.status}`,
    resourceType: "reservation",
    resourceId: current.id,
    subjectPatientId: current.patient_id as string,
  });
  refresh();
  return SAVED;
}

export async function createRefillRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "refills");
  const parsed = parseRefillForm(formData);
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;
  if (!(await isMedicine(supabase, input.service_id))) return failed("invalidChoice");
  if (!(await knownPatient(supabase, input.patient_id))) return failed("patientRequired");

  const { error } = await createAdminClient().rpc("create_counter_refill_request", {
    p_facility_id: facility.id,
    p_actor_id: actorId,
    p_service_id: input.service_id,
    p_needed_by: input.needed_by,
    p_patient_id: input.patient_id,
    p_full_name: input.full_name,
    p_phone: input.phone,
  });
  if (error) return failed(bookingError(error.code));
  refresh();
  return SAVED;
}

export async function setRefillStatus(_previous: FormState, formData: FormData): Promise<FormState> {
  const { supabase, actorId, facility } = await facilityContext(formData.get("facility_id"), "refills");
  const parsed = parseRefillStatusForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data: current } = await supabase
    .from("refill_request")
    .select("id, status, patient_id")
    .eq("id", parsed.data.id)
    .eq("facility_id", facility.id)
    .maybeSingle();
  if (!current) return failed("generic");
  if (!REFILL_NEXT[current.status as RefillStatus].includes(parsed.data.status)) {
    return failed("transitionNotAllowed");
  }

  const { error } = await supabase.from("refill_request").update({ status: parsed.data.status }).eq("id", current.id);
  if (error) return failed(bookingError(error.code));

  await logAccess(supabase, actorId, {
    action: `refill_request.${parsed.data.status}`,
    resourceType: "refill_request",
    resourceId: current.id,
    subjectPatientId: current.patient_id as string,
  });
  refresh();
  return SAVED;
}
