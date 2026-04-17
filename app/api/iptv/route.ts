import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

/**
 * Headless Chromium + stealth to pass many Cloudflare / bot checks.
 *
 * Configure the full target URL in env (includes query params / api_key). Do not commit secrets.
 * Optional: set IPTV_STEALTH_SECRET and send Authorization: Bearer <secret>.
 *
 * Deployment: needs a Node runtime with Chrome/Chromium (typical VPS/Docker).
 * Vercel/serverless often requires a bundled Chromium (e.g. @sparticuz/chromium) — not included here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function resolveTargetUrl(request: NextRequest): { url: string | null; error: string | null } {
  const fromEnv = process.env.IPTV_STEALTH_TARGET_URL?.trim();
  if (fromEnv) return { url: fromEnv, error: null };

  const q = request.nextUrl.searchParams.get("url");
  if (!q?.trim()) {
    return {
      url: null,
      error:
        "No target URL. Set IPTV_STEALTH_TARGET_URL, or in development call GET /api/iptv?url=<encoded-https-url>.",
    };
  }

  // Allow ?url= only in development so production cannot be used as an open proxy.
  if (process.env.NODE_ENV !== "development") {
    return {
      url: null,
      error:
        "IPTV_STEALTH_TARGET_URL is not configured (query ?url= is only allowed in NODE_ENV=development).",
    };
  }

  try {
    const u = new URL(q.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { url: null, error: "Invalid url: only http(s) is allowed." };
    }
    return { url: u.toString(), error: null };
  } catch {
    return { url: null, error: "Invalid url query parameter." };
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.IPTV_STEALTH_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token !== secret) return unauthorized();
  }

  const { url: targetUrl, error: resolveErr } = resolveTargetUrl(request);
  if (!targetUrl) {
    return NextResponse.json(
      {
        error: resolveErr ?? "Target URL could not be resolved",
        hint:
          "Production: set IPTV_STEALTH_TARGET_URL. Local testing: GET /api/iptv?url=" +
          encodeURIComponent("https://example.com/api") +
          " (full panel URL with query string).",
      },
      { status: 503 },
    );
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 90_000 });

    const content = await page.evaluate(() => document.body.innerText);
    const trimmed = content.trim();

    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
    };
    try {
      JSON.parse(trimmed);
      headers["Content-Type"] = "application/json; charset=utf-8";
    } catch {
      // not JSON — keep text/plain
    }

    return new NextResponse(trimmed, { headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/iptv] stealth fetch failed:", message);
    return NextResponse.json(
      { error: "Stealth bypass failed", details: message },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
