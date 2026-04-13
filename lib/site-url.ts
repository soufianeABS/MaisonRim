/**
 * Base URL for auth redirects (confirmation email, password reset).
 *
 * In production, set NEXT_PUBLIC_SITE_URL to your public origin (e.g. https://app.example.com)
 * so Supabase email links never use localhost from a misconfigured dashboard build or proxy.
 *
 * Falls back to window.location.origin in the browser when unset (local dev).
 */
export function getPublicSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) {
    return fromEnv;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}
