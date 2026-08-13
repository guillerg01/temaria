import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const host = process.env.TEMARIA_GATEWAY_HOST ?? "127.0.0.1";
const port = Number(process.env.TEMARIA_GATEWAY_PORT ?? "4317");
const upstreamBaseUrl = (
  process.env.AGENTROUTER_UPSTREAM_URL ?? "https://agentrouter.org/v1"
).replace(/\/$/, "");
const upstreamApiKey = process.env.AGENTROUTER_API_KEY;
const gatewaySecret =
  process.env.TEMARIA_GATEWAY_SECRET ?? process.env.AGENTROUTER_API_KEY;
const upstreamUserAgent =
  process.env.AGENTROUTER_USER_AGENT ?? "codex_cli_rs/0.114.0";
const maxBodyBytes = 2 * 1024 * 1024;

if (!upstreamApiKey) {
  throw new Error("AGENTROUTER_API_KEY no esta configurada en este PC.");
}
if (!gatewaySecret || gatewaySecret.length < 32) {
  throw new Error("TEMARIA_GATEWAY_SECRET debe tener al menos 32 caracteres.");
}

function authorized(value) {
  const expected = Buffer.from(`Bearer ${gatewaySecret}`);
  const received = Buffer.from(value ?? "");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();

  if (request.method === "GET" && request.url === "/health") {
    return sendJson(response, 200, { status: "ok", requestId });
  }

  if (request.method !== "POST" || request.url !== "/v1/responses") {
    return sendJson(response, 404, { error: "Not found", requestId });
  }
  if (!authorized(request.headers.authorization)) {
    return sendJson(response, 401, { error: "Unauthorized", requestId });
  }

  const startedAt = Date.now();
  try {
    const body = await readBody(request);
    JSON.parse(body.toString("utf8"));

    const upstream = await fetch(`${upstreamBaseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${upstreamApiKey}`,
        "content-type": "application/json",
        "user-agent": upstreamUserAgent,
      },
      body,
      signal: AbortSignal.timeout(110_000),
    });
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "x-temaria-gateway-request-id": requestId,
    });
    response.end(payload);
    console.info(
      `[TEMARIA_GATEWAY] ${JSON.stringify({ requestId, status: upstream.status, durationMs: Date.now() - startedAt, requestBytes: body.length, responseBytes: payload.length })}`,
    );
  } catch (error) {
    const bodyTooLarge =
      error instanceof Error && error.message === "BODY_TOO_LARGE";
    console.error(
      `[TEMARIA_GATEWAY] ${JSON.stringify({ requestId, status: "error", durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Unknown error" })}`,
    );
    sendJson(response, bodyTooLarge ? 413 : 502, {
      error: bodyTooLarge ? "Request too large" : "Gateway failure",
      requestId,
    });
  }
});

server.requestTimeout = 120_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => {
  console.info(`[TEMARIA_GATEWAY] listening on http://${host}:${port}`);
});
