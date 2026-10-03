import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Facts, Field, Input, PageHeader, Section, Select } from "@/components/admin/fields";
import { PrcBadge } from "@/components/admin/prc-badge";
import {
  linkPractitionerAccount,
  revokePrc,
  setPractitionerLive,
  verifyPrc,
} from "@/lib/admin/actions/practitioners";
import { adminContext } from "@/lib/admin/context";
import { idSchema } from "@/lib/admin/schemas";
import { manilaToday } from "@/lib/time/manila";
import type { PractitionerRow } from "@/lib/admin/types";

export default async function PractitionerPage({ params }: PageProps<"/admin/practitioners/[id]">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const { data } = await supabase
    .from("practitioner")
    .select(
      "id, app_user_id, full_name, prc_number, prc_licence_expires_on, specialties, prc_verified_at, prc_verified_by, is_live",
    )
    .eq("id", id.data)
    .maybeSingle();
  if (!data) notFound();
  const practitioner = data as PractitionerRow;
  const verified = practitioner.prc_verified_at !== null;

  // Who verified: a staff account's display name, never patient data.
  const { data: verifier } = practitioner.prc_verified_by
    ? await supabase
        .from("app_user")
        .select("display_name")
        .eq("id", practitioner.prc_verified_by)
        .maybeSingle()
    : { data: null };

  // Doctor logins this profile could be linked to.
  const { data: doctorAccounts } = await supabase
    .from("app_user")
    .select("id, display_name")
    .eq("role", "doctor")
    .order("display_name")
    .limit(500);
  const accounts = (doctorAccounts ?? []) as { id: string; display_name: string | null }[];

  const today = manilaToday();
  const expired =
    practitioner.prc_licence_expires_on !== null && practitioner.prc_licence_expires_on < today;
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium" });

  return (
    <>
      <PageHeader title={practitioner.full_name} />
      <PrcBadge verified={verified} live={practitioner.is_live} prominent />

      <Facts
        items={[
          [
            t("practitioners.specialties"),
            practitioner.specialties.length > 0
              ? practitioner.specialties.join(", ")
              : t("practitioners.noSpecialties"),
          ],
          [t("practitioners.prcNumber"), practitioner.prc_number ?? t("practitioners.noPrcNumber")],
          [
            t("practitioners.licenceExpiry"),
            practitioner.prc_licence_expires_on
              ? `${date(practitioner.prc_licence_expires_on)}${expired ? ` · ${t("practitioners.expired")}` : ""}`
              : t("common.none"),
          ],
          [
            t("practitioners.verifiedAt"),
            practitioner.prc_verified_at ? date(practitioner.prc_verified_at) : t("common.none"),
          ],
          [
            t("practitioners.verifiedBy"),
            verified ? (verifier?.display_name ?? t("practitioners.staffMember")) : t("common.none"),
          ],
        ]}
      />

      <Section title={t("practitioners.prcVerification")}>
        <p className="text-sm text-zinc-600">{t("practitioners.prcVerificationHint")}</p>
        <ActionForm
          action={verifyPrc}
          submitLabel={verified ? t("practitioners.reverify") : t("practitioners.verify")}
        >
          <input type="hidden" name="id" value={practitioner.id} />
          <Field label={t("practitioners.prcNumber")}>
            <Input name="prc_number" required maxLength={20} defaultValue={practitioner.prc_number ?? ""} />
          </Field>
          <Field label={t("practitioners.licenceExpiry")}>
            <Input
              name="prc_licence_expires_on"
              type="date"
              required
              min={today}
              defaultValue={practitioner.prc_licence_expires_on ?? ""}
            />
          </Field>
        </ActionForm>
        {verified && (
          <ActionForm action={revokePrc} submitLabel={t("practitioners.revoke")} variant="danger">
            <input type="hidden" name="id" value={practitioner.id} />
          </ActionForm>
        )}
      </Section>

      <Section title={t("practitioners.goLiveTitle")}>
        {verified ? (
          <ActionForm
            action={setPractitionerLive}
            submitLabel={practitioner.is_live ? t("practitioners.takeOffline") : t("practitioners.goLive")}
            variant={practitioner.is_live ? "secondary" : "primary"}
          >
            <input type="hidden" name="id" value={practitioner.id} />
            <input type="hidden" name="is_live" value={practitioner.is_live ? "false" : "true"} />
          </ActionForm>
        ) : (
          <p className="text-sm font-medium text-red-800">{t("practitioners.blockedHint")}</p>
        )}
      </Section>

      <Section title={t("practitioners.account")}>
        <p className="text-sm text-zinc-600">{t("practitioners.accountHint")}</p>
        <ActionForm action={linkPractitionerAccount} submitLabel={t("common.save")} variant="secondary">
          <input type="hidden" name="id" value={practitioner.id} />
          <Field label={t("practitioners.accountLabel")}>
            <Select name="app_user_id" defaultValue={practitioner.app_user_id ?? ""}>
              <option value="">{t("practitioners.noAccount")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name ?? t("users.unnamed")}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
      </Section>
    </>
  );
}
