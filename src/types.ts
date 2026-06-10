export type SourceKind = "hn" | "rss" | "reddit" | "twitter";

export interface RawPayload {
  source: SourceKind;
  externalId: string;
  url: string | null;
  author: string | null;
  title: string;
  text: string;
  createdAt: string; // ISO 8601
  metrics: Record<string, number>;
  feed?: string; // provenance: reddit hot/new, twitter following/for-you
  raw: unknown;
}

// Persisted on raw_items.triage when the row is marked processed, so /raw can
// explain WHY a row was kept or dropped (filter-accuracy analysis). Older rows
// triaged before this column existed have NULL.
export interface TriageDecision {
  q: number;
  gate: number;
  llmValue: number;
  relevance: number;
  trust: number;
  kept: boolean;
  rescued: boolean;
  reason: string;
}

export interface NormalizedItem {
  source: SourceKind;
  url: string | null;
  canonicalUrl: string | null;
  author: string | null;
  title: string;
  text: string;
  createdAt: Date;
  metrics: Record<string, number>;
  feed?: string;
  contentHash: string;
}
