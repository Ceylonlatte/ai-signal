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
  raw: unknown;
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
  contentHash: string;
}
