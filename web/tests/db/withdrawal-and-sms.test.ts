import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  connect,
  createAppUser,
  createFixture,
  createSlot,
  resetDatabase,
  testDatabaseUrl,
  type Fixture,
} from "./helpers";

describe.skipIf(!testDatabaseUrl)("result withdrawal and SMS dispatch in the database", () => {
  let db: Client;
  let fixture: Fixture;
  let lab: string;
  let labStaff: string;
  let adminId: string;
  let patientLogin: string;
  let labSchedule: string;

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

  /** A delivered result for a patient who has their own login. */
  const deliver = async () => {
    const booked = await db.query<{ id: string; patient_id: string }>(
      "select * from public.book_walk_in($1, $2, $3, null, 'Synthetic Lab Patient', null)",
      [await createSlot(db, labSchedule, 1), labStaff, fixture.serviceId],
    );
    const { id: appointmentId, patient_id: patientId } = booked.rows[0];
    await db.query("update public.patient_profile set app_user_id = null where app_user_id = $1", [patientLogin]);
    await db.query("update public.patient_profile set app_user_id = $1 where id = $2", [patientLogin, patientId]);
    const document = await db.query<{ id: string }>(
      `insert into public.vault_document
         (patient_id, document_type, storage_path, mime_type, size_bytes, appointment_id, facility_id, uploaded_by)
       values ($1, 'lab_result', $2::text || '/' || gen_random_uuid(), 'application/pdf', 1000, $3, $2::uuid, $4)
       returning id`,
      [patientId, lab, appointmentId, labStaff],
    );
    return document.rows[0].id;
  };

  const REQUEST =
    "update public.vault_document set withdrawal_status = 'requested', withdrawal_reason = 'wrong_patient', withdrawal_requested_at = now(), withdrawal_requested_by = $2 where id = $1";
  const decide = (decision: string) =>
    `update public.vault_document set withdrawal_status = '${decision}', withdrawal_decided_at = now(), withdrawal_decided_by = $2 where id = $1`;
  const patientSees = async (documentId: string) =>
    (await attempt(patientLogin, "select id from public.vault_document where id = $1", [documentId])).rows.length;

  beforeAll(async () => {
    await resetDatabase();
    db = await connect();
    fixture = await createFixture(db, { prcVerified: true });
    const org = (await db.query<{ id: string }>("insert into public.organization (name) values ('Synthetic Lab Group') returning id")).rows[0].id;
    lab = (
      await db.query<{ id: string }>(
        `insert into public.facility (name, facility_type, parent_org_id, region_code, province_code, municipality_code)
         values ('Lab', 'diagnostic_center', $1, '9900000000', '9901000000', '9901001000') returning id`,
        [org],
      )
    ).rows[0].id;
    labStaff = await createAppUser(db, "provider_staff");
    adminId = await createAppUser(db, "admin");
    patientLogin = await createAppUser(db, null);
    await db.query("insert into public.organization_staff (organization_id, app_user_id) values ($1, $2)", [org, labStaff]);
    labSchedule = (
      await db.query<{ id: string }>(
        "insert into public.schedule (facility_id, facility_resource) values ($1, 'Collection room') returning id",
        [lab],
      )
    ).rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  describe("withdrawing a delivered result", () => {
    it("hides the document from the patient as soon as withdrawal is requested", async () => {
      const documentId = await deliver();
      expect(await patientSees(documentId)).toBe(1);
      await db.query(REQUEST, [documentId, labStaff]);
      expect(await patientSees(documentId)).toBe(0);
    });

    it("lets facility staff request a withdrawal, but only as themselves", async () => {
      const documentId = await deliver();
      expect((await attempt(labStaff, REQUEST, [documentId, adminId])).code).toBe("PH018");
      expect((await attempt(labStaff, REQUEST, [documentId, labStaff])).rowCount).toBe(1);
    });

    it("never lets facility staff approve their own request", async () => {
      const documentId = await deliver();
      await db.query(REQUEST, [documentId, labStaff]);
      expect((await attempt(labStaff, decide("approved"), [documentId, labStaff])).code).toBe("PH018");
    });

    it("shows the internal team a document only once withdrawal is requested", async () => {
      const documentId = await deliver();
      const seen = () => attempt(adminId, "select id from public.vault_document where id = $1", [documentId]);
      expect((await seen()).rows).toHaveLength(0);
      await db.query(REQUEST, [documentId, labStaff]);
      expect((await seen()).rows).toHaveLength(1);
    });

    it("lets the internal team approve, then only record that the file is gone", async () => {
      const documentId = await deliver();
      await db.query(REQUEST, [documentId, labStaff]);
      // A decision must be recorded under the decider's own name.
      expect((await attempt(adminId, decide("approved"), [documentId, labStaff])).code).toBe("PH018");

      await asUser(db, adminId, async () => {
        expect((await db.query(decide("approved"), [documentId, adminId])).rowCount).toBe(1);
        expect(
          (await db.query("update public.vault_document set file_removed_at = now() where id = $1", [documentId]))
            .rowCount,
        ).toBe(1);
        // An approved withdrawal cannot be reversed.
        await db.query("savepoint s");
        await expect(db.query(decide("rejected"), [documentId, adminId])).rejects.toMatchObject({ code: "PH018" });
        await db.query("rollback to savepoint s");
      });
    });

    it("lets only an admin close an approved withdrawal by hand, and only under their own name", async () => {
      const fieldStaff = await createAppUser(db, "staff");
      const documentId = await deliver();
      await db.query(REQUEST, [documentId, labStaff]);
      await db.query(decide("approved"), [documentId, adminId]);

      const override = (as: string, signedBy: string) =>
        attempt(
          as,
          "update public.vault_document set file_removed_at = now(), file_removal_override_by = $2 where id = $1",
          [documentId, signedBy],
        );
      // Field staff may record a confirmed deletion, but not override.
      expect((await override(fieldStaff, fieldStaff)).code).toBe("PH019");
      // An admin cannot sign the override with someone else's name.
      expect((await override(adminId, fieldStaff)).code).toBe("PH019");
      expect((await override(adminId, adminId)).rowCount).toBe(1);
    });

    it("cannot record an override without also closing the removal", async () => {
      const documentId = await deliver();
      await db.query(REQUEST, [documentId, labStaff]);
      await db.query(decide("approved"), [documentId, adminId]);
      await expect(
        db.query("update public.vault_document set file_removal_override_by = $2 where id = $1", [
          documentId,
          adminId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("gives the document back to the patient when the request is rejected", async () => {
      const documentId = await deliver();
      await db.query(REQUEST, [documentId, labStaff]);
      await db.query(decide("rejected"), [documentId, adminId]);
      expect(await patientSees(documentId)).toBe(1);
    });

    it("never lets anyone repoint a delivered document at another patient", async () => {
      const documentId = await deliver();
      await db.query(REQUEST, [documentId, labStaff]);
      const result = await attempt(
        adminId,
        "update public.vault_document set patient_id = (select id from public.patient_profile where id <> patient_id limit 1) where id = $1",
        [documentId],
      );
      expect(result.code).toBe("PH017");
    });
  });

  describe("SMS dispatch", () => {
    const queue = async (count: number, when = "now() - interval '1 minute'") => {
      await db.query("delete from public.sms_message");
      await db.query(
        `insert into public.sms_message (to_phone, template, scheduled_at)
         select '+639170000000', 'booking_confirmed', ${when} from generate_series(1, $1)`,
        [count],
      );
    };
    const claim = (client: Client, limit: number) =>
      client.query<{ id: string; attempts: number }>("select id, attempts from public.claim_due_sms($1)", [limit]);
    const complete = (id: string, sent: boolean, retryable = true) =>
      db.query<{ status: string | null }>("select public.complete_sms($1, $2, 'ref-1', 'carrier_busy', $3) as status", [
        id,
        sent,
        retryable,
      ]);

    it("hands out only due messages, up to the limit", async () => {
      await queue(5);
      await db.query(
        "insert into public.sms_message (to_phone, template, scheduled_at) values ('+639170000000', 'appointment_reminder', now() + interval '1 day')",
      );
      expect((await claim(db, 3)).rows).toHaveLength(3);
      expect((await claim(db, 10)).rows).toHaveLength(2);
      expect((await claim(db, 10)).rows).toHaveLength(0);
    });

    it("never gives the same message to two senders running at once", async () => {
      await queue(20);
      const senders = [await connect(), await connect(), await connect()];
      try {
        const claims = await Promise.all(senders.map((sender) => claim(sender, 20)));
        const ids = claims.flatMap((result) => result.rows.map((row) => row.id));
        expect(ids).toHaveLength(20);
        expect(new Set(ids).size).toBe(20);
      } finally {
        await Promise.all(senders.map((sender) => sender.end()));
      }
    });

    it("marks a sent message and keeps the carrier's reference", async () => {
      await queue(1);
      const { id } = (await claim(db, 1)).rows[0];
      expect((await complete(id, true)).rows[0].status).toBe("sent");
      const row = await db.query("select status, provider_ref, last_error, sent_at is not null as stamped from public.sms_message where id = $1", [id]);
      expect(row.rows[0]).toEqual({ status: "sent", provider_ref: "ref-1", last_error: null, stamped: true });
    });

    it("retries a failure up to three attempts, then marks it failed", async () => {
      await queue(1);
      for (const expected of ["queued", "queued", "failed"]) {
        const { id } = (await claim(db, 1)).rows[0];
        expect((await complete(id, false)).rows[0].status).toBe(expected);
      }
      expect((await claim(db, 1)).rows).toHaveLength(0);
    });

    it("fails at once when the carrier says retrying is pointless", async () => {
      await queue(1);
      const { id } = (await claim(db, 1)).rows[0];
      expect((await complete(id, false, false)).rows[0].status).toBe("failed");
    });

    it("releases a claim that was never completed after ten minutes", async () => {
      await queue(1);
      const { id } = (await claim(db, 1)).rows[0];
      expect((await claim(db, 1)).rows).toHaveLength(0);
      await db.query("update public.sms_message set claimed_at = now() - interval '11 minutes' where id = $1", [id]);
      expect((await claim(db, 1)).rows.map((row) => row.id)).toEqual([id]);
    });

    it("cannot be driven by a signed-in client", async () => {
      await queue(1);
      expect((await attempt(labStaff, "select * from public.claim_due_sms(5)")).code).toBe("42501");
    });
  });
});
