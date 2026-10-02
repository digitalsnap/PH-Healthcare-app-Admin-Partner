import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LOGIN_PATH } from "@/lib/auth/roles";

// Public web is read-only discovery. There is no patient web app: everything
// a patient does ends in "book in the app".
export default async function HomePage() {
  const t = await getTranslations();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold">{t("app.name")}</h1>
      <p className="text-lg">{t("app.tagline")}</p>
      <p className="text-sm text-zinc-600">{t("home.bookInApp")}</p>
      <Link href={LOGIN_PATH} className="text-sm underline">
        {t("home.signIn")}
      </Link>
    </main>
  );
}
