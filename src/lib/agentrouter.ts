import "server-only";

type AgentRouterResponse = {
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
  error?: { message?: string };
  status?: string;
  incomplete_details?: unknown;
};

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
  return JSON.stringify({
    status: payload.status,
    incomplete: payload.incomplete_details ?? null,
    output: (payload.output ?? []).map((item) => ({
      type: item.type,
      status: item.status,
      content: (item.content ?? []).map((content) => ({
        type: content.type,
        hasText: typeof content.text === "string",
        hasRefusal: typeof content.refusal === "string",
        hasJson: content.json !== undefined,
      })),
    })),
  });
}

export function isAgentRouterConfigured() {
  return Boolean(process.env.AGENTROUTER_API_KEY);
}

export async function callAgentRouter(options: {
  instructions: string;
  input: Array<{ role: "user" | "assistant"; content: string }>;
  textFormat?: Record<string, unknown>;
}) {
  const baseUrl = (
    process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org/v1"
  ).replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${process.env.AGENTROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": process.env.AGENTROUTER_USER_AGENT ?? "codex_cli_rs/0.114.0",
  };
  const requestBody = (structured: boolean) => ({
    model: process.env.AGENTROUTER_MODEL ?? "gpt-5.6-sol",
    instructions: structured
      ? options.instructions
      : `${options.instructions}\nDevuelve solo JSON válido, sin Markdown ni texto adicional.`,
    input: options.input,
    reasoning: { effort: structured ? "medium" : "low" },
    max_output_tokens: structured ? 8_000 : 4_000,
    store: false,
    ...(structured && options.textFormat
      ? { text: { format: options.textFormat } }
      : {}),
  });

  async function request(structured: boolean) {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody(structured)),
      signal: AbortSignal.timeout(100_000),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as AgentRouterResponse;
    if (!response.ok) {
      throw new Error(
        payload.error?.message ?? `AgentRouter respondió ${response.status}.`,
      );
    }
    return { payload, text: readOutputText(payload) };
  }

  let result = await request(Boolean(options.textFormat));
  if (!result.text && options.textFormat) {
    result = await request(false);
  }
  if (!result.text) {
    throw new Error(
      `AgentRouter devolvió una respuesta sin contenido utilizable (${responseShape(result.payload)}).`,
    );
  }
  return result.text;
}
