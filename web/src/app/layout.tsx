import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name"), description: t("tagline") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();

  // Only the strings client components use are sent to the browser; everything
  // else is rendered on the server. Keeps every page's payload small on weak
  // connections. Add a namespace here when a client component needs it.
  const clientMessages = {
    login: messages.login,
    admin: { errors: messages.admin.errors, common: messages.admin.common },
    doctor: { calendar: messages.doctor.calendar },
  };

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={clientMessages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
