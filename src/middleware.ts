import NextAuth from "next-auth";
import { authConfig } from "./auth.config.js";

// Session-based gate: unauthenticated visitors are redirected to /login (handled
// by the `authorized` callback in auth.config), never challenged with the
// browser's native Basic-Auth dialog.
export const { auth: middleware } = NextAuth(authConfig);

// Exclude /api so NextAuth's middleware never runs on the OAuth routes
// (/api/auth/*) — running it there clobbers the state/pkce/csrf cookies and
// breaks the Google sign-in callback. /api/ingest guards itself with a bearer
// token, and page data is fetched in RSCs, so no /api route needs the session gate.
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
