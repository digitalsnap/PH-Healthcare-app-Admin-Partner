import { getTranslations } from "next-intl/server";
import { signOut } from "@/lib/auth/actions";

/** Shared frame for the signed-in consoles: a title bar with sign-out. */
export async function ConsoleShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("console");

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <span className="font-semibold">{title}</span>
        <form action={signOut}>
          <button type="submit" className="text-sm underline">
            {t("signOut")}
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
