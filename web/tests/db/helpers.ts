import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const TEST_DATABASE = "phh_test";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../supabase/migrations");
const SHIM_FILE = path.resolve(import.meta.dirname, "supabase-shim.sql");

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** Migrations and resets only ever run against a local database. */
function localUrl(): URL {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is not set");
  const url = new URL(testDatabaseUrl);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error("TEST_DATABASE_URL must point at a local database");
  }
  return url;
}

function urlFor(database: string): string {
  const url = localUrl();
  url.pathname = `/${database}`;
  return url.toString();
}

/** A new connection to the throwaway test database. */
export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: urlFor(TEST_DATABASE) });
  await client.connect();
  return client;
}

/**
 * Drops and recreates the throwaway database, then applies the Supabase shim
 * and every migration in order — the same SQL files the real project runs.
 */
export async function resetDatabase(): Promise<void> {
  const maintenance = new Client({ connectionString: urlFor("postgres") });
  await maintenance.connect();
  try {
    await maintenance.query(`drop database if exists ${TEST_DATABASE} with (force)`);
    await maintenance.query(`create database ${TEST_DATABASE}`);
  } finally {
    await maintenance.end();
  }

  const client = await connect();
  try {
    await client.query(readFileSync(SHIM_FILE, "utf8"));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      try {
        await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function insertId(client: Client, sql: string, params: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(`${sql} returning id`, params);
  return result.rows[0].id;
}

/** A login identity with its app_user row. Synthetic data only. */
export async function createAppUser(client: Client, role: string | null): Promise<string> {
  const id = await insertId(client, "insert into auth.users default values");
  await client.query("insert into public.app_user (id, role) values ($1, $2)", [id, role]);
  return id;
}

export async function createPatient(client: Client, appUserId: string | null = null): Promise<string> {
  return insertId(
    client,
    "insert into public.patient_profile (full_name, app_user_id) values ('Synthetic Patient', $1)",
    [appUserId],
  );
}

export type Fixture = {
  staffId: string;
  facilityId: string;
  serviceId: string;
  practitionerId: string;
  scheduleId: string;
};

/**
 * One facility in a synthetic municipality, one consult service and one
 * practitioner with a schedule there.
 */
export async function createFixture(
  client: Client,
  options: { prcVerified: boolean },
): Promise<Fixture> {
  const staffId = await createAppUser(client, "staff");

  await client.query(
    `insert into public.location (psgc_code, level, name, region_code, province_code, municipality_code)
     values
       ('9900000000', 'region', 'Test Region', '9900000000', null, null),
       ('9901000000', 'province', 'Test Province', '9900000000', '9901000000', null),
       ('9901001000', 'municipality', 'Test Town', '9900000000', '9901000000', '9901001000')
     on conflict (psgc_code) do nothing`,
  );

  const facilityId = await insertId(
    client,
    `insert into public.facility (name, facility_type, region_code, province_code, municipality_code, geog)
     values ('Test Clinic', 'private_clinic', '9900000000', '9901000000', '9901001000',
             extensions.st_setsrid(extensions.st_makepoint(121.05, 13.75), 4326)::extensions.geography)`,
  );

  const serviceId = await insertId(
    client,
    `insert into public.service (service_type, name)
     values ('consult', 'Consult ' || gen_random_uuid())`,
  );

  const practitionerId = options.prcVerified
    ? await insertId(
        client,
        `insert into public.practitioner
           (full_name, prc_number, prc_licence_expires_on, prc_verified_at, prc_verified_by)
         values ('Synthetic Doctor', 'TEST-' || gen_random_uuid(), '2030-01-01', now(), $1)`,
        [staffId],
      )
    : await insertId(client, "insert into public.practitioner (full_name) values ('Synthetic Doctor')");

  const scheduleId = await insertId(
    client,
    "insert into public.schedule (practitioner_id, facility_id) values ($1, $2)",
    [practitionerId, facilityId],
  );

  return { staffId, facilityId, serviceId, practitionerId, scheduleId };
}

let slotOffsetHours = 0;

/** A generated slot on the schedule; each call gets its own start time. */
export async function createSlot(client: Client, scheduleId: string, capacity: number): Promise<string> {
  slotOffsetHours += 1;
  return insertId(
    client,
    `insert into public.slot (schedule_id, starts_at, ends_at, capacity, remaining, mode)
     values ($1,
             timestamptz '2030-01-07 01:00:00+00' + make_interval(hours => $3),
             timestamptz '2030-01-07 01:30:00+00' + make_interval(hours => $3),
             $2, $2, 'in_person')`,
    [scheduleId, capacity, slotOffsetHours],
  );
}

export const BOOK_SLOT_SQL =
  "select (public.book_slot($1, $2, $3, 'assisted_counter', $4)).id as appointment_id";

/**
 * Runs `work` as a signed-in API user: the `authenticated` role with the
 * user's id in the JWT claim, which is what row-level security sees in
 * Supabase. Always rolled back, so it never leaves data behind.
 */
export async function asUser<T>(client: Client, userId: string, work: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("set local role authenticated");
    return await work();
  } finally {
    await client.query("rollback");
  }
}
