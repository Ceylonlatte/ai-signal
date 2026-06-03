import { db } from "../../db/client.js";
import { getTopTopics } from "./trend-queries.js";

export const dynamic = "force-dynamic";

export default async function Topics() {
  const today = new Date().toISOString().slice(0, 10);
  const top = await getTopTopics(db, { date: today });
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Today's Topics — {today}</h1>
      <ol>
        {top.map((t: any) => (
          <li key={t.id}>{t.label} <small>({t.itemCount} items · score {Number(t.scoreSum).toFixed(1)})</small></li>
        ))}
      </ol>
    </main>
  );
}
