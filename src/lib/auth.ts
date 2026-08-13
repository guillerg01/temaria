import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "aula_session";
export const sessionDurationSeconds = 60 * 60 * 24 * 20;

type AuthConfig = {
  password: string;
  secret: string;
};

export function getAuthConfig(): AuthConfig | null {
  const password = process.env.SITE_PASSWORD?.trim();
  const secret = process.env.AUTH_SECRET?.trim();
  if (!password || !secret || secret.length < 32) return null;
  return { password, secret };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function passwordsMatch(candidate: string, expected: string) {
  return timingSafeEqual(digest(candidate), digest(expected));
}

function passwordVersion(password: string) {
  return createHash("sha256").update(password).digest("base64url").slice(0, 16);
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(config: AuthConfig) {
  const expiresAt = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const payload = `${expiresAt}.${passwordVersion(config.password)}`;
  return `${payload}.${sign(payload, config.secret)}`;
}

export function isValidSessionToken(
  token: string | undefined,
  config: AuthConfig,
) {
  if (!token) return false;
  const [expiresAt, version, signature, ...extra] = token.split(".");
  if (extra.length || !expiresAt || !version || !signature) return false;
  if (
    !/^\d+$/.test(expiresAt) ||
    Number(expiresAt) <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }
  if (!passwordsMatch(version, passwordVersion(config.password))) return false;

  const expected = sign(`${expiresAt}.${version}`, config.secret);
  return passwordsMatch(signature, expected);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: sessionDurationSeconds,
  };
}

export function hasValidSession(token: string | undefined) {
  const config = getAuthConfig();
  return Boolean(config && isValidSessionToken(token, config));
}
