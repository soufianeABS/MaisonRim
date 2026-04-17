/**
 * Fetch from the Next.js server using browser-like headers.
 * Helps with some origins that block non-browser clients (e.g. Cloudflare challenges).
 * Does not solve JS challenges — those still require a real browser or other tooling.
 */

const BROWSER_LIKE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

export function isLikelyCloudflareChallenge(body: string): boolean {
  return body.includes("challenge-error-text") || body.includes("Just a moment");
}

type HttpMethod = "GET" | "POST";

export async function fetchWithServerProxy(params: {
  url: string;
  method: HttpMethod;
  /** For POST, JSON body (same as direct ActionRunner fetch). */
  jsonBody?: unknown;
}): Promise<Response> {
  const { url, method, jsonBody } = params;
  const headers: Record<string, string> = { ...BROWSER_LIKE_HEADERS };

  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }

  return fetch(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(jsonBody ?? {}) : undefined,
  });
}
