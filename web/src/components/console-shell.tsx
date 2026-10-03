import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOut } from "@/lib/auth/actions";

export type NavItem = { href: string; label: string };

/** Shared frame for the signed-in consoles: a title bar, navigation and sign-out. */
export async function ConsoleShell({
  title,
  nav = [],
  children,
}: {
  title: string;
  nav?: NavItem[];
  children: React.ReactNode;
}) {
  const t = await getTranslations("console");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold">{title}</span>
          <form action={signOut}>
            <button type="submit" className="min-h-11 text-sm underline">
              {t("signOut")}
            </button>
          </form>
        </div>
        {nav.length > 0 && (
          // Scrolls sideways on a phone instead of wrapping into a tall block.
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-11 shrink-0 items-center rounded px-3 hover:bg-zinc-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">{children}</main>
    </div>
  );
}
