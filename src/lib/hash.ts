import { createHash } from "node:crypto";

export function contentHash(input: { title: string; text: string }): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${norm(input.title)}\n${norm(input.text)}`)
    .digest("hex");
}
