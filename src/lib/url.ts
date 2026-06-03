const TRACKING = /^(utm_|fbclid$|gclid$|mc_eid$|ref$|ref_src$)/i;

export function canonicalizeUrl(input: string | null): string | null {
  if (!input) return null;
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.hash = "";
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  let out = u.toString();
  out = out.replace(/\/(\?|$)/, "$1"); // strip trailing slash before query/end
  return out;
}
