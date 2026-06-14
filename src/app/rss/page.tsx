import { redirect } from "next/navigation";

// Force dynamic so the redirect is issued as a real server-side 307 on every
// request, instead of being statically prerendered into a client-only redirect.
export const dynamic = "force-dynamic";

export default function RssPage() {
  redirect("/?source=rss");
}
