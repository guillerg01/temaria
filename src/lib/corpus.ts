import "server-only";

import path from "node:path";

import { readPrivateJson } from "@/lib/private-json";
import type { Corpus, CourseDocument, KnowledgeChunk } from "@/lib/types";

const emptyCorpus: Corpus = {
  version: "empty",
  stats: { courses: 0, documents: 0, chunks: 0, words: 0 },
  courses: [],
  chunks: [],
};

function loadCorpus(): Corpus {
  const candidates = [
    process.env.TEMARIA_CORPUS_PATH,
    path.join(process.cwd(), "private-data", "corpus.enc"),
    path.join(process.cwd(), "src", "data", "corpus.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const loaded = readPrivateJson<Corpus>(candidate);
      if (loaded) return loaded;
    } catch (error) {
      console.error(`No se pudo cargar el corpus desde ${candidate}.`, error);
    }
  }

  console.warn(
    "Temaria se inició sin corpus privado. Configura TEMARIA_CORPUS_PATH para habilitar la biblioteca.",
  );
  return emptyCorpus;
}

const corpus = loadCorpus();
const documentMap = new Map<string, CourseDocument>();
const chunkTermFrequency = new Map<string, number>();

for (const course of corpus.courses) {
  for (const document of course.documents)
    documentMap.set(document.id, document);
}

export function getCorpus() {
  return corpus;
}

export function getDocument(documentId: string) {
  return documentMap.get(documentId);
}

export function getCatalog() {
  return {
    version: corpus.version,
    stats: corpus.stats,
    courses: corpus.courses.map((course) => ({
      ...course,
      documents: course.documents.map((document) => ({
        id: document.id,
        courseId: document.courseId,
        unit: document.unit,
        path: document.path,
        title: document.title,
        wordCount: document.wordCount,
      })),
    })),
  };
}

const stopWords = new Set(
  "a al algo ante bajo con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era es esa ese esta este fue ha hacia hay la las lo los más me mi muy no o para pero por porque que qué se sin sobre son su sus te un una y ya".split(
    " ",
  ),
);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function terms(value: string) {
  return normalize(value)
    .split(" ")
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

for (const chunk of corpus.chunks) {
  const uniqueTerms = new Set(
    terms(
      `${chunk.courseTitle} ${chunk.documentTitle} ${chunk.sectionTitle} ${chunk.text}`,
    ),
  );
  for (const term of uniqueTerms) {
    chunkTermFrequency.set(term, (chunkTermFrequency.get(term) ?? 0) + 1);
  }
}

function rarity(term: string) {
  const frequency = chunkTermFrequency.get(term) ?? 0;
  return Math.log((corpus.chunks.length + 1) / (frequency + 1)) + 1;
}

function scoreChunk(
  chunk: KnowledgeChunk,
  query: string,
  queryTerms: string[],
  anchorTerms: string[],
) {
  const title = normalize(
    `${chunk.courseTitle} ${chunk.documentTitle} ${chunk.sectionTitle}`,
  );
  const text = normalize(chunk.text);
  const normalizedQuery = normalize(query);
  let score = 0;

  if (normalizedQuery.length > 5 && text.includes(normalizedQuery)) score += 18;
  if (normalizedQuery.length > 5 && title.includes(normalizedQuery))
    score += 24;

  for (const term of queryTerms) {
    const weight = Math.min(rarity(term), 7);
    if (title.includes(term)) score += 5 * weight;
    const matches = text.match(new RegExp(`\\b${term}\\b`, "g"))?.length ?? 0;
    score += Math.min(matches, 5) * 1.35 * weight;
  }


  for (const anchor of anchorTerms) {
    if (title.includes(anchor)) score += 42;
    const matches = text.match(new RegExp(`\\b${anchor}\\b`, "g"))?.length ?? 0;
    score += Math.min(matches, 3) * 34;
  }

  const uniqueMatches = queryTerms.filter(
    (term) => title.includes(term) || text.includes(term),
  ).length;
  score += uniqueMatches * uniqueMatches * 0.8;
  return score;
}

export function retrieveKnowledge(options: {
  query: string;
  courseIds?: string[];
  documentIds?: string[];
  chunkIds?: string[];
  excludeDocumentIds?: string[];
  anchorTerms?: string[];
  limit?: number;
  balanceCourses?: boolean;
  balanceDocuments?: boolean;
  randomize?: boolean;
  includeAllCandidates?: boolean;
}) {
  const queryTerms = terms(options.query);
  const anchorTerms = [
    ...new Set((options.anchorTerms ?? []).flatMap((value) => terms(value))),
  ];
  const courseSet = new Set(options.courseIds ?? []);
  const documentSet = new Set(options.documentIds ?? []);
  const chunkSet = new Set(options.chunkIds ?? []);
  const excludedDocumentSet = new Set(options.excludeDocumentIds ?? []);
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 14);

  let ranked = corpus.chunks
    .filter((chunk) => !courseSet.size || courseSet.has(chunk.courseId))
    .filter((chunk) => !documentSet.size || documentSet.has(chunk.documentId))
    .filter((chunk) => !chunkSet.size || chunkSet.has(chunk.id))
    .filter((chunk) => !excludedDocumentSet.has(chunk.documentId))
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, options.query, queryTerms, anchorTerms),
    }))
    .filter((result) => options.includeAllCandidates || result.score > 0)
    .sort((a, b) => b.score - a.score);

  if (options.randomize) {
    ranked = ranked
      .map((result) => ({ result, random: Math.random() }))
      .sort((a, b) => a.random - b.random)
      .map(({ result }) => result);
  }

  if (!options.balanceCourses || courseSet.size || documentSet.size) {
    if (options.balanceDocuments) {
      const firstByDocument = new Set<string>();
      const diverse = ranked.filter(({ chunk }) => {
        if (firstByDocument.has(chunk.documentId)) return false;
        firstByDocument.add(chunk.documentId);
        return true;
      });
      const selectedIds = new Set(diverse.map(({ chunk }) => chunk.id));
      return [...diverse, ...ranked.filter(({ chunk }) => !selectedIds.has(chunk.id))].slice(0, limit);
    }
    return ranked.slice(0, limit);
  }

  const perCourse = new Map<string, typeof ranked>();
  for (const result of ranked) {
    const current = perCourse.get(result.chunk.courseId) ?? [];
    if (!options.balanceDocuments || !current.some((item) => item.chunk.documentId === result.chunk.documentId)) current.push(result);
    perCourse.set(result.chunk.courseId, current);
  }

  const balanced: typeof ranked = [];
  let round = 0;
  while (balanced.length < limit) {
    let added = false;
    for (const course of corpus.courses) {
      const candidate = perCourse.get(course.id)?.[round];
      if (candidate) {
        balanced.push(candidate);
        added = true;
        if (balanced.length === limit) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return balanced;
}
