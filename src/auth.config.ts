import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { authorized, isEmailAllowed } from "./auth-rules.js";

// Read auth env at RUNTIME, never at build time. `next build` statically inlines
// any literal `process.env.AUTH_SECRET` etc; our CI builds the image without these
// secrets present, which freezes them to `undefined` and makes NextAuth throw
// MissingSecret at runtime even though the container's env has them set. Indexing
// process.env with a (non-literal) parameter defeats that inlining and forces a
// real lookup in both the Node route handlers and the Edge middleware.
function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}

// Dev convenience only: lets the app boot without AUTH_SECRET locally. In
// production the secret is required — leaving it undefined makes NextAuth throw,
// which is the correct "you must configure auth before shipping" failure.
const devSecret =
  process.env.NODE_ENV !== "production" ? "dev-insecure-secret-change-me" : undefined;

export const authConfig = {
  // Self-hosted behind a reverse proxy: trust the deployment Host header.
  trustHost: true,
  secret: runtimeEnv("AUTH_SECRET") || devSecret,
  providers: [
    Google({
      clientId: runtimeEnv("AUTH_GOOGLE_ID"),
      clientSecret: runtimeEnv("AUTH_GOOGLE_SECRET"),
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    authorized,
    signIn({ user, profile }) {
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
      return isEmailAllowed(
        profile?.email ?? user?.email,
        verified,
        runtimeEnv("AUTH_ALLOWED_EMAILS"),
      );
    },
  },
} satisfies NextAuthConfig;
