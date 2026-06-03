import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";

beforeAll(() => {
  process.env.BASIC_AUTH_USER = "admin";
  process.env.BASIC_AUTH_PASS = "secret";
});

async function mw() { return (await import("../../src/middleware.js")).middleware; }
const req = (path: string, auth?: string) =>
  new NextRequest(`http://localhost${path}`, auth ? { headers: { authorization: auth } } : {});

describe("basic auth middleware", () => {
  it("lets /api/ingest through without basic auth", async () => {
    const res = (await mw())(req("/api/ingest"));
    expect(res.status).not.toBe(401);
  });
  it("challenges unauthenticated dashboard requests", async () => {
    const res = (await mw())(req("/"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });
  it("allows correct credentials", async () => {
    const token = Buffer.from("admin:secret").toString("base64");
    const res = (await mw())(req("/", `Basic ${token}`));
    expect(res.status).not.toBe(401);
  });
});
