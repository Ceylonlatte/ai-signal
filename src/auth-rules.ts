// Edge-safe, dependency-free auth rules. Kept apart from auth.config.ts so the
// middleware routing + email allowlist can be unit-tested without loading the
// full NextAuth/provider stack.

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Gate for which Google accounts may sign in. Empty allowlist ⇒ deny everyone
 * (safe default: a freshly-deployed instance is locked until an email is added).
 */
export function isEmailAllowed(
  email: string | null | undefined,
  emailVerified: boolean | undefined,
  allowRaw: string | undefined = process.env.AUTH_ALLOWED_EMAILS,
): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  if (emailVerified === false) return false;
  const allow = parseAllowlist(allowRaw);
  if (allow.length === 0) return false;
  return allow.includes(e);
}

type AuthorizedParams = {
  auth: { user?: unknown } | null;
  request: { nextUrl: URL };
};

/**
 * NextAuth `authorized` callback (also the middleware gate). Returns `true` to
 * allow, `false` to bounce an unauthenticated visitor to the /login page (no
 * browser Basic-Auth dialog), or a redirect Response for the logged-in-on-login
 * case.
 */
export function authorized({ auth, request: { nextUrl } }: AuthorizedParams): boolean | Response {
  const { pathname } = nextUrl;
  // Public surfaces: the ingest API guards itself with a bearer token, and
  // NextAuth's own routes must stay reachable to complete the OAuth handshake.
  if (pathname.startsWith("/api/ingest") || pathname.startsWith("/api/auth")) return true;

  const isLoggedIn = !!auth?.user;
  if (pathname === "/login") {
    return isLoggedIn ? Response.redirect(new URL("/", nextUrl)) : true;
  }
  return isLoggedIn;
}
