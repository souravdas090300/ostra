import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Exclude cron and webhook endpoints from session check (they use their own auth)
  if (pathname.startsWith("/api/cron/") || pathname.startsWith("/api/webhooks/")) {
    return NextResponse.next();
  }

  // Require session for all other /app/** and /api/** routes
  if (pathname.startsWith("/app/") || pathname.startsWith("/api/")) {
    if (!req.auth) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
