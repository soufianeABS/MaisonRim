import { NextResponse, type NextRequest } from "next/server";

const BASE64_PREFIX = "base64-";

async function combineChunks(
  key: string,
  retrieveChunk: (name: string) => Promise<string | null>,
): Promise<string | null> {
  const value = await retrieveChunk(key);
  if (value) {
    return value;
  }
  const values: string[] = [];
  for (let i = 0; ; i++) {
    const chunkName = `${key}.${i}`;
    const chunk = await retrieveChunk(chunkName);
    if (!chunk) {
      break;
    }
    values.push(chunk);
  }
  if (values.length > 0) {
    return values.join("");
  }
  return null;
}

function stringFromBase64URL(b64url: string): string | null {
  try {
    const pad = b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
    const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function getProjectRef(supabaseUrl: string): string {
  try {
    const host = new URL(supabaseUrl).hostname;
    const m = host.match(/^([^.]+)\.supabase\.co$/);
    return m?.[1] ?? "";
  } catch {
    return "";
  }
}

async function getUserFromRequest(
  request: NextRequest,
  supabaseUrl: string,
  anonKey: string,
): Promise<{ id: string } | null> {
  const projectRef =
    process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF || getProjectRef(supabaseUrl);
  if (!projectRef) {
    return null;
  }

  const storageKey = `sb-${projectRef}-auth-token`;
  const allCookies = request.cookies.getAll();

  const retrieveChunk = async (chunkName: string) => {
    const c = allCookies.find((x) => x.name === chunkName);
    return c?.value ?? null;
  };

  const chunkedCookie = await combineChunks(storageKey, retrieveChunk);
  if (!chunkedCookie) {
    return null;
  }

  let decoded = chunkedCookie;
  if (
    typeof chunkedCookie === "string" &&
    chunkedCookie.startsWith(BASE64_PREFIX)
  ) {
    const fromB64 = stringFromBase64URL(
      chunkedCookie.substring(BASE64_PREFIX.length),
    );
    if (fromB64 === null) {
      return null;
    }
    decoded = fromB64;
  }

  let session: { access_token?: string };
  try {
    session = JSON.parse(decoded) as { access_token?: string };
  } catch {
    return null;
  }

  const accessToken = session.access_token;
  if (!accessToken) {
    return null;
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
    });

    if (!res.ok) {
      return null;
    }

    const body = (await res.json()) as { id?: string };
    return body.id ? { id: body.id } : null;
  } catch {
    return null;
  }
}

async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  const hasEnvVars = supabaseUrl && anonKey;

  const response = NextResponse.next({
    request,
  });

  if (!hasEnvVars) {
    return response;
  }

  const user = await getUserFromRequest(request, supabaseUrl!, anonKey!);

  if (
    request.nextUrl.pathname !== "/" &&
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export async function middleware(request: NextRequest) {
  try {
    if (request.nextUrl.pathname.startsWith("/api/webhook")) {
      return NextResponse.next();
    }
    return await updateSession(request);
  } catch (err) {
    console.error("[middleware]", err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)|api/webhook$).*)",
  ],
};
