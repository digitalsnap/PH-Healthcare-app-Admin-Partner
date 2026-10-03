import { ActionForm } from "@/components/admin/action-form";
import { LIST } from "@/components/admin/fields";
import type { FormState } from "@/lib/admin/form-state";

export type RequestRow = {
  id: string;
  title: string;
  detail: string;
  statusLabel: string;
  /** Final states are shown muted. */
  open: boolean;
  next: Array<{ status: string; label: string; danger: boolean }>;
};

/** A reservation or refill list: each row with the steps that are legal next. */
export function PharmacyRequestList({
  rows,
  facilityId,
  action,
}: {
  rows: RequestRow[];
  facilityId: string;
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
}) {
  return (
    <ul className={LIST}>
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2 px-3 py-3">
          <span className="font-medium">{row.title}</span>
          <span className="text-sm text-zinc-600">{row.detail}</span>
          <span
            className={`w-fit rounded border px-2 py-0.5 text-xs font-medium ${
              row.open ? "border-blue-300 bg-blue-50 text-blue-900" : "border-zinc-300 bg-zinc-100 text-zinc-700"
            }`}
          >
            {row.statusLabel}
          </span>
          {row.next.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {row.next.map((step) => (
                <ActionForm
                  key={step.status}
                  action={action}
                  submitLabel={step.label}
                  variant={step.danger ? "danger" : "primary"}
                >
                  <input type="hidden" name="facility_id" value={facilityId} />
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="status" value={step.status} />
                </ActionForm>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
