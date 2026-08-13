"use client";

import { ArrowRight, BookOpen, LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

export function LoginForm({
  nextPath,
  configurationError,
}: {
  nextPath: string;
  configurationError: boolean;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    configurationError
      ? "Faltan SITE_PASSWORD o AUTH_SECRET en las variables de entorno."
      : "",
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? "No se pudo iniciar sesión.");
      window.location.replace(
        nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo iniciar sesión.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-glow login-glow-one" aria-hidden="true" />
      <div className="login-glow login-glow-two" aria-hidden="true" />
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card-header">
          <div className="login-brand" aria-hidden="true">
            <BookOpen size={24} />
          </div>
          <div>
            <span className="eyebrow">Acceso privado</span>
            <strong>Temaria</strong>
          </div>
        </div>
        <h1 id="login-title">Tu espacio de estudio, en un solo lugar</h1>
        <p>
          Organiza el material SSCS0208, practica con evaluaciones y resuelve
          dudas con un tutor que muestra en qué fuentes se apoya.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="site-password">Contraseña de acceso</label>
          <div className="password-field">
            <LockKeyhole size={18} aria-hidden="true" />
            <input
              id="site-password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Introduce tu contraseña"
            />
          </div>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="button button-primary button-full login-submit"
            disabled={busy || !password}
          >
            <span>{busy ? "Comprobando…" : "Entrar al aula"}</span>
            {!busy && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>
        <div className="login-security-note">
          <ShieldCheck size={16} aria-hidden="true" />
          <small>
            La contraseña se valida en el servidor y este dispositivo se
            recuerda durante 20 días.
          </small>
        </div>
      </section>
    </main>
  );
}
