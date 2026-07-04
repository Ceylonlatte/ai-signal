import { describe, expect, it } from "vitest";
import { authorized, isEmailAllowed } from "../../src/auth-rules.js";

const ctx = (path: string, loggedIn: boolean) => ({
  auth: loggedIn ? { user: { email: "you@gmail.com" } } : null,
  request: { nextUrl: new URL(`http://localhost${path}`) },
});

describe("auth gate routing (authorized)", () => {
  it("lets /api/ingest through without a session (own bearer token)", () => {
    expect(authorized(ctx("/api/ingest", false))).toBe(true);
  });
  it("lets NextAuth's own /api/auth routes through to finish OAuth", () => {
    expect(authorized(ctx("/api/auth/callback/google", false))).toBe(true);
  });
  it("shows the /login page to a logged-out visitor", () => {
    expect(authorized(ctx("/login", false))).toBe(true);
  });
  it("redirects an already-authed user away from /login", () => {
    const res = authorized(ctx("/login", true));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get("location")).toBe("http://localhost/");
  });
  it("blocks the dashboard when logged out (NextAuth then redirects to /login)", () => {
    expect(authorized(ctx("/", false))).toBe(false);
  });
  it("allows the dashboard when logged in", () => {
    expect(authorized(ctx("/", true))).toBe(true);
  });
});

describe("email allowlist (isEmailAllowed)", () => {
  it("denies everyone when the allowlist is empty (safe default)", () => {
    expect(isEmailAllowed("you@gmail.com", true, "")).toBe(false);
    expect(isEmailAllowed("you@gmail.com", true, undefined)).toBe(false);
  });
  it("allows listed emails and denies unlisted ones, case-insensitively", () => {
    const allow = "You@Gmail.com, friend@example.com";
    expect(isEmailAllowed("you@gmail.com", true, allow)).toBe(true);
    expect(isEmailAllowed("FRIEND@example.com", true, allow)).toBe(true);
    expect(isEmailAllowed("stranger@example.com", true, allow)).toBe(false);
  });
  it("rejects unverified Google emails even if listed", () => {
    expect(isEmailAllowed("you@gmail.com", false, "you@gmail.com")).toBe(false);
  });
  it("rejects empty / missing emails", () => {
    expect(isEmailAllowed("", true, "you@gmail.com")).toBe(false);
    expect(isEmailAllowed(null, true, "you@gmail.com")).toBe(false);
  });
});
