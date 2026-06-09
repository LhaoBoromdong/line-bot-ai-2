const TTL_MS = 60_000;
let cache: { csv: string; at: number } | null = null;

export async function getFaqCsv(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.csv;

  const res = await fetch(process.env.SHEET_CSV_URL!, { cache: "no-store" });

  if (!res.ok) {
    if (cache) {
      console.warn("[sheet] fetch fail, ใช้ cache เดิม:", res.status);
      return cache.csv;
    }
    throw new Error(`Sheet fetch failed: ${res.status}`);
  }

  const csv = await res.text();
  cache = { csv, at: now };
  return csv;
}
