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
