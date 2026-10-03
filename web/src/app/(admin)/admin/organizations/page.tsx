import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import {
  addOrganizationStaff,
  createOrganization,
  removeOrganizationStaff,
} from "@/lib/admin/actions/catalogue";
import { adminContext } from "@/lib/admin/context";
import { pageOf, rangeOf } from "@/lib/admin/pagination";

const PATHNAME = "/admin/organizations";
const ACCOUNT_LIMIT = 500;

type OrganizationRow = { id: string; name: string };
type StaffRow = { id: string; organization_id: string; app_user: { display_name: string | null } | null };
type FacilityRow = { id: string; name: string; parent_org_id: string };

// Organizations own facilities, and provider staff are assigned to an
// organization: they then manage every facility under it in the provider portal.
export default async function OrganizationsPage({ searchParams }: PageProps<"/admin/organizations">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  const { data, count } = await supabase
    .from("organization")
    .select("id, name", { count: "exact" })
    .order("name")
    .order("id")
    .range(from, to);
  const organizations = (data ?? []) as OrganizationRow[];
  const ids = organizations.map((organization) => organization.id);

  const [staff, facilities, accounts] = await Promise.all([
    ids.length > 0
      ? supabase.from("organization_staff").select("id, organization_id, app_user(display_name)").in("organization_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length > 0
      ? supabase.from("facility").select("id, name, parent_org_id").in("parent_org_id", ids).order("name")
      : Promise.resolve({ data: [] }),
    supabase
      .from("app_user")
      .select("id, display_name")
      .eq("role", "provider_staff")
      .order("display_name")
      .limit(ACCOUNT_LIMIT),
  ]);
  const staffRows = (staff.data ?? []) as unknown as StaffRow[];
  const facilityRows = (facilities.data ?? []) as FacilityRow[];
  const accountOptions = (accounts.data ?? []) as { id: string; display_name: string | null }[];

  return (
    <>
      <PageHeader title={t("organizations.title")} />
      <p className="text-sm text-zinc-600">{t("organizations.hint")}</p>

      {organizations.length === 0 && <Empty>{t("organizations.empty")}</Empty>}
      {organizations.map((organization) => {
        const members = staffRows.filter((row) => row.organization_id === organization.id);
        const owned = facilityRows.filter((row) => row.parent_org_id === organization.id);
        return (
          <Section key={organization.id} title={organization.name}>
            <span className="text-sm text-zinc-600">
              {owned.length > 0
                ? t("organizations.facilities", { names: owned.map((facility) => facility.name).join(", ") })
                : t("organizations.noFacilities")}
            </span>

            <h3 className="text-sm font-semibold">{t("organizations.staff")}</h3>
            {members.length === 0 ? (
              <Empty>{t("organizations.noStaff")}</Empty>
            ) : (
              <ul className={LIST}>
                {members.map((member) => (
                  <li key={member.id} className="flex flex-col gap-2 px-3 py-3">
                    <span className="font-medium">{member.app_user?.display_name ?? t("users.unnamed")}</span>
                    <ActionForm action={removeOrganizationStaff} submitLabel={t("common.remove")} variant="danger">
                      <input type="hidden" name="id" value={member.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
            {accountOptions.length > 0 && (
              <ActionForm action={addOrganizationStaff} submitLabel={t("organizations.addStaff")} variant="secondary" resetOnSave>
                <input type="hidden" name="organization_id" value={organization.id} />
                <Field label={t("organizations.account")} hint={t("organizations.accountHint")}>
                  <Select name="app_user_id" required defaultValue="">
                    <option value="" disabled>
                      {t("common.choose")}
                    </option>
                    {accountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.display_name ?? t("users.unnamed")}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            )}
          </Section>
        );
      })}
      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />

      <Section title={t("organizations.add")}>
        <ActionForm action={createOrganization} submitLabel={t("organizations.add")} resetOnSave>
          <Field label={t("organizations.name")}>
            <Input name="name" required maxLength={200} />
          </Field>
        </ActionForm>
      </Section>
    </>
  );
}
