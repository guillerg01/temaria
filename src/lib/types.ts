export type StudyMode =
  | "chat"
  | "summary"
  | "explain"
  | "visualize"
  | "solve"
  | "exam"
  | "grade"
  | "appeal"
  | "review";

export type TeachingVisual = {
  type: "concept_map" | "process" | "timeline" | "comparison" | "bar_chart";
  title: string;
  description: string;
  items: Array<{
    id: string;
    label: string;
    description: string;
    value: number;
    group: string;
  }>;
  connections: Array<{
    from: string;
    to: string;
    label: string;
  }>;
};

export type TeachingExplanation = {
  title: string;
  simple: string;
  detailed: string;
  keyPoints: string[];
  checkQuestion: string;
  visual: TeachingVisual | null;
};

export type ExplanationReviewResult = {
  verdict: "user_correct" | "explanation_correct" | "insufficient_evidence";
  headline: string;
  analysis: string;
  correctedExplanation: string;
  nextStep: string;
};

export type ExplanationReview = {
  id: string;
  title: string;
  originalPrompt: string;
  explanation: string;
  objection: string;
  result: ExplanationReviewResult;
  sources: SourceReference[];
  createdAt: string;
};

export type CourseDocument = {
  id: string;
  courseId: string;
  unit: string;
  path: string;
  title: string;
  markdown: string;
  wordCount: number;
};

export type Course = {
  id: string;
  title: string;
  shortTitle: string;
  documents: CourseDocument[];
  documentCount: number;
  wordCount: number;
};

export type KnowledgeChunk = {
  id: string;
  courseId: string;
  documentId: string;
  courseTitle: string;
  documentTitle: string;
  sectionTitle: string;
  sourceLabel: string;
  text: string;
};

export type Corpus = {
  version: string;
  stats: {
    courses: number;
    documents: number;
    chunks: number;
    words: number;
  };
  courses: Course[];
  chunks: KnowledgeChunk[];
};

export type SourceReference = Pick<
  KnowledgeChunk,
  "id" | "courseId" | "documentId" | "sourceLabel"
> & { excerpt: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  prompt?: string;
  attachment?: {
    type: "selection";
    text: string;
    documentId?: string;
    documentTitle?: string;
  };
  explanation?: TeachingExplanation;
  sources?: SourceReference[];
  createdAt: string;
};

export type ExamQuestion = {
  id: string;
  type: "multiple_choice" | "short_answer" | "essay";
  prompt: string;
  options?: string[];
  answer: string;
  rationale: string;
  rubric?: string[];
  sourceIds: string[];
};

export type GeneratedExam = {
  title: string;
  instructions: string;
  questions: ExamQuestion[];
};

export type SavedExam = {
  id: string;
  exam: GeneratedExam;
  courseId: string;
  difficulty: "basic" | "intermediate" | "advanced";
  requestedQuestionCount: number;
  answers: Record<string, string>;
  sources: SourceReference[];
  grading: string;
  score?: number;
  createdAt: string;
  updatedAt: string;
  gradedAt?: string;
  appeals?: Record<string, ExamAppealReview>;
};

export type ExamAppealReview = {
  questionId: string;
  userComment: string;
  decision: "uphold" | "increase";
  previousScore: number;
  recommendedScore: number;
  responseToStudent: string;
  analysis: string;
  createdAt: string;
};

export type OfficialAssessmentQuestion = {
  number: number;
  prompt: string;
  options?: string[];
  correctAnswer?: string;
};

export type OfficialAssessment = {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  kind: "official_quiz" | "official_assignment";
  scope: string;
  source: {
    platform: string;
    reviewUrl?: string;
    viewUrl?: string;
    capturedAt: string;
    access: "completed_attempt_review" | "submitted_assignment_view";
  };
  result?: {
    score: number;
    maximum: number;
    correct: number;
    total: number;
  };
  questions: OfficialAssessmentQuestion[];
};
