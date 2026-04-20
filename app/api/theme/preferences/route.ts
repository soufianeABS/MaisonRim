import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  THEME_COLOR_KEYS,
  type ThemeColorMap,
} from "@/lib/theme-color-defaults";

export const runtime = "nodejs";

const HSL_RE = /^\d{1,3}\s+\d{1,3}(?:\.\d+)?%\s+\d{1,3}(?:\.\d+)?%$/;

function isMissingColumnError(e: unknown, columnName: string): boolean {
  if (!e || typeof e !== "object") return false;
  const anyErr = e as { code?: string; message?: string };
  const msg = (anyErr.message ?? "").toLowerCase();
  return anyErr.code === "42703" || msg.includes(columnName.toLowerCase());
}

function sanitizeMap(raw: unknown): ThemeColorMap | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || raw === null) return null;
  const out: ThemeColorMap = {};
  const o = raw as Record<string, unknown>;
  for (const key of THEME_COLOR_KEYS) {
    const v = o[key];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!HSL_RE.test(t)) continue;
    out[key] = t;
  }
  return out;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_settings")
    .select("theme_custom_colors")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error, "theme_custom_colors")) {
      return NextResponse.json({
        theme_custom_colors: null as { light?: ThemeColorMap; dark?: ThemeColorMap } | null,
        warning:
          "Missing column user_settings.theme_custom_colors. Apply sql/theme_custom_colors.sql",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data as { theme_custom_colors?: unknown } | null)?.theme_custom_colors;
  if (raw == null || typeof raw !== "object") {
    return NextResponse.json({ theme_custom_colors: null });
  }

  const obj = raw as Record<string, unknown>;
  const light = sanitizeMap(obj.light) ?? {};
  const dark = sanitizeMap(obj.dark) ?? {};

  return NextResponse.json({
    theme_custom_colors: {
      light,
      dark,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (b.clear === true) {
    const { error } = await supabase.from("user_settings").upsert(
      {
        id: user.id,
        theme_custom_colors: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) {
      if (isMissingColumnError(error, "theme_custom_colors")) {
        return NextResponse.json(
          {
            error:
              "Missing column user_settings.theme_custom_colors. Apply sql/theme_custom_colors.sql",
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ theme_custom_colors: null });
  }

  const light = sanitizeMap(b.light);
  const dark = sanitizeMap(b.dark);
  if (light === null || dark === null) {
    return NextResponse.json(
      { error: "Provide light and dark objects with color values." },
      { status: 400 },
    );
  }

  const hasAny = Object.keys(light).length > 0 || Object.keys(dark).length > 0;

  const { error } = await supabase.from("user_settings").upsert(
    {
      id: user.id,
      theme_custom_colors: hasAny ? { light, dark } : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    if (isMissingColumnError(error, "theme_custom_colors")) {
      return NextResponse.json(
        {
          error:
            "Missing column user_settings.theme_custom_colors. Apply sql/theme_custom_colors.sql",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    theme_custom_colors: hasAny ? { light, dark } : null,
  });
}
