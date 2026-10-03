import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { inviteUser, updateAccount } from "@/lib/admin/actions/users";
import { adminContext } from "@/lib/admin/context";
import { pageOf, rangeOf } from "@/lib/admin/pagination";
import type { AccountRow } from "@/lib/admin/types";
import { APP_ROLES } from "@/lib/auth/roles";

const PATHNAME = "/admin/users";

// Console accounts only (rows with a role). Patient and family accounts are
// not listed here.
export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const { supabase, actorId } = await adminContext(["admin"]);
  const t = await getTranslations("admin");
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  const { data, count } = await supabase
    .from("app_user")
    .select("id, role, display_name, is_active, created_at", { count: "exact" })
    .not("role", "is", null)
    .order("display_name")
    .order("id")
    .range(from, to);
  const rows = (data ?? []) as AccountRow[];

  return (
    <>
      <PageHeader title={t("users.title")} />

      {rows.length === 0 ? (
        <Empty>{t("users.empty")}</Empty>
      ) : (
        <ul className={LIST}>
          {rows.map((account) => (
            <li key={account.id} className="flex flex-col gap-2 px-3 py-3">
              <span className="font-medium">
                {account.display_name ?? t("users.unnamed")}
                {account.id === actorId ? ` · ${t("users.you")}` : ""}
                {account.is_active ? "" : ` · ${t("users.inactive")}`}
              </span>
              {account.id === actorId ? (
                <span className="text-sm text-zinc-600">{account.role ? t(`roles.${account.role}`) : ""}</span>
              ) : (
                <ActionForm action={updateAccount} submitLabel={t("common.save")} variant="secondary">
                  <input type="hidden" name="id" value={account.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("users.role")}>
                      <Select name="role" defaultValue={account.role ?? ""}>
                        <option value="">{t("users.noRole")}</option>
                        {APP_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t(`roles.${role}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("users.access")}>
                      <Select name="is_active" defaultValue={String(account.is_active)}>
                        <option value="true">{t("users.active")}</option>
                        <option value="false">{t("users.inactive")}</option>
                      </Select>
                    </Field>
                  </div>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />

      <Section title={t("users.invite")}>
        <p className="text-sm text-zinc-600">{t("users.inviteHint")}</p>
        <ActionForm action={inviteUser} submitLabel={t("users.sendInvite")} resetOnSave>
          <Field label={t("users.email")}>
            <Input name="email" type="email" required maxLength={254} autoComplete="off" />
          </Field>
          <Field label={t("users.displayName")}>
            <Input name="display_name" required maxLength={200} />
          </Field>
          <Field label={t("users.role")}>
            <Select name="role" required defaultValue="staff">
              {APP_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
      </Section>
    </>
  );
}
