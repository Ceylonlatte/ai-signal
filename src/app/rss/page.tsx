import { redirect } from "next/navigation";

export default function RssPage() {
  redirect("/?source=rss");
}
