import { NextResponse } from "next/server";

import {
  AgentRouterEmptyResponseError,
  callAgentRouter,
  isAgentRouterConfigured,
} from "@/lib/agentrouter";
import { aiRequestSchema } from "@/lib/ai-schema";
import { retrieveKnowledge } from "@/lib/corpus";
import { hasSameOrigin } from "@/lib/request-security";
import type { StudyMode } from "@/lib/types";

export const runtime = "nodejs";
// Keep the platform window above the upstream timeout so we can return a
// controlled response instead of letting the serverless invocation be killed.
export const maxDuration = 120;

const requests = new Map<string, { count: number; resetAt: number }>();
const requestWindowMs = 10 * 60 * 1000;
const maxRequestsPerWindow = 30;
const maxRequestBytes = 64_000;

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
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
    "Califica la comprensión y el razonamiento del estudiante con una nota de 0 a 10. Las faltas leves de ortografía, tildes, puntuación o redacción NO reducen la nota ni deben aparecer como errores: interpreta el sentido de la respuesta. Solo menciona y penaliza la expresión cuando sea tan confusa o contradictoria que impida entender qué quiso decir. Desglosa aciertos, omisiones, errores conceptuales, retroalimentación concreta y una respuesta modelo basada solo en el material.",
  appeal:
    "Revisa de forma imparcial una objeción contra la nota de una pregunta. Contrasta el enunciado, la respuesta del estudiante, la respuesta esperada, la justificación original, la opinión del estudiante y las fuentes. Mantén la nota si la objeción no cambia la valoración; recomienda aumentarla solo cuando exista una razón académica concreta. Nunca reduzcas la nota durante una reclamación.",
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
    appeal: "revisión calificación respuesta estudiante evidencia criterios",
    review:
      "verificar afirmación evidencia contraste definición explicación objeción",
  };
  return `${prompt} ${expansion[mode]}`;
}

function normalizeTextAnswer(answer: string): string {
  const trimmed = answer.trim();
  const formatMarkdown = (value: string) =>
    value
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .split("\n")
      .map((line) =>
        line
          .replace(/^\s*[•·▪◦]\s+/, "- ")
          .replace(/^\s*(\d+)\)\s+/, "$1. "),
      )
      .join("\n")
      .trim();

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return formatMarkdown(answer);
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of [
      "message",
      "respuesta",
      "response",
      "answer",
      "content",
      "text",
    ]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return formatMarkdown(value);
    }
    const structuredText = [
      parsed.explanation,
      parsed.simpleExplanation,
      parsed.detailedExplanation,
      parsed.analysis,
      parsed.correctedExplanation,
    ]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .join("\n\n");
    if (structuredText) return formatMarkdown(structuredText);
    for (const key of ["data", "result"]) {
      if (parsed[key] && typeof parsed[key] === "object") {
        const nested: string = normalizeTextAnswer(JSON.stringify(parsed[key]));
        if (nested.trim()) return nested;
      }
    }
  } catch {
    // Preserve ordinary text that only resembles JSON.
  }

  return formatMarkdown(answer);
}

function buildLocalFallbackExam(
  results: Array<{
    chunk: {
      id: string;
      sourceLabel: string;
      sectionTitle: string;
      text: string;
    };
  }>,
  options: {
    questionCount: number;
    difficulty: "basic" | "intermediate" | "advanced";
    includeMultipleChoice: boolean;
    includeShortAnswer: boolean;
    includeEssay: boolean;
  },
) {
  const enabledTypes = [
    options.includeMultipleChoice ? "multiple_choice" : null,
    options.includeShortAnswer ? "short_answer" : null,
    options.includeEssay ? "essay" : null,
  ].filter((type): type is "multiple_choice" | "short_answer" | "essay" =>
    Boolean(type),
  );
  const types = enabledTypes.length ? enabledTypes : ["short_answer"];
  const questions = Array.from({ length: options.questionCount }, (_, index) => {
    const result = results[index % results.length];
    const source = result.chunk;
    const type = types[index % types.length];
    const sourceIds = [source.id];
    const excerpt = source.text.replace(/\s+/g, " ").trim().slice(0, 360);
    const normalizedTitle = source.sectionTitle.trim().toLocaleLowerCase("es");
    const normalizedText = source.text.toLocaleLowerCase("es");
    const titleTerms = normalizedTitle
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 5);
    const titleMatchesContent =
      titleTerms.length > 0 && titleTerms.some((term) => normalizedText.includes(term));
    const distractors = results
      .filter((candidate) => candidate.chunk.id !== source.id)
      .map((candidate) => candidate.chunk.sectionTitle)
      .filter((title, titleIndex, all) => title && all.indexOf(title) === titleIndex)
      .slice(0, 3);

    if (type === "multiple_choice") {
      const answer = source.sectionTitle || source.sourceLabel;
      return {
        id: `local-${index + 1}`,
        type,
        prompt: `Según ${source.sourceLabel}, ¿qué tema se aborda principalmente?`,
        options: [answer, ...distractors].slice(0, 4),
        answer,
        rationale: `La respuesta se basa en la fuente ${source.id}.`,
        rubric: [`Identifica correctamente el tema central de ${source.sectionTitle}.`],
        sourceIds,
      };
    }

    return {
      id: `local-${index + 1}`,
      type,
      prompt:
        type === "essay"
          ? titleMatchesContent
            ? `Desarrolla una explicación sobre ${source.sectionTitle}, relacionándola con la aplicación profesional descrita en la fuente.`
            : `Desarrolla las ideas principales expuestas en ${source.sourceLabel} y explica su aplicación profesional.`
          : titleMatchesContent
            ? `Explica brevemente las ideas esenciales de ${source.sectionTitle}.`
            : `Resume brevemente las ideas principales expuestas en ${source.sourceLabel}.`,
      options: [],
      answer: excerpt,
      rationale: `Respuesta modelo extraída de la fuente ${source.id}.`,
      rubric: [
        `Incluye las ideas principales respaldadas por ${source.sectionTitle}.`,
        "Relaciona la explicación con el contexto profesional cuando proceda.",
      ],
      sourceIds,
    };
  });

  return {
    title: `Examen de respaldo local (${options.difficulty})`,
    instructions:
      "AgentRouter no devolvió contenido para este examen. Este cuestionario de respaldo se construyó automáticamente con las fuentes locales recuperadas; puedes resolverlo y calificarlo normalmente.",
    questions,
  };
}

function buildLocalGroundedAnswer(
  mode: StudyMode,
  results: Array<{
    chunk: {
      sectionTitle: string;
      sourceLabel: string;
      text: string;
    };
  }>,
) {
  const items = results.slice(0, 5).map(({ chunk }, index) => {
    const excerpt = chunk.text.replace(/\s+/g, " ").trim().slice(0, 260);
    return `- **${chunk.sectionTitle}** [F${index + 1}]: ${excerpt}`;
  });
  const heading =
    mode === "summary"
      ? "Resumen local de respaldo"
      : mode === "solve" || mode === "grade"
        ? "Evidencia local recuperada"
        : "Respuesta local de respaldo";

  return `### ${heading}

AgentRouter no devolvió contenido después de dos intentos. Mientras se diagnostica el proveedor, estas son las ideas más relevantes encontradas en el material seleccionado:

${items.join("\n")}

Puedes reformular la pregunta con un concepto concreto para afinar la recuperación.`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();
  if (!hasSameOrigin(request)) {
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
    const firstIssue = parsed.error.issues[0];

    console.warn(
      `[TEMARIA_AI] ${JSON.stringify({
        scope: "ai_route",
        event: "request_invalid",
        timestamp: new Date().toISOString(),
        path: firstIssue?.path.join("."),
        code: firstIssue?.code,
        message: firstIssue?.message,
      })}`,
    );

    return NextResponse.json(
      {
        error: firstIssue?.path.length
          ? `No se pudo procesar el campo ${firstIssue.path.join(".")}.`
          : "La solicitud no es válida.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const body = parsed.data;
  console.info(
    `[TEMARIA_AI] ${JSON.stringify({
      scope: "ai_route",
      event: "request_validated",
      timestamp: new Date().toISOString(),
      requestId,
      mode: body.mode,
      courseCount: body.courseIds.length,
      documentCount: body.documentIds.length,
      retrievalTermCount: body.retrievalTerms.length,
      historyMessages: body.history.length,
      promptCharacters: body.prompt.length,
      examOptions: body.examOptions ?? null,
    })}`,
  );
  const retrievalQuery = `${buildQuery(body.mode, body.prompt)} ${body.retrievalTerms.join(" ")}`;
  let results = retrieveKnowledge({
    query: retrievalQuery,
    courseIds: body.courseIds,
    documentIds: body.documentIds,
    chunkIds: body.chunkIds,
    excludeDocumentIds: body.excludeDocumentIds,
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
    balanceDocuments: body.mode === "exam",
    randomize: body.mode === "exam",
    includeAllCandidates: body.mode === "exam",
  });

  if (!results.length && body.mode === "grade" && body.chunkIds.length) {
    console.warn(
      `[TEMARIA_AI] ${JSON.stringify({
        scope: "ai_route",
        event: "grade_chunk_ids_not_found",
        timestamp: new Date().toISOString(),
        requestId,
        chunkCount: body.chunkIds.length,
        documentCount: body.documentIds.length,
      })}`,
    );
    results = retrieveKnowledge({
      query: retrievalQuery,
      courseIds: body.courseIds,
      documentIds: body.documentIds,
      anchorTerms: body.retrievalTerms,
      limit: 14,
    });
  }

  if (!results.length) {
    if (body.mode === "grade") {
      return NextResponse.json(
        {
          error:
            "No pude localizar el material original de este examen. Tus respuestas siguen guardadas; genera un examen nuevo o inténtalo otra vez.",
          sources: [],
          grounded: false,
          requestId,
        },
        { status: 422 },
      );
    }
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
  console.info(
    `[TEMARIA_AI] ${JSON.stringify({
      scope: "ai_route",
      event: "retrieval_completed",
      timestamp: new Date().toISOString(),
      requestId,
      mode: body.mode,
      durationMs: Date.now() - requestStartedAt,
      resultCount: results.length,
      sourceCourses: [...new Set(results.map(({ chunk }) => chunk.courseId))],
      sourceCharacters: results.reduce(
        (total, { chunk }) => total + chunk.text.length,
        0,
      ),
      topScores: results
        .slice(0, 5)
        .map(({ score }) => Math.round(score * 10) / 10),
    })}`,
  );

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
  const modelContext =
    body.mode === "exam" ? context.slice(0, 24_000) : context;
  const examDetail = body.examOptions
    ? `\nPreferencias de examen: ${body.examOptions.questionCount} preguntas, dificultad ${body.examOptions.difficulty}; opción múltiple=${body.examOptions.includeMultipleChoice}; respuesta corta=${body.examOptions.includeShortAnswer}; desarrollo=${body.examOptions.includeEssay}.`
    : "";

  const instructions = `Eres un tutor especializado en el certificado SSCS0208.
Trabaja EXCLUSIVAMENTE con las fuentes incluidas en esta solicitud. No navegues por Internet, no uses conocimiento externo y no rellenes lagunas con suposiciones.
Si las fuentes no permiten responder una parte, indícalo brevemente una sola vez. No repitas la misma advertencia en cada apartado. Esta limitación describe solo esta búsqueda: nunca afirmes que algo no consta en todo el corpus salvo que la aplicación lo indique expresamente.
Todas las afirmaciones sustantivas deben llevar citas inline con el formato [F1], [F2], etc.
No inventes referencias. Conserva un tono docente, preciso y práctico.
${modeInstructions[body.mode]}${examDetail}
${body.mode === "grade" ? "Al valorar errores_redaccion, déjalo vacío salvo que la respuesta sea realmente incomprensible; nunca penalices errores ortográficos leves ni exijas coincidencia literal con la respuesta esperada. Prioriza si la idea es correcta, equivalente y aplicable. Antes de puntuar cada pregunta, comprueba que prompt, expectedAnswer, rationale, rubric y fuentes tratan realmente el mismo tema. Si están desalineados, considera el ítem defectuoso: no penalices al estudiante por omisiones exigidas solo por una referencia ajena al enunciado. Valora la pertinencia y corrección de su respuesta respecto al prompt, menciona el defecto una sola vez en valoracion y ofrece una respuesta_modelo que conteste al prompt real." : ""}
${body.mode === "exam" ? "Para preguntas de desarrollo: presenta un caso concreto con situación, cambio observable, necesidad afectada, profesionales implicados y registros esperados. Pide solo actuaciones relacionadas con esos datos y escribe una respuesta modelo completa, directamente como contestación del estudiante, no como lista de criterios." : ""}

Para cualquier visualización:
- Usa únicamente relaciones o cantidades explícitamente respaldadas por las fuentes.
- Si no existen cantidades comparables, no inventes números: usa value=0.
- Los identificadores de items deben ser cortos y únicos dentro de la respuesta.
- Las conexiones solo pueden referirse a identificadores existentes.
- En modo visualize, visual debe contener siempre un gráfico didáctico; nunca devuelvas código Mermaid ni un diagrama como texto.
- En los demás modos, devuelve visual=null solo si una representación gráfica no mejora la comprensión.

Al revisar una objeción, no des la razón a ninguna parte por autoridad. Basa el veredicto en evidencia recuperada y reconoce la incertidumbre cuando corresponda.

FUENTES RECUPERADAS:
${modelContext}`;

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
                prompt: { type: "string", minLength: 40 },
                options: { type: "array", items: { type: "string" } },
                answer: { type: "string", minLength: 20 },
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

    const appealSchema = {
      type: "json_schema",
      name: "exam_appeal_review",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "decision",
          "previousScore",
          "recommendedScore",
          "responseToStudent",
          "analysis",
        ],
        properties: {
          decision: { type: "string", enum: ["uphold", "increase"] },
          previousScore: { type: "number" },
          recommendedScore: { type: "number" },
          responseToStudent: { type: "string" },
          analysis: { type: "string" },
        },
      },
    };

    const gradingSchema = {
      type: "json_schema",
      name: "exam_grading",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["nota_global", "criterio_global", "valoracion_global", "preguntas"],
        properties: {
          nota_global: { type: "number" },
          criterio_global: { type: "string" },
          valoracion_global: {
            type: "object",
            additionalProperties: false,
            required: ["aciertos", "omisiones", "errores_conceptuales", "errores_redaccion", "retroalimentacion_concreta"],
            properties: {
              aciertos: { type: "array", maxItems: 3, items: { type: "string" } },
              omisiones: { type: "array", maxItems: 3, items: { type: "string" } },
              errores_conceptuales: { type: "array", maxItems: 2, items: { type: "string" } },
              errores_redaccion: { type: "array", maxItems: 2, items: { type: "string" } },
              retroalimentacion_concreta: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
            },
          },
          preguntas: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["numero", "nota", "maximo", "valoracion", "aciertos", "omisiones", "errores_conceptuales", "errores_redaccion", "respuesta_modelo"],
              properties: {
                numero: { type: "number" },
                nota: { type: "number" },
                maximo: { type: "number" },
                valoracion: { type: "string" },
                aciertos: { type: "array", maxItems: 2, items: { type: "string" } },
                omisiones: { type: "array", maxItems: 2, items: { type: "string" } },
                errores_conceptuales: { type: "array", maxItems: 2, items: { type: "string" } },
                errores_redaccion: { type: "array", maxItems: 1, items: { type: "string" } },
                respuesta_modelo: { type: "string" },
              },
            },
          },
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
            : body.mode === "appeal"
              ? appealSchema
            : body.mode === "grade"
              ? gradingSchema
            : undefined;

    const answer = await callAgentRouter({
      instructions,
      input: [
        ...body.history.slice(-6),
        { role: "user", content: body.prompt },
      ],
      textFormat,
      trace: {
        requestId,
        mode: body.mode,
        sourceCount: sources.length,
        contextCharacters: modelContext.length,
        requestedQuestions: body.examOptions?.questionCount,
      },
    });

    console.info(
      `[TEMARIA_AI] ${JSON.stringify({
        scope: "ai_route",
        event: "generation_completed",
        timestamp: new Date().toISOString(),
        requestId,
        mode: body.mode,
        durationMs: Date.now() - requestStartedAt,
        answerCharacters: answer.length,
      })}`,
    );

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

    if (body.mode === "appeal") {
      const appeal = JSON.parse(answer);
      return NextResponse.json({ appeal, sources, grounded: true });
    }

    if (body.mode === "grade") {
      return NextResponse.json({ answer, sources, grounded: true });
    }

    return NextResponse.json({
      answer: normalizeTextAnswer(answer),
      sources,
      grounded: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido.";
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        message.toLowerCase().includes("timeout"));
    const emptyAgentResponse = error instanceof AgentRouterEmptyResponseError;
    if (body.mode === "exam") {
      const fallbackOptions = body.examOptions ?? {
        questionCount: 8,
        difficulty: "intermediate" as const,
        includeMultipleChoice: true,
        includeShortAnswer: true,
        includeEssay: true,
      };
      const exam = buildLocalFallbackExam(results, fallbackOptions);
      console.warn(
        `[TEMARIA_AI] ${JSON.stringify({
          scope: "ai_route",
          event: "exam_local_fallback",
          timestamp: new Date().toISOString(),
          requestId,
          durationMs: Date.now() - requestStartedAt,
          questionCount: exam.questions.length,
          sourceCount: sources.length,
          reason: emptyAgentResponse
            ? "agentrouter_empty_output"
            : timedOut
              ? "agentrouter_timeout_before_mobile_disconnect"
              : "agentrouter_transport_error",
        })}`,
      );
      return NextResponse.json({
        exam,
        sources,
        grounded: true,
        fallback: true,
        requestId,
      });
    }
    if (emptyAgentResponse && body.mode === "grade") {
      return NextResponse.json(
        {
          error:
            "La IA no devolvió una calificación completa. Inténtalo de nuevo; tus respuestas siguen guardadas.",
          sources,
          retryable: true,
          requestId,
        },
        { status: 502 },
      );
    }
    if (emptyAgentResponse) {
      const answer = buildLocalGroundedAnswer(body.mode, results);
      console.warn(
        `[TEMARIA_AI] ${JSON.stringify({
          scope: "ai_route",
          event: "text_local_fallback",
          timestamp: new Date().toISOString(),
          requestId,
          mode: body.mode,
          durationMs: Date.now() - requestStartedAt,
          answerCharacters: answer.length,
          sourceCount: sources.length,
          reason: "agentrouter_empty_output",
          responseSummary: error.responseSummary,
        })}`,
      );
      return NextResponse.json({
        answer,
        sources,
        grounded: true,
        fallback: true,
        requestId,
      });
    }
    console.error(
      `[TEMARIA_AI] ${JSON.stringify({
        scope: "ai_route",
        event: "request_failed",
        timestamp: new Date().toISOString(),
        requestId,
        mode: body.mode,
        durationMs: Date.now() - requestStartedAt,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: message,
        timedOut,
      })}`,
    );
    return NextResponse.json(
      {
        error: timedOut
          ? "La IA tardó demasiado en responder. Inténtalo de nuevo; tu progreso no se ha perdido."
          : `No se pudo consultar AgentRouter: ${message}`,
        sources,
        retryable: timedOut,
        requestId,
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}
