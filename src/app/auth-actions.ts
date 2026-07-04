"use server";

import { signIn, signOut } from "../auth.js";

export async function signInWithGoogle(callbackUrl: string): Promise<void> {
  await signIn("google", { redirectTo: callbackUrl || "/" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
