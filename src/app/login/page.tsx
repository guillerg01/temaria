import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { hasValidSession, sessionCookieName } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedPath =
    typeof params.next === "string" ? params.next : "/aula";
  const cookieStore = await cookies();
  if (hasValidSession(cookieStore.get(sessionCookieName)?.value)) {
    redirect(
      requestedPath.startsWith("/") && !requestedPath.startsWith("//")
        ? requestedPath
        : "/aula",
    );
  }
  return (
    <LoginForm
      nextPath={requestedPath}
      configurationError={params.error === "config"}
    />
  );
}
