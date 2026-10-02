"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { homePathForRole, LOGIN_PATH } from "./roles";
import { fetchRole } from "./fetch-role";

const signInSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

/** `error` is an i18n key under the `login.errors` namespace. */
export type SignInState = { error: "invalid" | "noAccess" } | null;

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: "invalid" };

  // The web has no patient surface: an account without a console role has
  // nowhere to go here.
  const role = await fetchRole(supabase, data.user.id);
  if (role === null) {
    await supabase.auth.signOut();
    return { error: "noAccess" };
  }

  redirect(homePathForRole(role));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}
