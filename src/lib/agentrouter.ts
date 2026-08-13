import "server-only";

import { createHash } from "node:crypto";

type AgentRouterResponse = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    status?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
      json?: unknown;
    }>;
  }>;
  error?: { message?: string; type?: string; code?: string };
  status?: string;
  incomplete_details?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: unknown;
    output_tokens_details?: unknown;
  };
};

type AgentRouterTrace = {
  requestId: string;
  mode: string;
  sourceCount: number;
  contextCharacters: number;
  requestedQuestions?: number;
};

export class AgentRouterEmptyResponseError extends Error {
  readonly responseSummary: ReturnType<typeof responseShape>;

  constructor(responseSummary: ReturnType<typeof responseShape>) {
    super("AgentRouter devolvio una respuesta sin contenido utilizable.");
    this.name = "AgentRouterEmptyResponseError";
    this.responseSummary = responseSummary;
  }
}

function logAgentRouter(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
) {
  console[level](
    `[TEMARIA_AI] ${JSON.stringify({
        scope: "agentrouter",
        event,
        timestamp: new Date().toISOString(),
        ...details,
      })}`,
  );
}

function readOutputText(payload: AgentRouterResponse) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = (payload.output ?? []).flatMap((item) =>
    (item.content ?? []).flatMap((content) => {
      if (typeof content.text === "string" && content.text.trim()) {
        return [content.text.trim()];
      }
      if (typeof content.refusal === "string" && content.refusal.trim()) {
        return [content.refusal.trim()];
      }
      if (content.json !== undefined) return [JSON.stringify(content.json)];
      return [];
    }),
  );
  return parts.join("\n").trim();
}

function responseShape(payload: AgentRouterResponse) {
  return {
    responseId: payload.id,
    model: payload.model,
    status: payload.status,
    incomplete: payload.incomplete_details ?? null,
    error: payload.error
      ? {
          type: payload.error.type,
          code: payload.error.code,
          message: payload.error.message,
        }
      : null,
    usage: payload.usage ?? null,
    outputTextCharacters: payload.output_text?.length ?? 0,
    outputItems: payload.output?.length ?? 0,
    output: (payload.output ?? []).map((item) => ({
      type: item.type,
      status: item.status,
      content: (item.content ?? []).map((content) => ({
        type: content.type,
        hasText: typeof content.text === "string",
        hasRefusal: typeof content.refusal === "string",
        hasJson: content.json !== undefined,
        textCharacters: content.text?.length ?? 0,
        refusalCharacters: content.refusal?.length ?? 0,
      })),
    })),
  };
}

function htmlResponseDiagnostic(rawPayload: string) {
  const lower = rawPayload.toLowerCase();
  const sanitizePreview = (value: string) =>
    value
      .replace(/(authorization|token|api[-_]?key|cookie|set-cookie)\s*[:=][^\s<;]+/gi, "$1=[REDACTED]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]")
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL_REDACTED]")
      .replace(/[A-Za-z0-9_-]{32,}/g, "[LONG_TOKEN_REDACTED]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
  const title = rawPayload.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return {
    sha256: createHash("sha256").update(rawPayload).digest("hex"),
    previewStart: sanitizePreview(rawPayload),
    previewEnd: sanitizePreview(rawPayload.slice(-600)),
    title: title || null,
    markers: {
      cloudflare: lower.includes("cloudflare") || lower.includes("cf-ray"),
      challenge:
        lower.includes("challenge-platform") ||
        lower.includes("checking your browser") ||
        lower.includes("just a moment"),
      captcha:
        lower.includes("captcha") || lower.includes("turnstile"),
      unauthorized:
        lower.includes("unauthorized") || lower.includes("not authorized"),
      accessDenied:
        lower.includes("access denied") || lower.includes("forbidden"),
      agentRouter: lower.includes("agentrouter"),
      render: lower.includes("render.com"),
      vercel: lower.includes("vercel"),
    },
  };
}

export function isAgentRouterConfigured() {
  return Boolean(process.env.AGENTROUTER_API_KEY);
}

export async function callAgentRouter(options: {
  instructions: string;
  input: Array<{ role: "user" | "assistant"; content: string }>;
  textFormat?: Record<string, unknown>;
  trace: AgentRouterTrace;
}) {
  const baseUrl = (
    process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org/v1"
  ).replace(/\/$/, "");
  const baseHost = new URL(baseUrl).host;
  const model = process.env.AGENTROUTER_MODEL ?? "gpt-5.6-sol";
  const headers = {
    Authorization: `Bearer ${process.env.AGENTROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": process.env.AGENTROUTER_USER_AGENT ?? "codex_cli_rs/0.114.0",
    ...(baseHost.endsWith("ngrok-free.app")
      ? { "ngrok-skip-browser-warning": "temaria-server" }
      : {}),
  };
  const compactInstructions = `${options.instructions.slice(0, 2_500)}\n\nFUENTES REDUCIDAS PARA REINTENTO:\n${options.instructions.slice(-8_000)}`;
  const requestBody = (structured: boolean, compact: boolean) => ({
    model,
    instructions: structured
      ? options.instructions
      : `${compact ? compactInstructions : options.instructions}\nDevuelve solo JSON valido, sin Markdown ni texto adicional.`,
    input: compact ? options.input.slice(-2) : options.input,
    reasoning: { effort: structured ? "medium" : "low" },
    max_output_tokens: structured ? 8_000 : compact ? 2_500 : 4_000,
    store: false,
    ...(structured && options.textFormat
      ? { text: { format: options.textFormat } }
      : {}),
  });

  async function request(
    structured: boolean,
    attempt: number,
    compact = false,
  ) {
    const startedAt = Date.now();
    let phase = "preparing_request";
    let httpStatus: number | undefined;
    let upstreamRequestId: string | null = null;
    const body = requestBody(structured, compact);
    const serializedBody = JSON.stringify(body);
    logAgentRouter("info", "request_started", {
      ...options.trace,
      attempt,
      structured,
      compact,
      model,
      baseHost,
      environment: process.env.NODE_ENV,
      renderService: process.env.RENDER_SERVICE_NAME ?? null,
      renderRegion: process.env.RENDER_REGION ?? null,
      renderInstance: process.env.RENDER_INSTANCE_ID ?? null,
      renderCommit: process.env.RENDER_GIT_COMMIT ?? null,
      requestBytes: Buffer.byteLength(serializedBody, "utf8"),
      instructionCharacters: body.instructions.length,
      inputMessages: body.input.length,
      inputCharacters: body.input.reduce(
        (total, item) => total + item.content.length,
        0,
      ),
      maxOutputTokens: body.max_output_tokens,
      reasoningEffort: body.reasoning.effort,
    });

    try {
      phase = "waiting_for_headers";
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers,
        body: serializedBody,
        signal: AbortSignal.timeout(100_000),
        cache: "no-store",
      });
      httpStatus = response.status;
      upstreamRequestId =
        response.headers.get("x-request-id") ??
        response.headers.get("request-id") ??
        response.headers.get("cf-ray");
      logAgentRouter("info", "response_headers_received", {
        ...options.trace,
        attempt,
        structured,
        compact,
        httpStatus,
        durationMs: Date.now() - startedAt,
        upstreamRequestId,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        server: response.headers.get("server"),
        responseUrl: response.url,
        redirected: response.redirected,
        redirectCount: response.redirected ? 1 : 0,
      });
      phase = "reading_response_body";
      const rawPayload = await response.text();
      phase = "parsing_response_body";
      let payload: AgentRouterResponse = {};
      try {
        payload = JSON.parse(rawPayload) as AgentRouterResponse;
      } catch {
        logAgentRouter("error", "response_invalid_json", {
          ...options.trace,
          attempt,
          structured,
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          responseBytes: Buffer.byteLength(rawPayload, "utf8"),
          contentType: response.headers.get("content-type"),
          responseUrl: response.url,
          redirected: response.redirected,
          html:
            response.headers.get("content-type")?.includes("text/html")
              ? htmlResponseDiagnostic(rawPayload)
              : null,
        });
      }
      const text = readOutputText(payload);
      phase = "validating_response";
      logAgentRouter(
        response.ok && text ? "info" : "warn",
        "response_received",
        {
          ...options.trace,
          attempt,
          structured,
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          responseBytes: Buffer.byteLength(rawPayload, "utf8"),
          extractedCharacters: text.length,
          ...responseShape(payload),
        },
      );
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? `AgentRouter respondio ${response.status}.`,
        );
      }
      return { payload, text };
    } catch (error) {
      logAgentRouter("error", "request_failed", {
        ...options.trace,
        attempt,
        structured,
        durationMs: Date.now() - startedAt,
        phase,
        httpStatus,
        upstreamRequestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : "Error desconocido.",
        errorCause:
          error instanceof Error && error.cause
            ? String(error.cause)
            : null,
      });
      throw error;
    }
  }

  logAgentRouter("info", "call_started", {
    ...options.trace,
    model,
    hasTextFormat: Boolean(options.textFormat),
  });
  let result = await request(Boolean(options.textFormat), 1);
  if (!result.text) {
    logAgentRouter("warn", "structured_output_empty_retrying", {
      ...options.trace,
      firstAttemptStructured: Boolean(options.textFormat),
      firstResponse: responseShape(result.payload),
    });
    result = await request(false, 2, true);
  }
  if (!result.text) {
    const finalResponse = responseShape(result.payload);
    logAgentRouter("error", "call_empty", {
      ...options.trace,
      finalResponse,
    });
    throw new AgentRouterEmptyResponseError(finalResponse);
  }
  logAgentRouter("info", "call_completed", {
    ...options.trace,
    extractedCharacters: result.text.length,
  });
  return result.text;
}
