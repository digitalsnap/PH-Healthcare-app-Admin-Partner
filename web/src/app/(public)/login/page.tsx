import { getTranslations } from "next-intl/server";
import { LoginForm } from "./login-form";

// Sign-in for the internal team, doctors and partner facilities only.
export default async function LoginPage() {
  const t = await getTranslations("login");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-600">{t("subtitle")}</p>
      </div>
      <LoginForm />
    </main>
  );
}
