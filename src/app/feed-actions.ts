"use server";

import { db } from "../db/client.js";
import { getFeed, normalizeFeedSource, type FeedSort, type FeedSource } from "./feed-queries.js";
import { toFeedData, type FeedItemData } from "./feed-item-data.js";

const PAGE_SIZE = 30;

export interface FeedPageResult {
  items: FeedItemData[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

export async function loadFeedPage(
  page: number,
  sort: FeedSort,
  source: FeedSource,
): Promise<FeedPageResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSort: FeedSort = sort === "score" ? "score" : "time";
  const safeSource = normalizeFeedSource(source);
  const res = await getFeed(db, {
    page: safePage,
    pageSize: PAGE_SIZE,
    sort: safeSort,
    source: safeSource,
  });
  const now = new Date();
  return {
    items: res.items.map((it) => toFeedData(it, now, res.rMin, res.rMax)),
    total: res.total,
    page: res.page,
    totalPages: res.totalPages,
    hasMore: res.page < res.totalPages,
  };
}
