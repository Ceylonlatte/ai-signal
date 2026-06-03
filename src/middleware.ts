import { NextRequest, NextResponse } from "next/server";
import { config as env } from "./config.js";

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

export function middleware(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/ingest")) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const expected = "Basic " + Buffer.from(`${env.BASIC_AUTH_USER}:${env.BASIC_AUTH_PASS}`).toString("base64");
  if (header === expected) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ai-signal"' },
  });
}
