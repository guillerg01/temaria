import { NextResponse } from "next/server";

import {
  createSessionToken,
  getAuthConfig,
  passwordsMatch,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";

export const runtime = "nodejs";

const attempts = new Map<string, { count: number; resetAt: number }>();
const attemptWindowMs = 15 * 60 * 1000;
const maxAttempts = 8;

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 },
    );
  }

  const config = getAuthConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Define SITE_PASSWORD y un AUTH_SECRET de al menos 32 caracteres.",
      },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= maxAttempts) {
    return NextResponse.json(
      {
        error:
          "Demasiados intentos. Espera unos minutos antes de volver a probar.",
      },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!passwordsMatch(password, config.password)) {
    const next =
      current && current.resetAt > now
        ? { count: current.count + 1, resetAt: current.resetAt }
        : { count: 1, resetAt: now + attemptWindowMs };
    attempts.set(key, next);
    return NextResponse.json(
      { error: "Contraseña incorrecta." },
      { status: 401 },
    );
  }

  attempts.delete(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    sessionCookieName,
    createSessionToken(config),
    sessionCookieOptions(),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
