export type ApiJsonResponse = {
  error?: string;
  answer?: string;
  sources?: unknown[];
  explanation?: unknown;
  exam?: unknown;
  review?: unknown;
  [key: string]: unknown;
};

export async function readJsonResponse<
  T extends Record<string, unknown> = ApiJsonResponse,
>(
  response: Response,
): Promise<T> {
  const raw = await response.text();

  try {
    return JSON.parse(raw) as T;
  } catch {
    const contentType = response.headers.get("content-type") ?? "";
    const receivedHtml =
      contentType.includes("text/html") || /^\s*<!doctype html/i.test(raw);

    if (receivedHtml) {
      throw new Error(
        response.status >= 500
          ? "El servidor interrumpió la respuesta de la IA. Inténtalo nuevamente; tus respuestas siguen guardadas."
          : "El servidor devolvió una página inesperada en lugar de la respuesta de la IA.",
      );
    }

    throw new Error(
      raw.trim().slice(0, 240) || "El servidor devolvió una respuesta no válida.",
    );
  }
}
