import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOKING_ERROR_CODES } from "@/lib/scheduling";
import {
  BOOK_SLOT_SQL,
  connect,
  createFixture,
  createPatient,
  createSlot,
  resetDatabase,
  testDatabaseUrl,
  type Fixture,
} from "./helpers";

const UNIQUE_VIOLATION = "23505";

type Outcome = { ok: true; appointmentId: string } | { ok: false; code: string | undefined };

/** Books on a dedicated connection, so every attempt is its own transaction. */
async function bookOnOwnConnection(slotId: string, patientId: string, fixture: Fixture): Promise<Outcome> {
  const client = await connect();
  try {
    const result = await client.query<{ appointment_id: string }>(BOOK_SLOT_SQL, [
      slotId,
      patientId,
      fixture.staffId,
      fixture.serviceId,
    ]);
    return { ok: true, appointmentId: result.rows[0].appointment_id };
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code };
  } finally {
    await client.end();
  }
}

async function slotState(db: Client, slotId: string) {
  const slot = await db.query<{ remaining: number }>(
    "select remaining from public.slot where id = $1",
    [slotId],
  );
  const seats = await db.query<{ seat_no: number }>(
    "select seat_no from public.appointment where slot_id = $1 and status <> 'cancelled' order by seat_no",
    [slotId],
  );
  return { remaining: slot.rows[0].remaining, seats: seats.rows.map((row) => row.seat_no) };
}

describe.skipIf(!testDatabaseUrl)("concurrent slot booking", () => {
  let db: Client;
  let fixture: Fixture;

  beforeAll(async () => {
    await resetDatabase();
    db = await connect();
    fixture = await createFixture(db, { prcVerified: true });
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  it("two simultaneous bookings on a one-capacity slot: exactly one wins", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    const patients = [await createPatient(db), await createPatient(db)];

    const outcomes = await Promise.all(
      patients.map((patientId) => bookOnOwnConnection(slotId, patientId, fixture)),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, code: BOOKING_ERROR_CODES.slotFull },
    ]);
    expect(await slotState(db, slotId)).toEqual({ remaining: 0, seats: [1] });
  });

  it("the second booking waits on the first transaction's lock, then loses", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    const [patientA, patientB] = [await createPatient(db), await createPatient(db)];
    const first = await connect();

    try {
      // First transaction books and stays open, holding the slot's row lock.
      await first.query("begin");
      await first.query(BOOK_SLOT_SQL, [slotId, patientA, fixture.staffId, fixture.serviceId]);

      let secondSettled = false;
      const second = bookOnOwnConnection(slotId, patientB, fixture).finally(() => {
        secondSettled = true;
      });

      // The second cannot decide anything while the first is uncommitted.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondSettled).toBe(false);

      await first.query("commit");
      expect(await second).toEqual({ ok: false, code: BOOKING_ERROR_CODES.slotFull });
    } finally {
      await first.end();
    }

    expect(await slotState(db, slotId)).toEqual({ remaining: 0, seats: [1] });
  });

  it("if the first transaction rolls back, the waiting booking wins instead", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    const [patientA, patientB] = [await createPatient(db), await createPatient(db)];
    const first = await connect();

    try {
      await first.query("begin");
      await first.query(BOOK_SLOT_SQL, [slotId, patientA, fixture.staffId, fixture.serviceId]);
      const second = bookOnOwnConnection(slotId, patientB, fixture);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await first.query("rollback");
      expect((await second).ok).toBe(true);
    } finally {
      await first.end();
    }

    expect(await slotState(db, slotId)).toEqual({ remaining: 0, seats: [1] });
  });

  it("twelve simultaneous bookings on a three-capacity session: exactly three win", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 3);
    const patients: string[] = [];
    for (let i = 0; i < 12; i += 1) patients.push(await createPatient(db));

    const outcomes = await Promise.all(
      patients.map((patientId) => bookOnOwnConnection(slotId, patientId, fixture)),
    );

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(3);
    for (const outcome of outcomes) {
      if (!outcome.ok) expect(outcome.code).toBe(BOOKING_ERROR_CODES.slotFull);
    }
    expect(await slotState(db, slotId)).toEqual({ remaining: 0, seats: [1, 2, 3] });
  });

  it("direct inserts that bypass book_slot still cannot share a seat", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    const patients = [await createPatient(db), await createPatient(db)];

    const outcomes = await Promise.all(
      patients.map(async (patientId) => {
        const client = await connect();
        try {
          await client.query(
            `insert into public.appointment
               (patient_id, booked_by, channel, mode, facility_id, service_id, slot_id, seat_no)
             values ($1, $2, 'assisted_counter', 'in_person', $3, $4, $5, 1)`,
            [patientId, fixture.staffId, fixture.facilityId, fixture.serviceId, slotId],
          );
          return "ok";
        } catch (error) {
          return (error as { code?: string }).code;
        } finally {
          await client.end();
        }
      }),
    );

    expect(outcomes.sort()).toEqual([UNIQUE_VIOLATION, "ok"].sort());
    expect(await slotState(db, slotId)).toEqual({ remaining: 0, seats: [1] });
  });

  it("rejects a seat number beyond the slot's capacity", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    const patientId = await createPatient(db);

    await expect(
      db.query(
        `insert into public.appointment
           (patient_id, booked_by, channel, mode, facility_id, service_id, slot_id, seat_no)
         values ($1, $2, 'assisted_counter', 'in_person', $3, $4, $5, 2)`,
        [patientId, fixture.staffId, fixture.facilityId, fixture.serviceId, slotId],
      ),
    ).rejects.toMatchObject({ code: BOOKING_ERROR_CODES.slotFull });
  });

  it("writes an event for every state change, and a cancel frees the seat", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    const [patientA, patientB] = [await createPatient(db), await createPatient(db)];

    const booked = await bookOnOwnConnection(slotId, patientA, fixture);
    if (!booked.ok) throw new Error("expected the booking to succeed");

    await db.query("update public.appointment set status = 'cancelled', cancel_reason = 'patient_request' where id = $1", [
      booked.appointmentId,
    ]);
    expect(await slotState(db, slotId)).toEqual({ remaining: 1, seats: [] });

    const events = await db.query<{ event: string }>(
      "select event from public.appointment_event where appointment_id = $1 order by at, event",
      [booked.appointmentId],
    );
    expect(events.rows.map((row) => row.event)).toEqual(["booked", "cancelled"]);

    // The freed seat can be booked again.
    expect((await bookOnOwnConnection(slotId, patientB, fixture)).ok).toBe(true);
    expect(await slotState(db, slotId)).toEqual({ remaining: 0, seats: [1] });
  });

  it("a reschedule moves the seat and logs it, without a delete and insert", async () => {
    const fromSlot = await createSlot(db, fixture.scheduleId, 1);
    const toSlot = await createSlot(db, fixture.scheduleId, 1);
    const fullSlot = await createSlot(db, fixture.scheduleId, 1);
    const [patientA, patientB] = [await createPatient(db), await createPatient(db)];

    const booked = await bookOnOwnConnection(fromSlot, patientA, fixture);
    if (!booked.ok) throw new Error("expected the booking to succeed");
    expect((await bookOnOwnConnection(fullSlot, patientB, fixture)).ok).toBe(true);

    // Moving into a full slot is refused and changes nothing.
    await expect(
      db.query("update public.appointment set slot_id = $1 where id = $2", [
        fullSlot,
        booked.appointmentId,
      ]),
    ).rejects.toMatchObject({ code: BOOKING_ERROR_CODES.slotFull });
    expect(await slotState(db, fromSlot)).toEqual({ remaining: 0, seats: [1] });

    await db.query("update public.appointment set slot_id = $1 where id = $2", [
      toSlot,
      booked.appointmentId,
    ]);
    expect(await slotState(db, fromSlot)).toEqual({ remaining: 1, seats: [] });
    expect(await slotState(db, toSlot)).toEqual({ remaining: 0, seats: [1] });

    const events = await db.query<{ event: string }>(
      "select event from public.appointment_event where appointment_id = $1 order by at, event",
      [booked.appointmentId],
    );
    expect(events.rows.map((row) => row.event)).toEqual(["booked", "rescheduled"]);
  });

  it("appointments and their events cannot be deleted or rewritten", async () => {
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    const booked = await bookOnOwnConnection(slotId, await createPatient(db), fixture);
    if (!booked.ok) throw new Error("expected the booking to succeed");

    await expect(
      db.query("delete from public.appointment where id = $1", [booked.appointmentId]),
    ).rejects.toMatchObject({ code: "PH004" });
    await expect(
      db.query("update public.appointment_event set event = 'seen' where appointment_id = $1", [
        booked.appointmentId,
      ]),
    ).rejects.toMatchObject({ code: "PH004" });
  });

  it("refuses to book a practitioner without PRC verification", async () => {
    const unverified = await createFixture(db, { prcVerified: false });
    const slotId = await createSlot(db, unverified.scheduleId, 1);

    expect(await bookOnOwnConnection(slotId, await createPatient(db), unverified)).toEqual({
      ok: false,
      code: BOOKING_ERROR_CODES.practitionerNotPrcVerified,
    });
    expect(await slotState(db, slotId)).toEqual({ remaining: 1, seats: [] });
  });
});
