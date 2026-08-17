"use client";

import { MarkdownView } from "@/components/markdown-view";
import { MessageCircleWarning, Send, X } from "lucide-react";
import { useState } from "react";
import type { ExamAppealReview, GeneratedExam } from "@/lib/types";

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

export function StructuredGradingFeedback({
  value,
  exam,
  appealResults = {},
  appealBusyQuestionId,
  onAppeal,
}: {
  value: string;
  exam?: GeneratedExam;
  appealResults?: Record<string, ExamAppealReview>;
  appealBusyQuestionId?: string;
  onAppeal?: (questionIndex: number, comment: string) => Promise<void>;
}) {
  const [openAppeal, setOpenAppeal] = useState<number | null>(null);
  const [comment, setComment] = useState("");
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
      const questionId = exam?.questions[index]?.id ?? `question-${index}`;
      const appeal = appealResults[questionId];
      const submitting = appealBusyQuestionId === questionId;
      return <details key={`grading-question-${index}`} open><summary><span>Pregunta {numberValue(question, ["numero"]) ?? index + 1}</span><strong>{questionScore ?? "—"}/{maximum ?? "—"}</strong></summary><div className="grading-question-content">
        {explanation && <section className="grading-score-reason"><h4>Por qué obtuviste esa nota</h4><p>{explanation}</p></section>}
        <FeedbackList title="Lo que hiciste bien" items={listValue(question, ["aciertos", "fortalezas"])} />
        <FeedbackList title="Lo que faltó o debes corregir" items={[...listValue(question, ["omisiones", "aspectos_mejora"]), ...listValue(question, ["errores_conceptuales"]), ...listValue(question, ["errores_redaccion"])]} />
        {modelAnswer && <section className="grading-model-answer"><h4>Así debías responder</h4><p>{modelAnswer}</p></section>}
        {onAppeal && <div className="grading-appeal">
          {!appeal && <button type="button" className="grading-appeal-button" onClick={() => { setOpenAppeal(index); setComment(""); }}>
            <MessageCircleWarning size={16} />
            Revisar esta calificación
          </button>}
          {openAppeal === index && !appeal && <form className="grading-appeal-form" onSubmit={(event) => { event.preventDefault(); if (comment.trim()) void onAppeal(index, comment.trim()); }}>
            <label htmlFor={`appeal-${questionId}`}>Explica por qué crees que esta calificación debería revisarse</label>
            <textarea id={`appeal-${questionId}`} value={comment} onChange={(event) => setComment(event.target.value)} rows={4} autoFocus placeholder="Indica qué parte de tu respuesta consideras correcta o qué contexto no se tuvo en cuenta..." />
            <div className="grading-appeal-actions">
              <button type="button" className="button button-secondary" onClick={() => setOpenAppeal(null)} disabled={submitting}><X size={15} />Cancelar</button>
              <button type="submit" className="button button-primary" disabled={submitting || !comment.trim()}><Send size={15} />{submitting ? "Revisando..." : "Enviar revisión"}</button>
            </div>
          </form>}
          {appeal && <section className={`grading-appeal-result grading-appeal-${appeal.decision}`}>
            <h4>{appeal.decision === "increase" ? "La nota se ha revisado" : "La nota se mantiene"}</h4>
            <p>{appeal.responseToStudent}</p>
            {appeal.decision === "increase" && <strong>{appeal.previousScore}/10 → {appeal.recommendedScore}/10</strong>}
          </section>}
        </div>}
      </div></details>;
    })}</div>}
  </div>;
}
