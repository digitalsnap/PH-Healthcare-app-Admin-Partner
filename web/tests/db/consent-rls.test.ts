import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOOK_SLOT_SQL,
  connect,
  createAppUser,
  createFixture,
  createPatient,
  createSlot,
  resetDatabase,
  testDatabaseUrl,
} from "./helpers";

/**
 * Runs a count as a signed-in API user: the `authenticated` role with the
 * user's id in the JWT claim, exactly what row-level security sees in Supabase.
 */
async function countAs(db: Client, userId: string, table: string, patientColumn: string, patientId: string) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.query("set local role authenticated");
    const result = await db.query<{ count: string }>(
      `select count(*) from public.${table} where ${patientColumn} = $1`,
      [patientId],
    );
    return Number(result.rows[0].count);
  } finally {
    await db.query("rollback");
  }
}

describe.skipIf(!testDatabaseUrl)("circle consent in row-level security", () => {
  let db: Client;
  let patientUserId: string;
  let patientId: string;
  let managerId: string;
  let strangerId: string;
  let staffId: string;
  let membershipId: string;

  const visibleTo = async (userId: string) => ({
    profile: await countAs(db, userId, "patient_profile", "id", patientId),
    appointments: await countAs(db, userId, "appointment", "patient_id", patientId),
  });

  beforeAll(async () => {
    await resetDatabase();
    db = await connect();

    const fixture = await createFixture(db, { prcVerified: true });
    staffId = fixture.staffId;
    patientUserId = await createAppUser(db, null);
    managerId = await createAppUser(db, null);
    strangerId = await createAppUser(db, null);
    patientId = await createPatient(db, patientUserId);

    // The care manager books for the patient, so booked_by is the manager.
    const slotId = await createSlot(db, fixture.scheduleId, 1);
    await db.query(BOOK_SLOT_SQL, [slotId, patientId, managerId, fixture.serviceId]);

    const circle = await db.query<{ id: string }>(
      "insert into public.care_circle (patient_id) values ($1) returning id",
      [patientId],
    );
    // A relationship row with no consent recorded yet.
    const membership = await db.query<{ id: string }>(
      `insert into public.circle_membership (circle_id, member_user_id, role)
       values ($1, $2, 'care_manager') returning id`,
      [circle.rows[0].id, managerId],
    );
    membershipId = membership.rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  it("the patient sees their own data", async () => {
    expect(await visibleTo(patientUserId)).toEqual({ profile: 1, appointments: 1 });
  });

  it("a membership row without recorded consent grants nothing, even to the person who booked", async () => {
    expect(await visibleTo(managerId)).toEqual({ profile: 0, appointments: 0 });
  });

  it("recorded consent opens access", async () => {
    await db.query(
      `update public.circle_membership
       set consent_method = 'otp_patient_phone', granted_at = now()
       where id = $1`,
      [membershipId],
    );
    expect(await visibleTo(managerId)).toEqual({ profile: 1, appointments: 1 });
  });

  it("consent for one person opens nothing for anyone else", async () => {
    expect(await visibleTo(strangerId)).toEqual({ profile: 0, appointments: 0 });
  });

  it("internal staff have no blanket access to patient data", async () => {
    expect(await visibleTo(staffId)).toEqual({ profile: 0, appointments: 0 });
  });

  it("revoking consent closes access again", async () => {
    await db.query("update public.circle_membership set revoked_at = now() where id = $1", [
      membershipId,
    ]);
    expect(await visibleTo(managerId)).toEqual({ profile: 0, appointments: 0 });
  });

  it("consent cannot be half-recorded", async () => {
    await expect(
      db.query(
        `insert into public.circle_membership (circle_id, member_user_id, role, granted_at)
         select circle_id, $1, 'viewer', now() from public.circle_membership where id = $2`,
        [strangerId, membershipId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("the public (anon) role sees no patient data at all", async () => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const result = await db.query<{ count: string }>("select count(*) from public.patient_profile");
      expect(Number(result.rows[0].count)).toBe(0);
    } finally {
      await db.query("rollback");
    }
  });
});
