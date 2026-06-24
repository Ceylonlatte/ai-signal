"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Soft-refresh the status route's server data on an interval while this page is
// mounted. This replaces a <meta http-equiv="refresh">, which (rendered in the
// page body) armed a browser refresh that captured the /status URL and was not
// cancelled on client-side navigation — so after visiting /status, any page
// would bounce back to /status within the interval. router.refresh() re-runs the
// server component in place (no full reload, no flash), and the interval is
// cleared on unmount, so navigating away leaves nothing armed.
export function StatusAutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
