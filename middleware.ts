import { updateSession } from "./lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

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
  runtime: 'nodejs',
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * - /api/webhook (exclude the webhook route from middleware)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)|api/webhook$).*)",
  ],
};