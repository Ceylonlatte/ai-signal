import { db } from "../db/client.js";
import { getFeed } from "./feed-queries.js";

export const dynamic = "force-dynamic";

export default async function Home() {
  const feed = await getFeed(db, { limit: 50 });
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>AI Signal</h1>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {feed.map((item: { id: number; title: string; url: string | null; source: string; createdAt: Date }) => (
          <li key={item.id} style={{ padding: "0.75rem 0", borderBottom: "1px solid #eee" }}>
            <a href={item.url ?? "#"} target="_blank" rel="noreferrer">{item.title}</a>
            <div style={{ fontSize: 12, color: "#888" }}>
              {item.source} · {new Date(item.createdAt).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
