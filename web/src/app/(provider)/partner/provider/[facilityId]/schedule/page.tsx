import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import {
  Empty,
  Field,
  Input,
  LINK_BUTTON,
  LIST,
  PageHeader,
  PRIMARY_LINK_BUTTON,
  Section,
  Select,
} from "@/components/admin/fields";
import { WEEKDAYS } from "@/lib/admin/schemas";
import {
  BLOCKING_EXCEPTION_TYPES,
  parseResourceRuleForm,
  RESOURCE_RULE_FIELDS,
  ruleFormFromQuery,
} from "@/lib/doctor/schemas";
import { EXCEPTION_COLUMNS, RULE_COLUMNS, toExceptionInput, toRuleInput } from "@/lib/doctor/slots";
import type { ExceptionRow, RuleRow } from "@/lib/doctor/types";
import {
  addResource,
  addResourceException,
  addResourceRule,
  deleteResourceException,
  deleteResourceRule,
  setResourcePublished,
} from "@/lib/provider/actions/facility";
import { facilityContext, facilityPath } from "@/lib/provider/context";
import { resourceSchedules } from "@/lib/provider/queries";
import { addDays, generateSlots, groupByManilaDate, type RuleInput } from "@/lib/scheduling/generate";
import { manilaToday } from "@/lib/time/manila";

const PREVIEW_DAYS = 14;
const PREVIEW_RULE_ID = "preview";

type Weekday = (typeof WEEKDAYS)[number];
const hhmm = (value: string) => value.slice(0, 5);

// Slots per branch: each resource (a room, a machine, a counter, a
// home-service team) has its own weekly sessions and exceptions.
export default async function SchedulePage({
  params,
  searchParams,
}: PageProps<"/partner/provider/[facilityId]/schedule">) {
  const { supabase, facility } = await facilityContext((await params).facilityId, "schedule");
  const t = await getTranslations("doctor.availability");
  const p = await getTranslations("provider.schedule");
  const days = await getTranslations("admin.weekdays");
  const errors = await getTranslations("admin.errors");
  const format = await getFormatter();
  const query = await searchParams;
  const today = manilaToday();
  const pathname = facilityPath(facility.id, "schedule");

  const schedules = await resourceSchedules(supabase, facility.id);
  const scheduleIds = schedules.map((schedule) => schedule.id);
  const [rules, exceptions] =
    scheduleIds.length > 0
      ? await Promise.all([
          supabase
            .from("availability_rule")
            .select(RULE_COLUMNS)
            .in("schedule_id", scheduleIds)
            .order("weekday")
            .order("start_time"),
          supabase
            .from("schedule_exception")
            .select(EXCEPTION_COLUMNS)
            .in("schedule_id", scheduleIds)
            .gt("ends_at", new Date().toISOString())
            .order("starts_at"),
        ])
      : [{ data: [] }, { data: [] }];
  const ruleRows = (rules.data ?? []) as unknown as RuleRow[];
  const exceptionRows = (exceptions.data ?? []) as unknown as ExceptionRow[];

  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });
  const dateTime = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
  const timeOf = (value: string) => format.dateTime(new Date(value), { timeStyle: "short" });
  const queryValue = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  // Preview: what the session in the query string would produce, before saving.
  const previewing = query.schedule_id !== undefined;
  const proposed = previewing ? parseResourceRuleForm(ruleFormFromQuery(query, RESOURCE_RULE_FIELDS)) : null;
  let previewDays: Array<[string, Array<{ startsAt: string; isNew: boolean }>]> = [];
  if (proposed?.ok) {
    const schedule = schedules.find((row) => row.id === proposed.data.schedule_id);
    const candidate: RuleInput = {
      id: PREVIEW_RULE_ID,
      weekday: proposed.data.weekday,
      recurrence: null,
      startTime: proposed.data.start_time,
      endTime: proposed.data.end_time,
      slotMinutes: proposed.data.slot_minutes,
      capacityPerSlot: proposed.data.capacity_per_slot,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      mode: "in_person",
      validFrom: proposed.data.valid_from,
      validTo: proposed.data.valid_to ?? null,
    };
    const windowStart = proposed.data.valid_from > today ? proposed.data.valid_from : today;
    const slots = schedule
      ? generateSlots({
          timeZone: schedule.timezone,
          rules: [...ruleRows.filter((rule) => rule.schedule_id === schedule.id).map(toRuleInput), candidate],
          exceptions: exceptionRows.filter((row) => row.schedule_id === schedule.id).map(toExceptionInput),
          windowStart,
          windowEnd: addDays(windowStart, PREVIEW_DAYS),
        })
      : [];
    previewDays = [...groupByManilaDate(slots)].map(([day, daySlots]) => [
      day,
      daySlots.map((slot) => ({ startsAt: slot.startsAt, isNew: slot.availabilityRuleId === PREVIEW_RULE_ID })),
    ]);
  }
  const previewErrors =
    proposed && !proposed.ok && proposed.state && "errors" in proposed.state ? proposed.state.errors : [];

  return (
    <>
      <PageHeader title={p("title")} />

      {schedules.length === 0 && <Empty>{p("noResources")}</Empty>}

      {schedules.map((schedule) => {
        const resourceRules = ruleRows.filter((rule) => rule.schedule_id === schedule.id);
        const resourceExceptions = exceptionRows.filter((row) => row.schedule_id === schedule.id);
        return (
          <Section key={schedule.id} title={schedule.facility_resource}>
            <span className="text-sm font-medium">{schedule.is_published ? t("published") : t("draft")}</span>
            <ActionForm
              action={setResourcePublished}
              submitLabel={schedule.is_published ? t("unpublish") : t("publish")}
              variant={schedule.is_published ? "secondary" : "primary"}
            >
              <input type="hidden" name="facility_id" value={facility.id} />
              <input type="hidden" name="id" value={schedule.id} />
              <input type="hidden" name="publish" value={schedule.is_published ? "false" : "true"} />
            </ActionForm>

            <h3 className="text-sm font-semibold">{t("sessions")}</h3>
            {resourceRules.length === 0 ? (
              <Empty>{t("noSessions")}</Empty>
            ) : (
              <ul className={LIST}>
                {resourceRules.map((rule) => (
                  <li key={rule.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                    <span className="font-medium">
                      {rule.weekday ? days(`${rule.weekday as Weekday}`) : rule.recurrence}{" "}
                      {hhmm(rule.start_time)}–{hhmm(rule.end_time)}
                    </span>
                    <span className="text-zinc-600">
                      {t("ruleSummary", { minutes: rule.slot_minutes, capacity: rule.capacity_per_slot })}
                    </span>
                    <span className="text-zinc-600">
                      {rule.valid_to
                        ? t("validRange", { from: date(rule.valid_from), to: date(rule.valid_to) })
                        : t("validFrom", { from: date(rule.valid_from) })}
                    </span>
                    <ActionForm action={deleteResourceRule} submitLabel={t("remove")} variant="danger">
                      <input type="hidden" name="facility_id" value={facility.id} />
                      <input type="hidden" name="id" value={rule.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="text-sm font-semibold">{t("exceptions")}</h3>
            {resourceExceptions.length === 0 ? (
              <Empty>{t("noExceptions")}</Empty>
            ) : (
              <ul className={LIST}>
                {resourceExceptions.map((row) => (
                  <li key={row.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                    <span className="font-medium">{t(`exceptionTypes.${row.exception_type}`)}</span>
                    <span className="text-zinc-600">
                      {row.exception_type === "extra_session"
                        ? `${dateTime(row.starts_at)} – ${timeOf(row.ends_at)}`
                        : // ends_at is the start of the day after the last blocked day.
                          `${date(row.starts_at)} – ${date(new Date(new Date(row.ends_at).getTime() - 1).toISOString())}`}
                    </span>
                    <ActionForm action={deleteResourceException} submitLabel={t("remove")} variant="danger">
                      <input type="hidden" name="facility_id" value={facility.id} />
                      <input type="hidden" name="id" value={row.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="text-sm font-semibold">{t("blockDays")}</h3>
            <ActionForm action={addResourceException} submitLabel={t("blockDays")} variant="secondary" resetOnSave>
              <input type="hidden" name="facility_id" value={facility.id} />
              <input type="hidden" name="schedule_id" value={schedule.id} />
              <Field label={t("exceptionType")}>
                <Select name="exception_type" defaultValue="holiday">
                  {BLOCKING_EXCEPTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`exceptionTypes.${type}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("firstDay")}>
                  <Input name="start_date" type="date" required min={today} />
                </Field>
                <Field label={t("lastDay")}>
                  <Input name="end_date" type="date" min={today} />
                </Field>
              </div>
            </ActionForm>

            <h3 className="text-sm font-semibold">{t("extraSession")}</h3>
            <ActionForm action={addResourceException} submitLabel={t("extraSession")} variant="secondary" resetOnSave>
              <input type="hidden" name="facility_id" value={facility.id} />
              <input type="hidden" name="schedule_id" value={schedule.id} />
              <input type="hidden" name="exception_type" value="extra_session" />
              <Field label={t("date")}>
                <Input name="start_date" type="date" required min={today} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("startTime")}>
                  <Input name="start_time" type="time" required />
                </Field>
                <Field label={t("endTime")}>
                  <Input name="end_time" type="time" required />
                </Field>
                <Field label={t("slotMinutes")}>
                  <Input name="slot_minutes" type="number" inputMode="numeric" required min={5} max={720} defaultValue={30} />
                </Field>
                <Field label={t("capacity")}>
                  <Input name="capacity_per_slot" type="number" inputMode="numeric" required min={1} max={500} defaultValue={1} />
                </Field>
              </div>
            </ActionForm>
          </Section>
        );
      })}

      <Section title={p("addResource")}>
        <p className="text-sm text-zinc-600">{p("addResourceHint")}</p>
        <ActionForm action={addResource} submitLabel={p("addResource")} resetOnSave>
          <input type="hidden" name="facility_id" value={facility.id} />
          <Field label={p("resourceName")}>
            <Input name="facility_resource" required maxLength={100} />
          </Field>
        </ActionForm>
      </Section>

      {schedules.length > 0 && (
        <Section title={t("addSession")}>
          <p className="text-sm text-zinc-600">{t("addSessionHint")}</p>
          {/* A GET form: the page shows what the session would produce before anything is saved. */}
          <form method="get" action={`${pathname}#preview`} className="flex flex-col gap-4">
            <Field label={p("resource")}>
              <Select name="schedule_id" required defaultValue={queryValue("schedule_id")}>
                <option value="" disabled>
                  {t("choose")}
                </option>
                {schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.facility_resource}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("weekday")}>
              <Select name="weekday" required defaultValue={queryValue("weekday") || "1"}>
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {days(`${day}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("startTime")}>
                <Input name="start_time" type="time" required defaultValue={queryValue("start_time")} />
              </Field>
              <Field label={t("endTime")}>
                <Input name="end_time" type="time" required defaultValue={queryValue("end_time")} />
              </Field>
              <Field label={t("slotMinutes")}>
                <Input name="slot_minutes" type="number" inputMode="numeric" required min={5} max={720} defaultValue={queryValue("slot_minutes") || 30} />
              </Field>
              <Field label={t("capacity")} hint={t("capacityHint")}>
                <Input name="capacity_per_slot" type="number" inputMode="numeric" required min={1} max={500} defaultValue={queryValue("capacity_per_slot") || 1} />
              </Field>
              <Field label={t("validFromLabel")}>
                <Input name="valid_from" type="date" required defaultValue={queryValue("valid_from") || today} />
              </Field>
              <Field label={t("validToLabel")}>
                <Input name="valid_to" type="date" defaultValue={queryValue("valid_to")} />
              </Field>
            </div>
            <div className="flex gap-2">
              <button type="submit" className={PRIMARY_LINK_BUTTON}>
                {t("preview")}
              </button>
              {previewing && (
                <Link href={pathname} className={LINK_BUTTON}>
                  {t("clearPreview")}
                </Link>
              )}
            </div>
          </form>
        </Section>
      )}

      {previewing && (
        <section id="preview" className="flex flex-col gap-3 rounded border border-blue-300 bg-blue-50 p-4">
          <h2 className="text-base font-semibold">{p("previewTitle", { days: PREVIEW_DAYS })}</h2>
          {previewErrors.length > 0 ? (
            <ul role="alert" className="flex flex-col gap-1 text-sm text-red-700">
              {previewErrors.map((code) => (
                <li key={code}>{errors(code)}</li>
              ))}
            </ul>
          ) : (
            <>
              {previewDays.length === 0 ? (
                <Empty>{t("previewEmpty")}</Empty>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {previewDays.map(([day, slots]) => (
                    <li key={day}>
                      <span className="font-medium">
                        {format.dateTime(new Date(`${day}T00:00:00+08:00`), { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                      <span className="ml-2">
                        {slots.map((slot) => (
                          <span
                            key={slot.startsAt}
                            className={`mr-2 inline-block ${slot.isNew ? "font-semibold" : "text-zinc-600"}`}
                          >
                            {timeOf(slot.startsAt)}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-zinc-600">{t("previewLegend")}</p>
              <ActionForm action={addResourceRule} submitLabel={t("saveSession")}>
                <input type="hidden" name="facility_id" value={facility.id} />
                {RESOURCE_RULE_FIELDS.map((key) => (
                  <input key={key} type="hidden" name={key} value={queryValue(key)} />
                ))}
              </ActionForm>
            </>
          )}
        </section>
      )}
    </>
  );
}
