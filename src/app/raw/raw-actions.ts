"use server";

import { db } from "../../db/client.js";
import { getRawFeed, normalizeRawSource, type RawFeedItem, type RawSource } from "./raw-queries.js";

const PAGE_SIZE = 30;

export interface RawPageResult {
  items: RawFeedItem[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

export async function loadRawPage(page: number, source: RawSource): Promise<RawPageResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSource = normalizeRawSource(source);
  const res = await getRawFeed(db, { page: safePage, pageSize: PAGE_SIZE, source: safeSource });
  return {
    items: res.items,
    total: res.total,
    page: res.page,
    totalPages: res.totalPages,
    hasMore: res.page < res.totalPages,
  };
}
