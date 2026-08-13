import "server-only";

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

function logAgentRouter(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
) {
  console[level](
    JSON.stringify({
      scope: "agentrouter",
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
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
  const model = process.env.AGENTROUTER_MODEL ?? "gpt-5.6-sol";
  const headers = {
    Authorization: `Bearer ${process.env.AGENTROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": process.env.AGENTROUTER_USER_AGENT ?? "codex_cli_rs/0.114.0",
  };
  const requestBody = (structured: boolean) => ({
    model,
    instructions: structured
      ? options.instructions
      : `${options.instructions}\nDevuelve solo JSON valido, sin Markdown ni texto adicional.`,
    input: options.input,
    reasoning: { effort: structured ? "medium" : "low" },
    max_output_tokens: structured ? 8_000 : 4_000,
    store: false,
    ...(structured && options.textFormat
      ? { text: { format: options.textFormat } }
      : {}),
  });

  async function request(structured: boolean, attempt: number) {
    const startedAt = Date.now();
    const body = requestBody(structured);
    const serializedBody = JSON.stringify(body);
    logAgentRouter("info", "request_started", {
      ...options.trace,
      attempt,
      structured,
      model,
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
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers,
        body: serializedBody,
        signal: AbortSignal.timeout(100_000),
        cache: "no-store",
      });
      const rawPayload = await response.text();
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
        });
      }
      const text = readOutputText(payload);
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
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : "Error desconocido.",
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
  if (!result.text && options.textFormat) {
    logAgentRouter("warn", "structured_output_empty_retrying", {
      ...options.trace,
      firstResponse: responseShape(result.payload),
    });
    result = await request(false, 2);
  }
  if (!result.text) {
    logAgentRouter("error", "call_empty", {
      ...options.trace,
      finalResponse: responseShape(result.payload),
    });
    throw new Error(
      `AgentRouter devolvio una respuesta sin contenido utilizable (${JSON.stringify(responseShape(result.payload))}).`,
    );
  }
  logAgentRouter("info", "call_completed", {
    ...options.trace,
    extractedCharacters: result.text.length,
  });
  return result.text;
}
