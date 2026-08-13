import { NextRequest, NextResponse } from "next/server";

import {
  getAuthConfig,
  isValidSessionToken,
  sessionCookieName,
} from "@/lib/auth";

const publicPaths = new Set([
  "/",
  "/login",
  "/api/auth/login",
  "/api/health",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon.svg",
  "/apple-icon.png",
]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (publicPaths.has(pathname) || pathname.startsWith("/icons/")) {
    return NextResponse.next();
  }

  const config = getAuthConfig();
  if (!config) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "La autenticación del sitio no está configurada." },
        { status: 503 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "config");
    return NextResponse.redirect(loginUrl);
  }

  const authenticated = isValidSessionToken(
    request.cookies.get(sessionCookieName)?.value,
    config,
  );
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Sesión no válida o caducada." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|robots.txt|sitemap.xml).*)"],
};
