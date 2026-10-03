import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  BOOK_SLOT_SQL,
  connect,
  createAppUser,
  createFixture,
  createPatient,
  createSlot,
  resetDatabase,
  testDatabaseUrl,
  type Fixture,
} from "./helpers";

const CHECK_VIOLATION = "23514";
const PERMISSION_DENIED = "42501";

describe.skipIf(!testDatabaseUrl)("doctor scheduling rules in the database", () => {
  let db: Client;
  let fixture: Fixture;
  let other: Fixture;
  let doctorId: string;
  let otherDoctorId: string;

  const book = async (slotId: string, patientId: string, on: Fixture = fixture) => {
    const result = await db.query<{ appointment_id: string }>(BOOK_SLOT_SQL, [
      slotId,
      patientId,
      on.staffId,
      on.serviceId,
    ]);
    return result.rows[0].appointment_id;
  };

  const slotRow = async (slotId: string) =>
    (await db.query<{ capacity: number; remaining: number }>(
      "select capacity, remaining from public.slot where id = $1",
      [slotId],
    )).rows[0];

  const pastSlot = async (scheduleId: string) =>
    (await db.query<{ id: string }>(
      `insert into public.slot (schedule_id, starts_at, ends_at, capacity, remaining, mode)
       values ($1, now() - interval '2 hours' - random() * interval '1 hour', now() - interval '1 hour', 1, 1, 'in_person')
       returning id`,
      [scheduleId],
    )).rows[0].id;

  beforeAll(async () => {
    await resetDatabase();
    db = await connect();
    fixture = await createFixture(db, { prcVerified: true });
    other = await createFixture(db, { prcVerified: true });
    doctorId = await createAppUser(db, "doctor");
    otherDoctorId = await createAppUser(db, "doctor");
    await db.query("update public.practitioner set app_user_id = $1 where id = $2", [
      doctorId,
      fixture.practitionerId,
    ]);
    await db.query("update public.practitioner set app_user_id = $1 where id = $2", [
      otherDoctorId,
      other.practitionerId,
    ]);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  describe("publishing a schedule", () => {
    it("is refused for a practitioner without PRC verification", async () => {
      const unverified = await createFixture(db, { prcVerified: false });
      await expect(
        db.query("update public.schedule set is_published = true where id = $1", [unverified.scheduleId]),
      ).rejects.toMatchObject({ code: "PH002" });
    });

    it("is allowed once PRC verification is recorded, and stamps the time", async () => {
      const result = await db.query<{ published_at: Date | null }>(
        "update public.schedule set is_published = true where id = $1 returning published_at",
        [fixture.scheduleId],
      );
      expect(result.rows[0].published_at).toBeInstanceOf(Date);
    });
  });

  describe("sync_schedule_slots", () => {
    const WINDOW = ["2031-03-03T00:00:00Z", "2031-03-10T00:00:00Z"] as const;
    const slot = (hour: number, capacity = 1) => ({
      starts_at: `2031-03-03T0${hour}:00:00Z`,
      ends_at: `2031-03-03T0${hour}:30:00Z`,
      capacity,
      mode: "in_person",
    });
    const sync = (slots: unknown[]) =>
      db.query<{ count: number }>("select public.sync_schedule_slots($1, $2, $3, $4) as count", [
        fixture.scheduleId,
        WINDOW[0],
        WINDOW[1],
        JSON.stringify(slots),
      ]);
    const starts = async () =>
      (await db.query<{ hour: number }>(
        `select extract(hour from starts_at at time zone 'UTC')::int as hour from public.slot
         where schedule_id = $1 and starts_at >= $2 and starts_at < $3 order by starts_at`,
        [fixture.scheduleId, WINDOW[0], WINDOW[1]],
      )).rows.map((row) => row.hour);

    it("writes the generated slots and is idempotent", async () => {
      expect((await sync([slot(1), slot(2), slot(3)])).rows[0].count).toBe(3);
      expect((await sync([slot(1), slot(2), slot(3)])).rows[0].count).toBe(3);
      expect(await starts()).toEqual([1, 2, 3]);
    });

    it("removes free slots the rules no longer produce, but never a booked one", async () => {
      const booked = await db.query<{ id: string }>(
        "select id from public.slot where schedule_id = $1 and starts_at = '2031-03-03T02:00:00Z'",
        [fixture.scheduleId],
      );
      await book(booked.rows[0].id, await createPatient(db));

      await sync([slot(1)]);
      expect(await starts()).toEqual([1, 2]);
    });

    it("never lets capacity fall below what is already booked", async () => {
      const id = (
        await db.query<{ id: string }>(
          "select id from public.slot where schedule_id = $1 and starts_at = '2031-03-03T02:00:00Z'",
          [fixture.scheduleId],
        )
      ).rows[0].id;

      await sync([slot(1), slot(2, 5)]);
      expect(await slotRow(id)).toEqual({ capacity: 5, remaining: 4 });

      await book(id, await createPatient(db));
      await sync([slot(1), slot(2, 1)]);
      expect(await slotRow(id)).toEqual({ capacity: 2, remaining: 0 });
    });

    it("rejects a slot outside the window it was asked to sync", async () => {
      await expect(
        sync([{ ...slot(1), starts_at: "2031-04-01T01:00:00Z", ends_at: "2031-04-01T01:30:00Z" }]),
      ).rejects.toMatchObject({ code: "PH008" });
    });

    it("cannot be called by a signed-in client, and clients cannot insert slots", async () => {
      await asUser(db, doctorId, async () => {
        await db.query("savepoint attempt");
        await expect(sync([slot(4)])).rejects.toMatchObject({ code: PERMISSION_DENIED });
        await db.query("rollback to savepoint attempt");
        await expect(
          db.query(
            `insert into public.slot (schedule_id, starts_at, ends_at, capacity, remaining, mode)
             values ($1, '2031-05-01T01:00:00Z', '2031-05-01T01:30:00Z', 1, 1, 'in_person')`,
            [fixture.scheduleId],
          ),
        ).rejects.toMatchObject({ code: PERMISSION_DENIED });
      });
    });
  });

  describe("appointment state changes", () => {
    it("assigns a readable six-character booking code", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db));
      const code = await db.query<{ booking_code: string }>(
        "select booking_code from public.appointment where id = $1",
        [id],
      );
      expect(code.rows[0].booking_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    });

    it("refuses to skip a step", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db));
      await expect(
        db.query("update public.appointment set status = 'seen' where id = $1", [id]),
      ).rejects.toMatchObject({ code: "PH009" });
    });

    it("refuses a no-show before the slot has started, and allows it after", async () => {
      const future = await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db));
      await expect(
        db.query("update public.appointment set status = 'no_show' where id = $1", [future]),
      ).rejects.toMatchObject({ code: "PH010" });

      const past = await book(await pastSlot(fixture.scheduleId), await createPatient(db));
      await db.query("update public.appointment set status = 'no_show' where id = $1", [past]);
      const events = await db.query<{ event: string }>(
        "select event from public.appointment_event where appointment_id = $1 order by at, event",
        [past],
      );
      expect(events.rows.map((row) => row.event)).toEqual(["booked", "no_show"]);
    });

    it("requires a reason to cancel, and treats cancelled as final", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db));
      await expect(
        db.query("update public.appointment set status = 'cancelled' where id = $1", [id]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });

      await db.query(
        "update public.appointment set status = 'cancelled', cancel_reason = 'patient_request' where id = $1",
        [id],
      );
      await expect(
        db.query("update public.appointment set status = 'booked', cancel_reason = null where id = $1", [id]),
      ).rejects.toMatchObject({ code: "PH009" });
    });

    it("only reschedules a booked appointment, and only into the future", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db));
      await expect(
        db.query("update public.appointment set slot_id = $1 where id = $2", [
          await pastSlot(fixture.scheduleId),
          id,
        ]),
      ).rejects.toMatchObject({ code: "PH012" });

      const checkedIn = await book(await pastSlot(fixture.scheduleId), await createPatient(db));
      await db.query("update public.appointment set status = 'checked_in' where id = $1", [checkedIn]);
      await expect(
        db.query("update public.appointment set slot_id = $1 where id = $2", [
          await createSlot(db, fixture.scheduleId, 1),
          checkedIn,
        ]),
      ).rejects.toMatchObject({ code: "PH011" });
    });

    it("moves the appointment to the new slot's clinic when rescheduled across clinics", async () => {
      const secondClinic = (
        await db.query<{ id: string }>(
          `insert into public.facility (name, facility_type, region_code, province_code, municipality_code)
           values ('Second Clinic', 'private_clinic', '9900000000', '9901000000', '9901001000') returning id`,
        )
      ).rows[0].id;
      const secondSchedule = (
        await db.query<{ id: string }>(
          "insert into public.schedule (practitioner_id, facility_id) values ($1, $2) returning id",
          [fixture.practitionerId, secondClinic],
        )
      ).rows[0].id;

      const id = await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db));
      await db.query("update public.appointment set slot_id = $1 where id = $2", [
        await createSlot(db, secondSchedule, 1),
        id,
      ]);
      const moved = await db.query<{ facility_id: string }>(
        "select facility_id from public.appointment where id = $1",
        [id],
      );
      expect(moved.rows[0].facility_id).toBe(secondClinic);
    });

    it("two reschedules racing for the last seat: exactly one wins", async () => {
      const target = await createSlot(db, fixture.scheduleId, 1);
      const appointments = [
        await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db)),
        await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db)),
      ];

      const outcomes = await Promise.all(
        appointments.map(async (id) => {
          const client = await connect();
          try {
            await client.query("update public.appointment set slot_id = $1 where id = $2", [target, id]);
            return "moved";
          } catch (error) {
            return (error as { code?: string }).code;
          } finally {
            await client.end();
          }
        }),
      );

      expect(outcomes.sort()).toEqual(["PH001", "moved"]);
      expect(await slotRow(target)).toEqual({ capacity: 1, remaining: 0 });
    });
  });

  describe("SMS outbox", () => {
    const messages = async (appointmentId: string) =>
      (await db.query<{ template: string; status: string; params: Record<string, unknown>; to_phone: string }>(
        "select template, status, params, to_phone from public.sms_message where appointment_id = $1 order by created_at, template",
        [appointmentId],
      )).rows;

    const patientWithPhone = async () =>
      (await db.query<{ id: string }>(
        "insert into public.patient_profile (full_name, phone) values ('Synthetic Patient', '+639170000000') returning id",
      )).rows[0].id;

    it("queues a confirmation and a day-before reminder when booked", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await patientWithPhone());
      const rows = await messages(id);
      expect(rows.map((row) => [row.template, row.status]).sort()).toEqual([
        ["appointment_reminder", "queued"],
        ["booking_confirmed", "queued"],
      ]);
      // Ids, times and the facility only: never the patient's name.
      expect(Object.keys(rows[0].params).sort()).toEqual(["booking_code", "facility_name", "mode", "starts_at"]);
      expect(String(rows[0].params.starts_at)).toMatch(/^2030-01-07T\d\d:00:00Z$/);
      expect(JSON.stringify(rows)).not.toContain("Synthetic Patient");
    });

    it("replaces the reminder and sends a notice on reschedule", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await patientWithPhone());
      await db.query("update public.appointment set slot_id = $1 where id = $2", [
        await createSlot(db, fixture.scheduleId, 1),
        id,
      ]);
      const rows = await messages(id);
      expect(rows.map((row) => `${row.template}:${row.status}`).sort()).toEqual([
        "appointment_reminder:cancelled",
        "appointment_reminder:queued",
        "booking_confirmed:queued",
        "booking_rescheduled:queued",
      ]);
    });

    it("cancels the reminder and sends a notice on cancel", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await patientWithPhone());
      await db.query(
        "update public.appointment set status = 'cancelled', cancel_reason = 'practitioner_unavailable' where id = $1",
        [id],
      );
      const rows = await messages(id);
      expect(rows.map((row) => `${row.template}:${row.status}`).sort()).toEqual([
        "appointment_reminder:cancelled",
        "booking_cancelled:queued",
        "booking_confirmed:queued",
      ]);
    });

    it("queues nothing for a patient without a phone number", async () => {
      const id = await book(await createSlot(db, fixture.scheduleId, 1), await createPatient(db));
      expect(await messages(id)).toEqual([]);
    });
  });

  describe("walk-in booking", () => {
    const walkIn = (slotId: string, name: string | null, patientId: string | null = null) =>
      db.query<{ id: string; patient_id: string }>(
        "select * from public.book_walk_in($1, $2, $3, $4, $5, $6)",
        [slotId, doctorId, fixture.serviceId, patientId, name, "+639170000001"],
      );

    it("registers the patient, records consent and books, attributed to the doctor", async () => {
      const result = await walkIn(await createSlot(db, fixture.scheduleId, 1), "Synthetic Walk-in");
      const { id, patient_id: patientId } = result.rows[0];

      const log = await db.query<{ action: string }>(
        "select action from public.access_log where subject_patient_id = $1 and actor_id = $2 order by at, action",
        [patientId, doctorId],
      );
      expect(log.rows.map((row) => row.action).sort()).toEqual(["appointment.create", "counter_consent.record"]);

      const appointment = await db.query(
        "select booked_by, channel, patient_id from public.appointment where id = $1",
        [id],
      );
      expect(appointment.rows[0]).toEqual({ booked_by: doctorId, channel: "assisted_counter", patient_id: patientId });

      const event = await db.query<{ actor_id: string }>(
        "select actor_id from public.appointment_event where appointment_id = $1",
        [id],
      );
      expect(event.rows[0].actor_id).toBe(doctorId);
    });

    it("leaves nothing behind when the slot is full", async () => {
      const slotId = await createSlot(db, fixture.scheduleId, 1);
      await walkIn(slotId, "Synthetic First");
      const before = await db.query("select count(*) from public.patient_profile");
      await expect(walkIn(slotId, "Synthetic Second")).rejects.toMatchObject({ code: "PH001" });
      const after = await db.query("select count(*) from public.patient_profile");
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    it("needs a name for a new patient", async () => {
      await expect(walkIn(await createSlot(db, fixture.scheduleId, 1), "  ")).rejects.toMatchObject({
        code: "PH013",
      });
    });
  });

  describe("row-level security for doctors", () => {
    let mine: string;
    let theirs: string;
    let mySlot: string;

    beforeAll(async () => {
      mySlot = await createSlot(db, fixture.scheduleId, 1);
      mine = await book(mySlot, await createPatient(db));
      theirs = await book(await createSlot(db, other.scheduleId, 1), await createPatient(db), other);
    });

    it("shows a doctor their own appointments and those patients, nobody else's", async () => {
      await asUser(db, doctorId, async () => {
        const rows = await db.query<{ id: string; patient_name: string }>(
          "select id, patient_name from public.practitioner_appointment_view where id = any($1)",
          [[mine, theirs]],
        );
        expect(rows.rows).toEqual([{ id: mine, patient_name: "Synthetic Patient" }]);

        const patients = await db.query(
          "select count(*)::int as count from public.patient_profile p join public.appointment a on a.patient_id = p.id where a.id = $1",
          [theirs],
        );
        expect(patients.rows[0].count).toBe(0);
      });
    });

    it("lets a doctor cancel their own appointment, freeing the seat and logging the event", async () => {
      await asUser(db, doctorId, async () => {
        const result = await db.query(
          "update public.appointment set status = 'cancelled', cancel_reason = 'practitioner_unavailable' where id = $1",
          [mine],
        );
        expect(result.rowCount).toBe(1);
        expect(await slotRow(mySlot)).toEqual({ capacity: 1, remaining: 1 });
        const event = await db.query<{ event: string; actor_id: string }>(
          "select event, actor_id from public.appointment_event where appointment_id = $1 and event = 'cancelled'",
          [mine],
        );
        expect(event.rows).toEqual([{ event: "cancelled", actor_id: doctorId }]);
      });
    });

    it("does not let a doctor touch another doctor's appointment", async () => {
      await asUser(db, doctorId, async () => {
        const result = await db.query(
          "update public.appointment set status = 'cancelled', cancel_reason = 'other' where id = $1",
          [theirs],
        );
        expect(result.rowCount).toBe(0);
      });
    });

    it("lets a doctor edit specialties but never their own PRC status", async () => {
      await asUser(db, doctorId, async () => {
        const ok = await db.query(
          "update public.practitioner set specialties = '{Pediatrics}' where id = $1",
          [fixture.practitionerId],
        );
        expect(ok.rowCount).toBe(1);
        await expect(
          db.query("update public.practitioner set prc_licence_expires_on = '2099-01-01' where id = $1", [
            fixture.practitionerId,
          ]),
        ).rejects.toMatchObject({ code: "PH006" });
      });
    });

    it("lets a doctor request an affiliation but never approve it", async () => {
      const clinic = (
        await db.query<{ id: string }>(
          `insert into public.facility (name, facility_type, region_code, province_code, municipality_code)
           values ('Requested Clinic', 'private_clinic', '9900000000', '9901000000', '9901001000') returning id`,
        )
      ).rows[0].id;
      const request = (status: string) =>
        db.query(
          "insert into public.practitioner_facility (practitioner_id, facility_id, status) values ($1, $2, $3)",
          [fixture.practitionerId, clinic, status],
        );
      const newSchedule = () =>
        db.query("insert into public.schedule (practitioner_id, facility_id) values ($1, $2)", [
          fixture.practitionerId,
          clinic,
        ]);

      await asUser(db, doctorId, async () => {
        // Cannot grant themselves an approved affiliation.
        await db.query("savepoint s1");
        await expect(request("approved")).rejects.toMatchObject({ code: PERMISSION_DENIED });
        await db.query("rollback to savepoint s1");

        expect((await request("pending")).rowCount).toBe(1);

        // Cannot flip their own request to approved.
        const flip = await db.query(
          "update public.practitioner_facility set status = 'approved', decided_at = now(), decided_by = $1 where facility_id = $2",
          [doctorId, clinic],
        );
        expect(flip.rowCount).toBe(0);

        // No schedule at a clinic that has not been approved.
        await db.query("savepoint s2");
        await expect(newSchedule()).rejects.toMatchObject({ code: PERMISSION_DENIED });
        await db.query("rollback to savepoint s2");
      });

      // Staff approve; then the doctor can open a schedule there.
      await request("pending");
      await asUser(db, fixture.staffId, async () => {
        const approved = await db.query(
          "update public.practitioner_facility set status = 'approved', decided_at = now(), decided_by = $1 where facility_id = $2",
          [fixture.staffId, clinic],
        );
        expect(approved.rowCount).toBe(1);
      });
      await db.query(
        "update public.practitioner_facility set status = 'approved', decided_at = now(), decided_by = $1 where facility_id = $2",
        [fixture.staffId, clinic],
      );
      await asUser(db, doctorId, async () => {
        expect((await newSchedule()).rowCount).toBe(1);
      });
    });

    it("lets an unverified doctor record a verification request, nothing more", async () => {
      const unverified = await createFixture(db, { prcVerified: false });
      const login = await createAppUser(db, "doctor");
      await db.query("update public.practitioner set app_user_id = $1 where id = $2", [
        login,
        unverified.practitionerId,
      ]);
      await asUser(db, login, async () => {
        const asked = await db.query(
          "update public.practitioner set verification_requested_at = now() where id = $1",
          [unverified.practitionerId],
        );
        expect(asked.rowCount).toBe(1);
        await expect(
          db.query("update public.practitioner set prc_verified_at = now(), prc_verified_by = $1 where id = $2", [
            login,
            unverified.practitionerId,
          ]),
        ).rejects.toMatchObject({ code: "PH006" });
      });
    });

    it("lets a doctor manage rules on their own schedule only", async () => {
      const insertRule = (scheduleId: string) =>
        db.query(
          `insert into public.availability_rule
             (schedule_id, weekday, start_time, end_time, slot_minutes, valid_from)
           values ($1, 1, '09:00', '12:00', 30, '2030-01-01')`,
          [scheduleId],
        );
      await asUser(db, doctorId, async () => {
        expect((await insertRule(fixture.scheduleId)).rowCount).toBe(1);
        await expect(insertRule(other.scheduleId)).rejects.toMatchObject({ code: PERMISSION_DENIED });
      });
    });
  });
});
