/**
 * Form and layout primitives for the admin console. Sized for a phone: inputs
 * are full-width with 16px text (no zoom on focus) and 44px touch targets.
 */

const CONTROL =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base font-normal";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-zinc-600">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL} />;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-200 p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {action}
    </div>
  );
}

/** Label / value pairs that stack on a phone. */
export function Facts({ items }: { items: Array<[label: string, value: React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-zinc-600">{label}</dt>
          <dd className="mb-2 sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-600">{children}</p>;
}

export const LINK_BUTTON =
  "inline-flex min-h-11 items-center rounded border border-zinc-300 bg-white px-4 py-2 text-base font-medium";

export const PRIMARY_LINK_BUTTON =
  "inline-flex min-h-11 items-center rounded bg-zinc-900 px-4 py-2 text-base font-medium text-white";

/** A list row that is one large tap target. */
export const ROW_LINK = "flex flex-col gap-1 px-3 py-3 hover:bg-zinc-50";

export const LIST = "divide-y divide-zinc-200 rounded border border-zinc-200";
