import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  connect,
  createAppUser,
  createFixture,
  resetDatabase,
  testDatabaseUrl,
  type Fixture,
} from "./helpers";

const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
const RLS_VIOLATION = "42501";

describe.skipIf(!testDatabaseUrl)("admin console rules in the database", () => {
  let db: Client;
  let fixture: Fixture;
  let adminId: string;
  let patientAccountId: string;

  beforeAll(async () => {
    await resetDatabase();
    db = await connect();
    fixture = await createFixture(db, { prcVerified: false });
    adminId = await createAppUser(db, "admin");
    patientAccountId = await createAppUser(db, null);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  describe("access log", () => {
    const insertLog = (actorId: string) =>
      db.query(
        "insert into public.access_log (actor_id, action, resource_type) values ($1, 'facility.update', 'facility')",
        [actorId],
      );

    it("lets staff record their own actions", async () => {
      await asUser(db, fixture.staffId, async () => {
        await expect(insertLog(fixture.staffId)).resolves.toMatchObject({ rowCount: 1 });
      });
    });

    it("does not let staff write a row under someone else's name", async () => {
      await asUser(db, fixture.staffId, async () => {
        await expect(insertLog(adminId)).rejects.toMatchObject({ code: RLS_VIOLATION });
      });
    });

    it("does not let an account without a console role write to it", async () => {
      await asUser(db, patientAccountId, async () => {
        await expect(insertLog(patientAccountId)).rejects.toMatchObject({ code: RLS_VIOLATION });
      });
    });

    it("is readable by admins but not by field staff", async () => {
      await insertLog(fixture.staffId);
      const count = () => db.query<{ count: string }>("select count(*) from public.access_log");
      expect(Number((await asUser(db, adminId, count)).rows[0].count)).toBeGreaterThan(0);
      expect(Number((await asUser(db, fixture.staffId, count)).rows[0].count)).toBe(0);
    });

    it("cannot be edited or deleted, even by the database owner", async () => {
      await expect(db.query("update public.access_log set action = 'x'")).rejects.toMatchObject({
        code: "PH004",
      });
      await expect(db.query("delete from public.access_log")).rejects.toMatchObject({ code: "PH004" });
    });
  });

  describe("roles", () => {
    const setRole = (targetId: string) =>
      db.query("update public.app_user set role = 'admin' where id = $1", [targetId]);

    it("lets an admin assign a role", async () => {
      await asUser(db, adminId, async () => {
        expect((await setRole(fixture.staffId)).rowCount).toBe(1);
      });
    });

    it("does not let staff assign roles, including to themselves", async () => {
      await asUser(db, fixture.staffId, async () => {
        expect((await setRole(fixture.staffId)).rowCount).toBe(0);
      });
    });

    it("does not let a patient account see or change console accounts", async () => {
      await asUser(db, patientAccountId, async () => {
        expect((await setRole(patientAccountId)).rowCount).toBe(0);
        const visible = await db.query("select id from public.app_user");
        expect(visible.rows.map((row) => row.id)).toEqual([patientAccountId]);
      });
    });
  });

  describe("PRC verification", () => {
    it("cannot be recorded without the licence expiry", async () => {
      await expect(
        db.query(
          `update public.practitioner
           set prc_number = 'TEST-1', prc_verified_at = now(), prc_verified_by = $2
           where id = $1`,
          [fixture.practitionerId, fixture.staffId],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("cannot be recorded without who verified", async () => {
      await expect(
        db.query(
          `update public.practitioner
           set prc_number = 'TEST-1', prc_licence_expires_on = '2030-01-01', prc_verified_at = now()
           where id = $1`,
          [fixture.practitionerId],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("blocks an unverified practitioner from going live", async () => {
      await expect(
        db.query("update public.practitioner set is_live = true where id = $1", [fixture.practitionerId]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("allows going live once number, verifier, time and expiry are all recorded", async () => {
      await asUser(db, fixture.staffId, async () => {
        const result = await db.query(
          `update public.practitioner
           set prc_number = 'TEST-1', prc_licence_expires_on = '2030-01-01',
               prc_verified_at = now(), prc_verified_by = $2, is_live = true
           where id = $1`,
          [fixture.practitionerId, fixture.staffId],
        );
        expect(result.rowCount).toBe(1);
      });
    });
  });

  describe("prices", () => {
    const insertPrice = (columns: string, values: string) =>
      db.query(
        `insert into public.price_item (service_id, facility_id, amount_min_centavos, amount_max_centavos${columns})
         values ($1, $2, 35000, 50000${values})`,
        [fixture.serviceId, fixture.facilityId],
      );

    it("cannot be saved without a source", async () => {
      await expect(insertPrice(", observed_at", ", now()")).rejects.toMatchObject({
        code: NOT_NULL_VIOLATION,
      });
    });

    it("cannot be saved without an observed date", async () => {
      await expect(insertPrice(", source", ", 'estimated'")).rejects.toMatchObject({
        code: NOT_NULL_VIOLATION,
      });
    });

    it("cannot have a max below its min", async () => {
      await expect(
        db.query(
          `insert into public.price_item
             (service_id, facility_id, amount_min_centavos, amount_max_centavos, source, observed_at)
           values ($1, $2, 50000, 35000, 'estimated', now())`,
          [fixture.serviceId, fixture.facilityId],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  describe("facility freshness view", () => {
    const row = () =>
      db.query<{ price_item_count: string; last_stock_report_at: Date | null; municipality_name: string }>(
        `select price_item_count, last_stock_report_at, municipality_name, latitude, longitude
         from public.facility_admin_view where id = $1`,
        [fixture.facilityId],
      );

    it("reports no prices and no stock report for a new facility", async () => {
      const result = await row();
      expect(result.rows[0]).toMatchObject({
        price_item_count: "0",
        last_stock_report_at: null,
        municipality_name: "Test Town",
        latitude: 13.75,
        longitude: 121.05,
      });
    });

    it("counts prices and picks up the latest stock report", async () => {
      await db.query(
        `insert into public.price_item
           (service_id, facility_id, amount_min_centavos, amount_max_centavos, source, observed_at)
         values ($1, $2, 35000, 50000, 'estimated', now())`,
        [fixture.serviceId, fixture.facilityId],
      );
      await db.query(
        `insert into public.stock_report (facility_id, service_id, available, reporter_type, reported_at)
         values ($1, $2, true, 'staff', now() - interval '10 days'),
                ($1, $2, false, 'staff', now() - interval '2 days')`,
        [fixture.facilityId, fixture.serviceId],
      );
      const result = await row();
      expect(result.rows[0].price_item_count).toBe("1");
      const ageDays = (Date.now() - result.rows[0].last_stock_report_at!.getTime()) / 86_400_000;
      expect(ageDays).toBeGreaterThan(1.9);
      expect(ageDays).toBeLessThan(2.1);
    });

    it("is visible to staff and empty for everyone else", async () => {
      const count = () => db.query<{ count: string }>("select count(*) from public.facility_admin_view");
      expect(Number((await asUser(db, fixture.staffId, count)).rows[0].count)).toBe(1);
      expect(Number((await asUser(db, patientAccountId, count)).rows[0].count)).toBe(0);
    });
  });
});
