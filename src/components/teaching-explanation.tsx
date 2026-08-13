"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowRight,
  CheckCircle2,
  Flag,
  ListChecks,
  Scale,
  ShieldQuestion,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";

import { MarkdownView } from "@/components/markdown-view";
import { TeachingVisualView } from "@/components/teaching-visual";
import { VoiceTextarea } from "@/components/voice-textarea";
import { appendPreference } from "@/lib/client-db";
import { readJsonResponse } from "@/lib/http-response";
import type {
  ExplanationReview,
  ExplanationReviewResult,
  SourceReference,
  TeachingExplanation,
} from "@/lib/types";
import { cn, stableId } from "@/lib/utils";

const verdictCopy: Record<
  ExplanationReviewResult["verdict"],
  { label: string; icon: typeof CheckCircle2 }
> = {
  user_correct: { label: "Tu observación es correcta", icon: CheckCircle2 },
  explanation_correct: {
    label: "La explicación está respaldada",
    icon: Scale,
  },
  insufficient_evidence: {
    label: "La evidencia no es suficiente",
    icon: ShieldQuestion,
  },
};

export function TeachingExplanationCard({
  explanation,
  sources,
  originalPrompt,
  courseIds,
  openDocument,
  compact = false,
}: {
  explanation: TeachingExplanation;
  sources: SourceReference[];
  originalPrompt: string;
  courseIds: string[];
  openDocument?: (id: string) => Promise<void>;
  compact?: boolean;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [objection, setObjection] = useState("");
  const [review, setReview] = useState<ExplanationReviewResult | null>(null);
  const [reviewSources, setReviewSources] = useState<SourceReference[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitReview() {
    if (!objection.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const prompt = `Pregunta original:\n${originalPrompt}\n\nExplicación simple:\n${explanation.simple}\n\nExplicación detallada:\n${explanation.detailed}\n\nObjeción del estudiante:\n${objection.trim()}\n\nCompara cada afirmación con las fuentes y emite un veredicto neutral.`;
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "review",
          prompt,
          courseIds,
          documentIds: [],
          retrievalTerms: [originalPrompt, objection.trim()],
          history: [],
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.review) {
        throw new Error(data.error ?? "No se pudo revisar la explicación.");
      }
      const nextReview = data.review as ExplanationReviewResult;
      const nextSources = (data.sources ?? []) as SourceReference[];
      setReview(nextReview);
      setReviewSources(nextSources);
      const saved: ExplanationReview = {
        id: stableId("explanation-review"),
        title: explanation.title,
        originalPrompt,
        explanation: `${explanation.simple}\n\n${explanation.detailed}`,
        objection: objection.trim(),
        result: nextReview,
        sources: nextSources,
        createdAt: new Date().toISOString(),
      };
      await appendPreference("explanationReviews", saved, 100);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo revisar la explicación.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("teaching-explanation", compact && "teaching-explanation-compact")}>
      <div className="teaching-explanation-heading">
        <span><Sparkles size={16} /> Explicación fundamentada</span>
        <button type="button" onClick={() => setReviewOpen(true)}>
          <Flag size={15} /> Revisar explicación
        </button>
      </div>
      <h3>{explanation.title}</h3>
      <Tabs.Root defaultValue="simple">
        <Tabs.List className="explanation-tabs" aria-label="Nivel de explicación">
          <Tabs.Trigger value="simple">Versión simple</Tabs.Trigger>
          <Tabs.Trigger value="detailed">Versión detallada</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="simple" className="explanation-panel">
          <MarkdownView>{explanation.simple}</MarkdownView>
        </Tabs.Content>
        <Tabs.Content value="detailed" className="explanation-panel">
          <MarkdownView>{explanation.detailed}</MarkdownView>
        </Tabs.Content>
      </Tabs.Root>

      <div className="explanation-key-points">
        <strong><ListChecks size={17} /> Ideas que debes retener</strong>
        <ul>
          {explanation.keyPoints.map((point) => <li key={point}>{point}</li>)}
        </ul>
      </div>

      {explanation.visual && <TeachingVisualView visual={explanation.visual} />}

      <div className="explanation-check">
        <strong>Comprueba si quedó claro</strong>
        <p>{explanation.checkQuestion}</p>
      </div>

      {sources.length > 0 && (
        <div className="source-list">
          <span>Fuentes de la explicación</span>
          {sources.map((source, index) => (
            <button
              key={source.id}
              type="button"
              disabled={!openDocument}
              onClick={() => openDocument && void openDocument(source.documentId)}
            >
              <strong>F{index + 1}</strong>
              <span>{source.sourceLabel}</span>
            </button>
          ))}
        </div>
      )}

      <Dialog.Root open={reviewOpen} onOpenChange={setReviewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content explanation-review-dialog">
            <div className="dialog-title-row">
              <div>
                <Dialog.Title>Revisar esta explicación</Dialog.Title>
                <Dialog.Description>
                  Expón tu razonamiento. La IA volverá a comparar ambas posturas
                  con el material recuperado.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="Cerrar"><X size={18} /></button>
              </Dialog.Close>
            </div>

            {!review ? (
              <>
                <label className="review-field">
                  ¿Qué parte consideras incorrecta o incompleta?
                  <VoiceTextarea
                    id={`review-${explanation.title}`}
                    name="explanation-objection"
                    value={objection}
                    onValueChange={setObjection}
                    placeholder="Por ejemplo: creo que este concepto se confunde con... porque en la unidad se indica..."
                  />
                </label>
                {error && <div className="error-banner" role="alert">{error}</div>}
                <div className="dialog-actions">
                  <Dialog.Close asChild><button className="button button-secondary">Cancelar</button></Dialog.Close>
                  <button
                    className="button button-primary"
                    disabled={busy || !objection.trim()}
                    onClick={() => void submitReview()}
                  >
                    {busy ? "Contrastando evidencia…" : "Revisar con las fuentes"}
                    {!busy && <ArrowRight size={17} />}
                  </button>
                </div>
              </>
            ) : (
              <ReviewResult result={review} sources={reviewSources} openDocument={openDocument} />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ReviewResult({
  result,
  sources,
  openDocument,
}: {
  result: ExplanationReviewResult;
  sources: SourceReference[];
  openDocument?: (id: string) => Promise<void>;
}) {
  const verdict = verdictCopy[result.verdict];
  const Icon = verdict.icon;
  return (
    <div className={cn("review-result", `review-result-${result.verdict}`)}>
      <div className="review-verdict"><Icon size={20} /><span><small>Veredicto</small><strong>{verdict.label}</strong></span></div>
      <h3>{result.headline}</h3>
      <MarkdownView>{result.analysis}</MarkdownView>
      {result.correctedExplanation && (
        <div className="review-correction">
          <strong>Explicación revisada</strong>
          <MarkdownView>{result.correctedExplanation}</MarkdownView>
        </div>
      )}
      <div className="review-next"><ArrowRight size={16} /><span>{result.nextStep}</span></div>
      {sources.length > 0 && (
        <div className="source-list">
          <span>Fuentes revisadas</span>
          {sources.map((source, index) => (
            <button key={source.id} type="button" onClick={() => openDocument && void openDocument(source.documentId)}>
              <strong>F{index + 1}</strong><span>{source.sourceLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
