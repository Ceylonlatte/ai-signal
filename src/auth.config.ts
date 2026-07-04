import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { authorized, isEmailAllowed } from "./auth-rules.js";

// Dev convenience only: lets the app boot without AUTH_SECRET locally. In
// production the secret is required — leaving it undefined makes NextAuth throw,
// which is the correct "you must configure auth before shipping" failure.
const devSecret =
  process.env.NODE_ENV !== "production" ? "dev-insecure-secret-change-me" : undefined;

export const authConfig = {
  // Self-hosted behind a reverse proxy: trust the deployment Host header.
  trustHost: true,
  secret: process.env.AUTH_SECRET || devSecret,
  providers: [Google],
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    authorized,
    signIn({ user, profile }) {
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
      return isEmailAllowed(profile?.email ?? user?.email, verified);
    },
  },
} satisfies NextAuthConfig;
