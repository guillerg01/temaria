import { NextResponse } from "next/server";

import { callAgentRouter, isAgentRouterConfigured } from "@/lib/agentrouter";
import { aiRequestSchema } from "@/lib/ai-schema";
import { retrieveKnowledge } from "@/lib/corpus";
import type { StudyMode } from "@/lib/types";

export const runtime = "nodejs";

const requests = new Map<string, { count: number; resetAt: number }>();
const requestWindowMs = 10 * 60 * 1000;
const maxRequestsPerWindow = 30;
const maxRequestBytes = 64_000;

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function rateLimit(request: Request) {
  const key = clientKey(request);
  const now = Date.now();
  const current = requests.get(key);
  if (!current || current.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + requestWindowMs });
    return false;
  }
  current.count += 1;
  return current.count > maxRequestsPerWindow;
}

const modeInstructions: Record<StudyMode, string> = {
  chat: "Responde la duda con claridad, conectando conceptos y ejemplos del material.",
  summary:
    "Produce un resumen de estudio jerárquico: ideas esenciales, conceptos clave, relaciones y puntos que conviene memorizar.",
  explain:
    "Crea una explicación docente en dos niveles: una versión simple y otra detallada. Incluye puntos clave, una pregunta de comprobación y, cuando ayude realmente, una representación visual estructurada basada en las fuentes.",
  visualize:
    "Enseña el concepto mediante una explicación simple, otra detallada y una representación visual estructurada OBLIGATORIA. Elige entre mapa conceptual, proceso, línea de tiempo, comparación o gráfico de barras según la relación real entre los datos. La visualización debe contener las ideas o pasos esenciales y no puede sustituirse por código Mermaid ni por una lista escrita.",
  solve:
    "Resuelve las preguntas aportadas. Para cada respuesta explica por qué es correcta y, cuando proceda, por qué las alternativas son incorrectas.",
  exam: "Genera un examen variado y exigente. Devuelve primero las preguntas y después una sección separada de soluciones, razonamientos y criterios de corrección. Incluye identificadores de fuente en cada solución.",
  grade:
    "Califica la respuesta del estudiante con una nota de 0 a 10. Desglosa aciertos, omisiones, errores, retroalimentación concreta y una respuesta modelo basada solo en el material.",
  review:
    "Contrasta de forma neutral la objeción del estudiante con la explicación original y las fuentes. Decide si el estudiante tiene razón, si la explicación está respaldada o si la evidencia recuperada es insuficiente. Corrige la explicación cuando corresponda.",
};

function buildQuery(mode: StudyMode, prompt: string) {
  const expansion: Record<StudyMode, string> = {
    chat: "concepto definición aplicación",
    summary:
      "ideas principales definición características proceso clasificación resumen",
    explain: "definición explicación ejemplo relación procedimiento",
    visualize:
      "definición relación partes proceso secuencia comparación cantidades representación visual",
    solve: "pregunta respuesta correcta justificación",
    exam: "conceptos objetivos criterios procedimientos evaluación",
    grade: "criterios respuesta correcta explicación evaluación",
    review:
      "verificar afirmación evidencia contraste definición explicación objeción",
  };
  return `${prompt} ${expansion[mode]}`;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRequestBytes) {
    return NextResponse.json(
      { error: "La solicitud es demasiado grande." },
      { status: 413 },
    );
  }
  if (rateLimit(request)) {
    return NextResponse.json(
      {
        error:
          "Has alcanzado temporalmente el límite de consultas. Inténtalo más tarde.",
      },
      { status: 429 },
    );
  }

  const parsed = aiRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "La solicitud no es válida.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const retrievalQuery = `${buildQuery(body.mode, body.prompt)} ${body.retrievalTerms.join(" ")}`;
  const results = retrieveKnowledge({
    query: retrievalQuery,
    courseIds: body.courseIds,
    documentIds: body.documentIds,
    anchorTerms: body.retrievalTerms,
    limit:
      body.mode === "exam" ||
      body.mode === "summary" ||
      body.mode === "visualize" ||
      body.mode === "review"
        ? 14
        : 8,
    balanceCourses:
      body.courseIds.length === 0 &&
      (body.mode === "exam" ||
        body.mode === "summary" ||
        body.mode === "visualize"),
  });

  if (!results.length) {
    return NextResponse.json({
      answer:
        "No encontré evidencia suficiente en el material seleccionado. Amplía el alcance o formula la pregunta con otros términos.",
      sources: [],
      grounded: false,
    });
  }

  const sources = results.map(({ chunk, score }, index) => ({
    index: index + 1,
    id: chunk.id,
    courseId: chunk.courseId,
    documentId: chunk.documentId,
    sourceLabel: chunk.sourceLabel,
    excerpt: chunk.text.slice(0, 320),
    score: Math.round(score * 10) / 10,
  }));

  if (!isAgentRouterConfigured()) {
    return NextResponse.json({
      answer:
        "La recuperación local funciona y encontró las fuentes mostradas abajo. Para generar la respuesta con GPT-5.6 Sol, configura `AGENTROUTER_API_KEY` en `.env.local` y reinicia el servidor.",
      sources,
      grounded: true,
      configurationRequired: true,
    });
  }

  const context = results
    .map(
      ({ chunk }, index) =>
        `[FUENTE ${index + 1} | ${chunk.id}]\n${chunk.sourceLabel}\n${chunk.text}`,
    )
    .join("\n\n---\n\n");
  const examDetail = body.examOptions
    ? `\nPreferencias de examen: ${body.examOptions.questionCount} preguntas, dificultad ${body.examOptions.difficulty}; opción múltiple=${body.examOptions.includeMultipleChoice}; respuesta corta=${body.examOptions.includeShortAnswer}; desarrollo=${body.examOptions.includeEssay}.`
    : "";

  const instructions = `Eres un tutor especializado en el certificado SSCS0208.
Trabaja EXCLUSIVAMENTE con las fuentes incluidas en esta solicitud. No navegues por Internet, no uses conocimiento externo y no rellenes lagunas con suposiciones.
Si las fuentes no permiten responder una parte, di literalmente: "No se encontró respaldo en las fuentes recuperadas". Esta frase describe solo esta búsqueda: nunca afirmes que algo no consta en todo el corpus salvo que la aplicación lo indique expresamente.
Todas las afirmaciones sustantivas deben llevar citas inline con el formato [F1], [F2], etc.
No inventes referencias. Conserva un tono docente, preciso y práctico.
${modeInstructions[body.mode]}${examDetail}

Para cualquier visualización:
- Usa únicamente relaciones o cantidades explícitamente respaldadas por las fuentes.
- Si no existen cantidades comparables, no inventes números: usa value=0.
- Los identificadores de items deben ser cortos y únicos dentro de la respuesta.
- Las conexiones solo pueden referirse a identificadores existentes.
- En modo visualize, visual debe contener siempre un gráfico didáctico; nunca devuelvas código Mermaid ni un diagrama como texto.
- En los demás modos, devuelve visual=null solo si una representación gráfica no mejora la comprensión.

Al revisar una objeción, no des la razón a ninguna parte por autoridad. Basa el veredicto en evidencia recuperada y reconoce la incertidumbre cuando corresponda.

FUENTES RECUPERADAS:
${context}`;

  try {
    const examSchema = {
      type: "json_schema",
      name: "generated_exam",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "instructions", "questions"],
        properties: {
          title: { type: "string" },
          instructions: { type: "string" },
          questions: {
            type: "array",
            minItems: body.examOptions?.questionCount ?? 3,
            maxItems: body.examOptions?.questionCount ?? 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "type",
                "prompt",
                "options",
                "answer",
                "rationale",
                "rubric",
                "sourceIds",
              ],
              properties: {
                id: { type: "string" },
                type: {
                  type: "string",
                  enum: ["multiple_choice", "short_answer", "essay"],
                },
                prompt: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                answer: { type: "string" },
                rationale: { type: "string" },
                rubric: { type: "array", items: { type: "string" } },
                sourceIds: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    };

    const visualObjectSchema = {
          type: "object",
          additionalProperties: false,
          required: [
            "type",
            "title",
            "description",
            "items",
            "connections",
          ],
          properties: {
            type: {
              type: "string",
              enum: [
                "concept_map",
                "process",
                "timeline",
                "comparison",
                "bar_chart",
              ],
            },
            title: { type: "string" },
            description: { type: "string" },
            items: {
              type: "array",
              minItems: 2,
              maxItems: 10,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "label", "description", "value", "group"],
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  description: { type: "string" },
                  value: { type: "number" },
                  group: { type: "string" },
                },
              },
            },
            connections: {
              type: "array",
              maxItems: 16,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["from", "to", "label"],
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  label: { type: "string" },
                },
              },
            },
          },
    };

    const optionalVisualSchema = {
      anyOf: [{ type: "null" }, visualObjectSchema],
    };

    const explanationSchema = (visualRequired: boolean) => ({
      type: "json_schema",
      name: "teaching_explanation",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "simple",
          "detailed",
          "keyPoints",
          "checkQuestion",
          "visual",
        ],
        properties: {
          title: { type: "string" },
          simple: { type: "string" },
          detailed: { type: "string" },
          keyPoints: {
            type: "array",
            minItems: 2,
            maxItems: 7,
            items: { type: "string" },
          },
          checkQuestion: { type: "string" },
          visual: visualRequired ? visualObjectSchema : optionalVisualSchema,
        },
      },
    });

    const reviewSchema = {
      type: "json_schema",
      name: "explanation_review",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "verdict",
          "headline",
          "analysis",
          "correctedExplanation",
          "nextStep",
        ],
        properties: {
          verdict: {
            type: "string",
            enum: [
              "user_correct",
              "explanation_correct",
              "insufficient_evidence",
            ],
          },
          headline: { type: "string" },
          analysis: { type: "string" },
          correctedExplanation: { type: "string" },
          nextStep: { type: "string" },
        },
      },
    };

    const textFormat =
      body.mode === "exam"
        ? examSchema
        : body.mode === "visualize"
          ? explanationSchema(true)
          : body.mode === "explain"
            ? explanationSchema(false)
          : body.mode === "review"
            ? reviewSchema
            : undefined;

    const answer = await callAgentRouter({
      instructions,
      input: [
        ...body.history.slice(-6),
        { role: "user", content: body.prompt },
      ],
      textFormat,
    });

    if (body.mode === "exam") {
      const exam = JSON.parse(answer);
      return NextResponse.json({ exam, sources, grounded: true });
    }

    if (body.mode === "explain" || body.mode === "visualize") {
      const explanation = JSON.parse(answer);
      return NextResponse.json({ explanation, sources, grounded: true });
    }

    if (body.mode === "review") {
      const review = JSON.parse(answer);
      return NextResponse.json({ review, sources, grounded: true });
    }

    return NextResponse.json({ answer, sources, grounded: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido.";
    return NextResponse.json(
      { error: `No se pudo consultar AgentRouter: ${message}`, sources },
      { status: 502 },
    );
  }
}
