import { redirect } from "next/navigation";

// The "收藏" surface moved to /library (now ⭐ knowledge base). Keep this old
// path as a real server-side 307 redirect so existing bookmarks don't 404.
export const dynamic = "force-dynamic";

export default function LikedPage() {
  redirect("/library");
}
