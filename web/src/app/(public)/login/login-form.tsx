"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signIn, type SignInState } from "@/lib/auth/actions";

export function LoginForm() {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t("email")}
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded border border-zinc-300 px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("password")}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-zinc-300 px-3 py-2 text-base"
        />
      </label>
      {state && (
        <p role="alert" className="text-sm text-red-700">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-2 text-base font-medium text-white disabled:opacity-60"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
