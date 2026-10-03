import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  connect,
  createAppUser,
  createFixture,
  createPatient,
  createSlot,
  resetDatabase,
  testDatabaseUrl,
  type Fixture,
} from "./helpers";

const PERMISSION_DENIED = "42501";

describe.skipIf(!testDatabaseUrl)("provider portal rules in the database", () => {
  let db: Client;
  let fixture: Fixture;
  let orgA: string;
  let orgB: string;
  let pharmacyA: string;
  let labA: string;
  let labB: string;
  let staffA: string;
  let staffB: string;
  let medicine: string;
  let labSchedule: string;

  const id = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(`${sql} returning id`, params)).rows[0].id;

  const facility = (name: string, type: string, org: string) =>
    id(
      `insert into public.facility (name, facility_type, parent_org_id, region_code, province_code, municipality_code)
       values ($1, $2, $3, '9900000000', '9901000000', '9901001000')`,
      [name, type, org],
    );

  /** Runs one statement as a user and reports its SQLSTATE instead of throwing. */
  const attempt = (userId: string, sql: string, params: unknown[] = []) =>
    asUser(db, userId, async () => {
      try {
        const result = await db.query(sql, params);
        return { rowCount: result.rowCount, rows: result.rows, code: null as string | null };
      } catch (error) {
        return { rowCount: 0, rows: [], code: (error as { code?: string }).code ?? "unknown" };
      }
    });

  beforeAll(async () => {
    await resetDatabase();
    db = await connect();
    fixture = await createFixture(db, { prcVerified: true });
    orgA = await id("insert into public.organization (name) values ('Synthetic Chain A')");
    orgB = await id("insert into public.organization (name) values ('Synthetic Chain B')");
    pharmacyA = await facility("Pharmacy A", "pharmacy", orgA);
    labA = await facility("Lab A", "diagnostic_center", orgA);
    labB = await facility("Lab B", "diagnostic_center", orgB);
    staffA = await createAppUser(db, "provider_staff");
    staffB = await createAppUser(db, "provider_staff");
    await db.query(
      "insert into public.organization_staff (organization_id, app_user_id) values ($1, $2), ($3, $4)",
      [orgA, staffA, orgB, staffB],
    );
    medicine = await id(
      "insert into public.service (service_type, name) values ('medicine', 'Synthetic Medicine')",
    );
    labSchedule = await id(
      "insert into public.schedule (facility_id, facility_resource) values ($1, 'Collection room')",
      [labA],
    );
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  describe("who can manage a facility", () => {
    it("shows staff every facility of their organization and none of another's", async () => {
      const seen = await attempt(
        staffA,
        "select name from public.facility where parent_org_id is not null order by name",
      );
      expect(seen.rows.map((row) => row.name)).toEqual(["Lab A", "Pharmacy A"]);
    });

    it("lets staff keep contact details current but not their own verification", async () => {
      const phone = await attempt(staffA, "update public.facility set phone = '0431234567' where id = $1", [labA]);
      expect(phone.rowCount).toBe(1);
      const verify = await attempt(
        staffA,
        "update public.facility set verification_status = 'verified', last_verified_at = now() where id = $1",
        [labA],
      );
      expect(verify.code).toBe("PH015");
      const rename = await attempt(staffA, "update public.facility set name = 'Bigger Lab' where id = $1", [labA]);
      expect(rename.code).toBe("PH015");
    });

    it("does not let staff touch another organization's facility", async () => {
      const result = await attempt(staffA, "update public.facility set phone = '000' where id = $1", [labB]);
      expect(result.rowCount).toBe(0);
    });

    it("stops as soon as the account is deactivated or loses the provider role", async () => {
      const count = () => attempt(staffA, "select count(*)::int as n from public.price_item where facility_id = $1", [labA]);
      await db.query(
        `insert into public.price_item (service_id, facility_id, amount_min_centavos, amount_max_centavos, source, observed_at)
         values ($1, $2, 1000, 2000, 'facility_confirmed', now())`,
        [fixture.serviceId, labA],
      );
      expect((await count()).rows[0].n).toBe(1);

      await db.query("update public.app_user set is_active = false where id = $1", [staffA]);
      expect((await count()).rows[0].n).toBe(0);
      await db.query("update public.app_user set is_active = true, role = 'doctor' where id = $1", [staffA]);
      expect((await count()).rows[0].n).toBe(0);
      await db.query("update public.app_user set role = 'provider_staff' where id = $1", [staffA]);
      expect((await count()).rows[0].n).toBe(1);
    });
  });

  describe("catalogue and stock", () => {
    const price = (facilityId: string) =>
      attempt(
        staffA,
        `insert into public.price_item (service_id, facility_id, amount_min_centavos, amount_max_centavos, source, observed_at)
         values ($1, $2, 35000, 50000, 'facility_confirmed', now())`,
        [fixture.serviceId, facilityId],
      );

    it("lets staff price services at their own facility only", async () => {
      expect((await price(labA)).rowCount).toBe(1);
      expect((await price(labB)).code).toBe(PERMISSION_DENIED);
    });

    it("lets staff write preparation instructions for their facility, not the shared defaults", async () => {
      const prep = (facilityId: string | null) =>
        attempt(
          staffA,
          "insert into public.service_prep (service_id, facility_id, locale, instructions, fasting_hours) values ($1, $2, 'en', 'Fast for 8 hours', 8)",
          [fixture.serviceId, facilityId],
        );
      expect((await prep(labA)).rowCount).toBe(1);
      expect((await prep(null)).code).toBe(PERMISSION_DENIED);
      expect((await prep(labB)).code).toBe(PERMISSION_DENIED);
    });

    it("accepts a stock report only from the pharmacy's own staff, as themselves", async () => {
      const report = (facilityId: string, reporterType: string, reportedBy: string) =>
        attempt(
          staffA,
          "insert into public.stock_report (facility_id, service_id, available, reporter_type, reported_by) values ($1, $2, true, $3, $4)",
          [facilityId, medicine, reporterType, reportedBy],
        );
      expect((await report(pharmacyA, "pharmacy", staffA)).rowCount).toBe(1);
      expect((await report(pharmacyA, "staff", staffA)).code).toBe(PERMISSION_DENIED);
      expect((await report(pharmacyA, "pharmacy", staffB)).code).toBe(PERMISSION_DENIED);
      expect((await report(labB, "pharmacy", staffA)).code).toBe(PERMISSION_DENIED);
    });
  });

  describe("scheduling facility resources", () => {
    it("lets staff open a resource schedule at their facility only, and never a doctor's", async () => {
      const schedule = (facilityId: string, practitionerId: string | null, resource: string | null) =>
        attempt(
          staffA,
          "insert into public.schedule (facility_id, practitioner_id, facility_resource) values ($1, $2, $3)",
          [facilityId, practitionerId, resource],
        );
      expect((await schedule(labA, null, "X-ray room")).rowCount).toBe(1);
      expect((await schedule(labB, null, "X-ray room")).code).toBe(PERMISSION_DENIED);
      expect((await schedule(labA, fixture.practitionerId, null)).code).toBe(PERMISSION_DENIED);
    });

    it("publishes a resource schedule without any PRC check", async () => {
      const result = await attempt(staffA, "update public.schedule set is_published = true where id = $1", [
        labSchedule,
      ]);
      expect(result.rowCount).toBe(1);
    });
  });

  describe("bookings and home service", () => {
    const walkIn = (slotId: string, home: boolean, address: string | null) =>
      db.query<{ id: string; patient_id: string; home_service: boolean; facility_id: string }>(
        "select * from public.book_walk_in($1, $2, $3, null, 'Synthetic Counter Patient', null, $4, $5, null, 'Blue gate')",
        [slotId, staffA, fixture.serviceId, home, address],
      );

    it("books a home-service visit with its address, visible to that facility only", async () => {
      const booked = (await walkIn(await createSlot(db, labSchedule, 1), true, "12 Synthetic St")).rows[0];
      expect(booked).toMatchObject({ home_service: true, facility_id: labA });

      const visit = (userId: string) =>
        attempt(userId, "select address_line, landmark from public.appointment_home_visit where appointment_id = $1", [
          booked.id,
        ]);
      expect((await visit(staffA)).rows).toEqual([{ address_line: "12 Synthetic St", landmark: "Blue gate" }]);
      expect((await visit(staffB)).rows).toEqual([]);

      const patient = (userId: string) =>
        attempt(userId, "select full_name from public.patient_profile where id = $1", [booked.patient_id]);
      expect((await patient(staffA)).rows).toHaveLength(1);
      expect((await patient(staffB)).rows).toHaveLength(0);
    });

    it("refuses a home-service booking without an address, leaving nothing behind", async () => {
      const before = await db.query("select count(*) from public.patient_profile");
      await expect(walkIn(await createSlot(db, labSchedule, 1), true, "  ")).rejects.toMatchObject({
        code: "PH016",
      });
      const after = await db.query("select count(*) from public.patient_profile");
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    it("lets the front desk run the visit for its own facility's appointments only", async () => {
      const mine = (await walkIn(await createSlot(db, labSchedule, 1), false, null)).rows[0].id;
      const theirs = (
        await db.query<{ appointment_id: string }>(
          "select (public.book_slot($1, $2, $3, 'assisted_counter', $4)).id as appointment_id",
          [await createSlot(db, fixture.scheduleId, 1), await createPatient(db), fixture.staffId, fixture.serviceId],
        )
      ).rows[0].appointment_id;

      const cancel = (appointmentId: string) =>
        attempt(
          staffA,
          "update public.appointment set status = 'cancelled', cancel_reason = 'facility_closed' where id = $1",
          [appointmentId],
        );
      expect((await cancel(mine)).rowCount).toBe(1);
      expect((await cancel(theirs)).rowCount).toBe(0);
    });
  });

  describe("pharmacy reservations and refills", () => {
    const reserve = () =>
      db.query<{ id: string; patient_id: string; status: string }>(
        "select * from public.create_counter_reservation($1, $2, $3, 2, now() + interval '2 days', null, 'Synthetic Reserver', null)",
        [pharmacyA, staffA, medicine],
      );
    const setStatus = (userId: string, table: string, rowId: string, status: string) =>
      attempt(userId, `update public.${table} set status = $1 where id = $2`, [status, rowId]);

    it("creates a counter reservation with consent and a log entry", async () => {
      const reservation = (await reserve()).rows[0];
      expect(reservation.status).toBe("reserved");
      const log = await db.query<{ action: string }>(
        "select action from public.access_log where subject_patient_id = $1 order by action",
        [reservation.patient_id],
      );
      expect(log.rows.map((row) => row.action)).toEqual(["counter_consent.record", "reservation.create"]);
    });

    it("walks a reservation through ready and picked up, and refuses to skip or reopen", async () => {
      const { id: reservationId } = (await reserve()).rows[0];
      expect((await setStatus(staffA, "reservation", reservationId, "picked_up")).code).toBe("PH009");
      // attempt() rolls back, so persist each legal step as the owner.
      await db.query("update public.reservation set status = 'ready' where id = $1", [reservationId]);
      expect((await setStatus(staffA, "reservation", reservationId, "picked_up")).rowCount).toBe(1);
      await db.query("update public.reservation set status = 'picked_up' where id = $1", [reservationId]);
      expect((await setStatus(staffA, "reservation", reservationId, "reserved")).code).toBe("PH009");
    });

    it("keeps another organization out of the reservation and its patient", async () => {
      const reservation = (await reserve()).rows[0];
      expect((await setStatus(staffB, "reservation", reservation.id, "ready")).rowCount).toBe(0);
      const seen = await attempt(staffB, "select id from public.reservation where id = $1", [reservation.id]);
      expect(seen.rows).toEqual([]);
    });

    it("walks a refill request through its steps and allows declining only at the start", async () => {
      const request = (
        await db.query<{ id: string }>(
          "select * from public.create_counter_refill_request($1, $2, $3, current_date + 7, null, 'Synthetic Refiller', null)",
          [pharmacyA, staffA, medicine],
        )
      ).rows[0];
      expect((await setStatus(staffA, "refill_request", request.id, "ready")).code).toBe("PH009");
      expect((await setStatus(staffA, "refill_request", request.id, "declined")).rowCount).toBe(1);
      await db.query("update public.refill_request set status = 'accepted' where id = $1", [request.id]);
      expect((await setStatus(staffA, "refill_request", request.id, "declined")).code).toBe("PH009");
      expect((await setStatus(staffA, "refill_request", request.id, "ready")).rowCount).toBe(1);
    });

    it("cannot be called by a signed-in client directly", async () => {
      const result = await attempt(
        staffA,
        "select * from public.create_counter_reservation($1, $2, $3, 1, now() + interval '1 day', null, 'X', null)",
        [pharmacyA, staffA, medicine],
      );
      expect(result.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("result delivery to the vault", () => {
    let appointmentId: string;
    let patientId: string;

    beforeAll(async () => {
      const booked = await db.query<{ id: string; patient_id: string }>(
        "select * from public.book_walk_in($1, $2, $3, null, 'Synthetic Lab Patient', null)",
        [await createSlot(db, labSchedule, 1), staffA, fixture.serviceId],
      );
      appointmentId = booked.rows[0].id;
      patientId = booked.rows[0].patient_id;
    });

    const deliver = (userId: string, facilityId: string, forPatient: string, forAppointment: string) =>
      attempt(
        userId,
        `insert into public.vault_document
           (patient_id, document_type, storage_path, mime_type, size_bytes, appointment_id, facility_id, uploaded_by)
         values ($1, 'lab_result', $2::text || '/' || gen_random_uuid(), 'application/pdf', 1000, $3, $2::uuid, $4)`,
        [forPatient, facilityId, forAppointment, userId],
      );

    it("lets a facility deliver a result for an appointment the patient had there", async () => {
      expect((await deliver(staffA, labA, patientId, appointmentId)).rowCount).toBe(1);
    });

    it("refuses a result for a patient who had no appointment with that facility", async () => {
      const stranger = await createPatient(db);
      expect((await deliver(staffA, labA, stranger, appointmentId)).code).toBe(PERMISSION_DENIED);
      expect((await deliver(staffB, labB, patientId, appointmentId)).code).toBe(PERMISSION_DENIED);
    });

    it("only accepts PDF and image files", async () => {
      await expect(
        db.query(
          `insert into public.vault_document
             (patient_id, document_type, storage_path, mime_type, size_bytes, uploaded_by)
           values ($1, 'lab_result', 'x', 'application/x-msdownload', 10, $2)`,
          [patientId, staffA],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("confines stored files to the facility's own folder in the private bucket", async () => {
      const bucket = await db.query<{ public: boolean }>("select public from storage.buckets where id = 'vault'");
      expect(bucket.rows).toEqual([{ public: false }]);

      const put = (userId: string, path: string) =>
        attempt(userId, "insert into storage.objects (bucket_id, name) values ('vault', $1)", [path]);
      const file = "0b9f5b0e-6a55-4f0a-9d53-2f6a3f1f7c11";
      expect((await put(staffA, `${labA}/${file}`)).rowCount).toBe(1);
      expect((await put(staffA, `${labB}/${file}`)).code).toBe(PERMISSION_DENIED);
      expect((await put(staffA, `../${labA}/${file}`)).code).toBe(PERMISSION_DENIED);
      expect((await put(staffA, `${labA}/nested/${file}`)).code).toBe(PERMISSION_DENIED);
      expect((await put(staffB, `${labA}/${file}`)).code).toBe(PERMISSION_DENIED);

      await db.query("insert into storage.objects (bucket_id, name) values ('vault', $1)", [`${labA}/${file}`]);
      const read = (userId: string) =>
        attempt(userId, "select name from storage.objects where bucket_id = 'vault'");
      expect((await read(staffA)).rows).toHaveLength(1);
      expect((await read(staffB)).rows).toHaveLength(0);
    });
  });
});
