/**
 * Single in-memory cache for GET /api/contact-statuses so ChatWindow + UserList
 * don't refetch the full list on every conversation click.
 */
type StatusRow = {
  id: string;
  name?: string;
  color?: string;
  rule?: string | null;
  rule_mode?: string | null;
};

/** API rows normalized for UI (required name/color strings). */
export type ContactStatusNormalized = {
  id: string;
  name: string;
  color: string;
  rule: string;
  rule_mode?: string | null;
};

function normalizeStatusRow(row: StatusRow): ContactStatusNormalized {
  return {
    id: row.id,
    name: (row.name ?? "").trim() || "Untitled",
    color: (row.color ?? "").trim() || "#94a3b8",
    rule: row.rule ?? "",
    rule_mode: row.rule_mode ?? null,
  };
}

const TTL_MS = 5 * 60 * 1000;

let cachedAt = 0;
let cachedList: ContactStatusNormalized[] | null = null;
let inflight: Promise<ContactStatusNormalized[]> | null = null;

export async function fetchContactStatusesCached(): Promise<ContactStatusNormalized[]> {
  const now = Date.now();
  if (cachedList && now - cachedAt < TTL_MS) {
    return cachedList;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    const res = await fetch("/api/contact-statuses", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Failed to load statuses");
    }
    const raw = Array.isArray(data?.statuses) ? (data.statuses as StatusRow[]) : [];
    const normalized = raw.map(normalizeStatusRow);
    cachedList = normalized;
    cachedAt = Date.now();
    return normalized;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** Call after creating/updating/deleting statuses so the next fetch is fresh. */
export function invalidateContactStatusesCache(): void {
  cachedList = null;
  cachedAt = 0;
}

/** Sync cache from a fresh API response (e.g. Statuses settings page). */
export function seedContactStatusesCache(statuses: StatusRow[]): void {
  cachedList = statuses.map(normalizeStatusRow);
  cachedAt = Date.now();
}
