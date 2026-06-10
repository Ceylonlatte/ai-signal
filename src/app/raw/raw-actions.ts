"use server";

import { db } from "../../db/client.js";
import {
  getRawFeed, normalizeRawSource, normalizeRawState,
  type RawFeedItem, type RawSource, type RawState,
} from "./raw-queries.js";

const PAGE_SIZE = 30;

export interface RawPageResult {
  items: RawFeedItem[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

export async function loadRawPage(page: number, source: RawSource, state: RawState): Promise<RawPageResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSource = normalizeRawSource(source);
  const safeState = normalizeRawState(state);
  const res = await getRawFeed(db, { page: safePage, pageSize: PAGE_SIZE, source: safeSource, state: safeState });
  return {
    items: res.items,
    total: res.total,
    page: res.page,
    totalPages: res.totalPages,
    hasMore: res.page < res.totalPages,
  };
}
