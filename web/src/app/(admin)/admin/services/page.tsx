import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Field, Input, LIST, PageHeader, Section, Select } from "@/components/admin/fields";
import { Pagination } from "@/components/admin/pagination";
import { createService } from "@/lib/admin/actions/catalogue";
import { adminContext } from "@/lib/admin/context";
import { pageOf, rangeOf } from "@/lib/admin/pagination";
import { SERVICE_TYPES } from "@/lib/admin/schemas";
import type { ServiceRow } from "@/lib/admin/types";

const PATHNAME = "/admin/services";

// The service catalogue. Prices for a service are entered per facility, on
// the facility's page.
export default async function ServicesPage({ searchParams }: PageProps<"/admin/services">) {
  const { supabase } = await adminContext();
  const t = await getTranslations("admin");
  const query = await searchParams;
  const page = pageOf(query);
  const [from, to] = rangeOf(page);

  const { data, count } = await supabase
    .from("service")
    .select("id, service_type, name, description", { count: "exact" })
    .order("name")
    .order("id")
    .range(from, to);
  const rows = (data ?? []) as ServiceRow[];

  return (
    <>
      <PageHeader title={t("services.title")} />
      <p className="text-sm text-zinc-600">{t("services.pricesHint")}</p>

      {rows.length === 0 ? (
        <Empty>{t("services.empty")}</Empty>
      ) : (
        <ul className={LIST}>
          {rows.map((service) => (
            <li key={service.id} className="flex flex-col gap-1 px-3 py-3">
              <span className="font-medium">{service.name}</span>
              <span className="text-sm text-zinc-600">
                {t(`serviceTypes.${service.service_type}`)}
                {service.description ? ` · ${service.description}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Pagination pathname={PATHNAME} searchParams={query} page={page} total={count ?? 0} />

      <Section title={t("services.add")}>
        <ActionForm action={createService} submitLabel={t("services.add")} resetOnSave>
          <Field label={t("services.type")}>
            <Select name="service_type" required defaultValue="">
              <option value="" disabled>
                {t("common.choose")}
              </option>
              {SERVICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`serviceTypes.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("services.name")}>
            <Input name="name" required maxLength={200} />
          </Field>
          <Field label={t("services.description")}>
            <Input name="description" maxLength={500} />
          </Field>
        </ActionForm>
      </Section>
    </>
  );
}
