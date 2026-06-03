"use client";
import { useState } from "react";

export function FeedbackButtons({ itemId }: { itemId: number }) {
  const [sent, setSent] = useState<string | null>(null);
  async function send(signal: "up" | "down") {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId, signal }),
    });
    setSent(signal);
  }
  return (
    <span style={{ marginLeft: 8 }}>
      <button disabled={!!sent} onClick={() => send("up")}>{sent === "up" ? "👍✓" : "👍"}</button>
      <button disabled={!!sent} onClick={() => send("down")}>{sent === "down" ? "👎✓" : "👎"}</button>
    </span>
  );
}
