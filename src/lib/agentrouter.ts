import "server-only";

type AgentRouterResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

function readOutputText(payload: AgentRouterResponse) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

export function isAgentRouterConfigured() {
  return Boolean(process.env.AGENTROUTER_API_KEY);
}

export async function callAgentRouter(options: {
  instructions: string;
  input: Array<{ role: "user" | "assistant"; content: string }>;
  textFormat?: Record<string, unknown>;
}) {
  const baseUrl = (process.env.AGENTROUTER_BASE_URL ?? "https://agentrouter.org/v1").replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AGENTROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": process.env.AGENTROUTER_USER_AGENT ?? "codex_cli_rs/0.114.0",
    },
    body: JSON.stringify({
      model: process.env.AGENTROUTER_MODEL ?? "gpt-5.6-sol",
      instructions: options.instructions,
      input: options.input,
      reasoning: { effort: "medium" },
      max_output_tokens: 8_000,
      store: false,
      ...(options.textFormat ? { text: { format: options.textFormat } } : {}),
    }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as AgentRouterResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `AgentRouter respondió ${response.status}.`);
  }

  const text = readOutputText(payload);
  if (!text) throw new Error("AgentRouter devolvió una respuesta vacía.");
  return text;
}
