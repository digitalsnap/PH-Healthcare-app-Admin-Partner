import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveLocale } from "./config";

// The locale comes from a cookie rather than the URL, so paths stay the same
// in every language.
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return {
    locale,
    timeZone: "Asia/Manila",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
