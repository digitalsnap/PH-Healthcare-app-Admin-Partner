"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/lib/admin/form-state";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

/**
 * Wraps a server-rendered form around a server action: shows its errors and a
 * pending state. The fields themselves stay server components (children).
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  variant = "primary",
  resetOnSave = false,
}: {
  action: Action;
  submitLabel: string;
  children?: React.ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
  /** Clear the fields after a successful save (for "add another" forms). */
  resetOnSave?: boolean;
}) {
  const t = useTranslations("admin");
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const saved = state !== null && "saved" in state;

  useEffect(() => {
    if (saved && resetOnSave) formRef.current?.reset();
  }, [state, saved, resetOnSave]);

  const buttonStyle = {
    primary: "bg-zinc-900 text-white",
    secondary: "border border-zinc-300 bg-white text-zinc-900",
    danger: "border border-red-300 bg-white text-red-700",
  }[variant];

  return (
    <form
      ref={formRef}
      action={formAction}
      // Submitting through a transition keeps what was typed when validation
      // fails, instead of React clearing the form — it matters on mobile data.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className={className ?? "flex flex-col gap-4"}
    >
      {children}
      {state !== null && "errors" in state && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-red-700">
          {state.errors.map((code) => (
            <li key={code}>{t(`errors.${code}`)}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`min-h-11 rounded px-4 py-2 text-base font-medium disabled:opacity-60 ${buttonStyle}`}
        >
          {pending ? t("common.saving") : submitLabel}
        </button>
        {saved && !pending && (
          <span role="status" className="text-sm text-green-700">
            {t("common.saved")}
          </span>
        )}
      </div>
    </form>
  );
}
