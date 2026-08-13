"use client";

import { MarkdownView } from "@/components/markdown-view";
import type { GeneratedExam } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

function stringValue(record: UnknownRecord, keys: string[]) {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string;
  return "";
}
function numberValue(record: UnknownRecord, keys: string[]) {
  for (const key of keys) if (typeof record[key] === "number") return record[key] as number;
  return undefined;
}
function listValue(record: UnknownRecord, keys: string[]) {
  for (const key of keys) if (Array.isArray(record[key])) {
    const seen = new Set<string>();
    return (record[key] as unknown[]).filter((item): item is string => {
      if (typeof item !== "string") return false;
      const normalized = item.toLocaleLowerCase("es").replace(/[^a-záéíóúüñ0-9]+/g, " ").trim();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }
  return [];
}
function parseGrading(value: string): UnknownRecord | null {
  const clean = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  for (const candidate of [clean, start >= 0 && end > start ? clean.slice(start, end + 1) : ""]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as UnknownRecord;
    } catch {}
  }
  return null;
}
function FeedbackList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="grading-feedback-section"><h4>{title}</h4><ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul></section>;
}

export function StructuredGradingFeedback({ value, exam }: { value: string; exam?: GeneratedExam }) {
  const feedback = parseGrading(value);
  if (!feedback) return <MarkdownView>{value}</MarkdownView>;
  const global = (feedback.valoracion_global && typeof feedback.valoracion_global === "object" ? feedback.valoracion_global : {}) as UnknownRecord;
  const questions = Array.isArray(feedback.preguntas) ? feedback.preguntas.filter((item): item is UnknownRecord => Boolean(item) && typeof item === "object") : [];
  const score = numberValue(feedback, ["nota_global", "puntuacion_global", "calificacion_global"]);
  const reason = stringValue(feedback, ["criterio_global", "justificacion_nota", "valoracion", "valoracion_global_texto"]);
  return <div className="grading-feedback">
    <header className="grading-feedback-summary"><div><span>Calificación global</span><strong>{score ?? "—"}<small>/10</small></strong></div><p>{reason || "La nota resulta de la suma de la valoración de cada pregunta según sus criterios y las fuentes recuperadas."}</p></header>
    <div className="grading-feedback-grid">
      <FeedbackList title="Aciertos" items={listValue(global, ["aciertos", "fortalezas"])} />
      <FeedbackList title="Aspectos por completar" items={listValue(global, ["omisiones", "aspectos_mejora", "mejoras"])} />
      <FeedbackList title="Errores conceptuales" items={listValue(global, ["errores_conceptuales"])} />
      <FeedbackList title="Redacción y claridad" items={listValue(global, ["errores_redaccion", "redaccion"])} />
    </div>
    <FeedbackList title="Consejos para aprender más rápido" items={listValue(global, ["retroalimentacion_concreta", "elementos_a_tener_en_cuenta", "recomendaciones"]).slice(0, 3)} />
    {questions.length > 0 && <div className="grading-question-feedback"><h3>Revisión por pregunta</h3>{questions.map((question, index) => {
      const questionScore = numberValue(question, ["nota", "nota_obtenida", "puntuacion"]);
      const maximum = numberValue(question, ["maximo", "puntuacion_maxima", "maxima"]);
      const explanation = stringValue(question, ["valoracion", "comentario", "justificacion", "por_que_esa_nota"]);
      const modelAnswer = stringValue(question, ["respuesta_modelo", "respuesta_mejorada", "ejemplo_respuesta"]) || exam?.questions[index]?.answer || "";
      return <details key={`grading-question-${index}`} open><summary><span>Pregunta {numberValue(question, ["numero"]) ?? index + 1}</span><strong>{questionScore ?? "—"}/{maximum ?? "—"}</strong></summary><div className="grading-question-content">
        {explanation && <section className="grading-score-reason"><h4>Por qué obtuviste esa nota</h4><p>{explanation}</p></section>}
        <FeedbackList title="Lo que hiciste bien" items={listValue(question, ["aciertos", "fortalezas"])} />
        <FeedbackList title="Lo que faltó o debes corregir" items={[...listValue(question, ["omisiones", "aspectos_mejora"]), ...listValue(question, ["errores_conceptuales"]), ...listValue(question, ["errores_redaccion"])]} />
        {modelAnswer && <section className="grading-model-answer"><h4>Así debías responder</h4><p>{modelAnswer}</p></section>}
      </div></details>;
    })}</div>}
  </div>;
}
