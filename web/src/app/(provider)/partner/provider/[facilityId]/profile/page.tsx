import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Field, Input, PageHeader, Section } from "@/components/admin/fields";
import { WEEKDAYS } from "@/lib/admin/schemas";
import { updateFacilityProfile } from "@/lib/provider/actions/facility";
import { facilityContext } from "@/lib/provider/context";

// Contact details and hours. The name, type, location, licences and
// verification are kept by the internal team.
export default async function FacilityProfilePage({ params }: PageProps<"/partner/provider/[facilityId]/profile">) {
  const { facility } = await facilityContext((await params).facilityId, "profile");
  const t = await getTranslations("provider");
  const days = await getTranslations("admin.weekdays");

  return (
    <>
      <PageHeader title={t("profile.title")} />
      <p className="text-sm text-zinc-600">{t("profile.hint")}</p>
      <ActionForm action={updateFacilityProfile} submitLabel={t("common.save")}>
        <input type="hidden" name="facility_id" value={facility.id} />
        <Field label={t("profile.address")}>
          <Input name="address_line" maxLength={300} defaultValue={facility.address_line ?? ""} />
        </Field>
        <Field label={t("profile.phone")}>
          <Input name="phone" type="tel" maxLength={20} defaultValue={facility.phone ?? ""} />
        </Field>
        <Section title={t("profile.hours")}>
          <p className="text-sm text-zinc-600">{t("profile.hoursHint")}</p>
          {WEEKDAYS.map((day) => (
            <div key={day} className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2 text-sm">
              <span>{days(`${day}`)}</span>
              <Input
                name={`hours_${day}_open`}
                type="time"
                aria-label={t("profile.opens", { day: days(`${day}`) })}
                defaultValue={facility.hours[String(day)]?.open ?? ""}
              />
              <Input
                name={`hours_${day}_close`}
                type="time"
                aria-label={t("profile.closes", { day: days(`${day}`) })}
                defaultValue={facility.hours[String(day)]?.close ?? ""}
              />
            </div>
          ))}
        </Section>
      </ActionForm>
    </>
  );
}
