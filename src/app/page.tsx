import { db } from "../db/client.js";
import { getFeed } from "./feed-queries.js";
import { FeedbackButtons } from "./feedback-buttons.js";

export const dynamic = "force-dynamic";

export default async function Home() {
  const feed = await getFeed(db, { limit: 50 });
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>AI Signal</h1>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {feed.map((item: any) => (
          <li key={item.id} style={{ padding: "0.9rem 0", borderBottom: "1px solid #eee" }}>
            <a href={item.url ?? "#"} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a>
            <FeedbackButtons itemId={item.id} />
            {item.summary && <div style={{ margin: "4px 0" }}>{item.summary}</div>}
            <div style={{ fontSize: 12, color: "#888" }}>
              {item.source} · score {item.composite?.toFixed?.(2) ?? "—"}
              {Array.isArray(item.topicTags) && item.topicTags.length > 0 && ` · ${item.topicTags.join(", ")}`}
              {item.reason && ` · ${item.reason}`}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
