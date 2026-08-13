"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowLeft,
  ArrowUp,
  BarChart3,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileQuestion,
  GraduationCap,
  Library,
  ListTree,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  NotebookPen,
  PanelLeftClose,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { extractStudyHeadings, MarkdownView } from "@/components/markdown-view";
import { TeachingExplanationCard } from "@/components/teaching-explanation";
import {
  clearStudyData,
  readPreference,
  writePreference,
} from "@/lib/client-db";
import type {
  ChatMessage,
  Course,
  CourseDocument,
  GeneratedExam,
  OfficialAssessment,
  SavedExam,
  SourceReference,
  StudyMode,
  TeachingExplanation,
} from "@/lib/types";
import { cn, stableId } from "@/lib/utils";

type CatalogDocument = Omit<CourseDocument, "markdown">;
type GradingQuestionFeedback = {
  numero?: number;
  nota?: number;
  maximo?: number;
  valoracion?: string;
  aciertos?: string[];
  omisiones?: string[];
  errores_conceptuales?: string[];
  errores_redaccion?: string[];
  respuesta_modelo?: string;
};
type StructuredGrading = {
  nota_global?: number;
  criterio_global?: string;
  valoracion_global?: {
    aciertos?: string[];
    omisiones?: string[];
    errores_conceptuales?: string[];
    errores_redaccion?: string[];
    retroalimentacion_concreta?: string[];
  };
  preguntas?: GradingQuestionFeedback[];
};

function parseStructuredGrading(value: string): StructuredGrading | null {
  const clean = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [clean];
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(clean.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as StructuredGrading;
      if (parsed && typeof parsed === "object" &&
        (typeof parsed.nota_global === "number" || Array.isArray(parsed.preguntas))) return parsed;
    } catch {
      // Try the next candidate when the provider wrapped JSON in prose.
    }
  }
  return null;
}

function FeedbackList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <section className="grading-feedback-section"><h4>{title}</h4><ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul></section>;
}

function GradingFeedback({ value }: { value: string }) {
  const feedback = parseStructuredGrading(value);
  if (!feedback) return <MarkdownView>{value}</MarkdownView>;
  const global = feedback.valoracion_global;
  return <div className="grading-feedback">
    <header className="grading-feedback-summary"><div><span>Calificación global</span><strong>{feedback.nota_global ?? "—"}<small>/10</small></strong></div><p>{feedback.criterio_global}</p></header>
    <div className="grading-feedback-grid"><FeedbackList title="Aciertos" items={global?.aciertos} /><FeedbackList title="Aspectos por completar" items={global?.omisiones} /><FeedbackList title="Errores conceptuales" items={global?.errores_conceptuales} /><FeedbackList title="Redacción y claridad" items={global?.errores_redaccion} /></div>
    <FeedbackList title="Cómo mejorar" items={global?.retroalimentacion_concreta} />
    {feedback.preguntas?.length ? <div className="grading-question-feedback"><h3>Revisión por pregunta</h3>{feedback.preguntas.map((question, index) => <details key={`grading-question-${question.numero ?? index}`}><summary><span>Pregunta {question.numero ?? index + 1}</span><strong>{question.nota ?? "—"}/{question.maximo ?? "—"}</strong></summary><div className="grading-question-content">{question.valoracion && <p>{question.valoracion}</p>}<FeedbackList title="Aciertos" items={question.aciertos} /><FeedbackList title="Omisiones" items={question.omisiones} /><FeedbackList title="Errores conceptuales" items={question.errores_conceptuales} /><FeedbackList title="Redacción" items={question.errores_redaccion} />{question.respuesta_modelo && <section className="grading-model-answer"><h4>Respuesta modelo</h4><p>{question.respuesta_modelo}</p></section>}</div></details>)}</div> : null}
  </div>;
}
type CatalogCourse = Omit<Course, "documents"> & {
  documents: CatalogDocument[];
};
type Catalog = {
  version: string;
  stats: { courses: number; documents: number; chunks: number; words: number };
  courses: CatalogCourse[];
};
type View = "library" | "official" | "tutor" | "exam" | "progress";
type TutorDraft = {
  mode: "chat" | "explain" | "visualize";
  text: string;
  documentId?: string;
  documentTitle?: string;
  selectedText?: string;
};

const courseAccents = ["coral", "teal", "blue", "gold", "rose", "green"];
const aiModes: Array<{
  id: StudyMode;
  label: string;
  icon: typeof Bot;
  placeholder: string;
}> = [
  {
    id: "chat",
    label: "Consultar",
    icon: MessageSquareText,
    placeholder: "Pregunta algo sobre el material...",
  },
  {
    id: "summary",
    label: "Resumir",
    icon: NotebookPen,
    placeholder: "Indica el tema, unidad o enfoque del resumen...",
  },
  {
    id: "explain",
    label: "Explicar",
    icon: CircleHelp,
    placeholder: "¿Qué concepto quieres comprender paso a paso?",
  },
  {
    id: "visualize",
    label: "Visualizar",
    icon: BarChart3,
    placeholder: "¿Qué concepto quieres ver como proceso, mapa o comparación?",
  },
  {
    id: "solve",
    label: "Resolver",
    icon: ClipboardCheck,
    placeholder: "Pega aquí preguntas, opciones o un caso práctico...",
  },
  {
    id: "grade",
    label: "Calificar",
    icon: GraduationCap,
    placeholder:
      "Pega el enunciado y después tu respuesta para recibir una evaluación...",
  },
];

function unitLabel(unit: string) {
  if (unit === "evaluaciones") return "Evaluaciones";
  const match = unit.match(/unidad-(\d+)/);
  return match ? `Unidad ${Number(match[1])}` : unit.replaceAll("-", " ");
}

function ToolButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button aria-label={label} {...props}>
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tooltip" sideOffset={7}>
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function GlobalScopeBar({
  catalog,
  value,
  onChange,
}: {
  catalog: Catalog;
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = catalog.courses.find((course) => course.id === value);
  return (
    <div className="global-scope-bar" aria-label="Alcance global del estudio">
      <div className="global-scope-copy">
        <Target size={17} />
        <span>
          <small>Alcance global</small>
          <strong>{selected?.title ?? "Todos los cursos"}</strong>
        </span>
      </div>
      <label>
        <span className="sr-only">Cambiar alcance global</span>
        <select
          id="global-course-scope"
          name="global-course-scope"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="all">Todos los cursos</option>
          {catalog.courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
        <ChevronDown size={16} />
      </label>
    </div>
  );
}

export function StudyApp({
  catalog,
  officialAssessments,
}: {
  catalog: Catalog;
  officialAssessments: OfficialAssessment[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("library");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tutorDraft, setTutorDraft] = useState<TutorDraft | null>(null);
  const [globalScope, setGlobalScope] = useState("all");
  const [activeCourseId, setActiveCourseId] = useState(
    catalog.courses[0]?.id ?? "",
  );
  const [activeDocument, setActiveDocument] = useState<CourseDocument | null>(
    null,
  );
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [lastDocumentId, setLastDocumentId] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const storedTheme = localStorage.getItem("aula-theme");
    const initialTheme =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    const frame = window.requestAnimationFrame(() => {
      setTheme(initialTheme);
      document.documentElement.dataset.theme = initialTheme;
      document.documentElement.style.colorScheme = initialTheme;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const activeCourse =
    catalog.courses.find((course) => course.id === activeCourseId) ??
    catalog.courses[0];
  const filteredDocuments = useMemo(() => {
    const scopedDocuments =
      globalScope === "all"
        ? catalog.courses.flatMap((course) => course.documents)
        : (catalog.courses.find((course) => course.id === globalScope)
            ?.documents ?? []);
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return scopedDocuments;
    return scopedDocuments.filter((document) =>
      `${document.title} ${unitLabel(document.unit)}`
        .toLocaleLowerCase("es")
        .includes(normalized),
    );
  }, [catalog.courses, globalScope, query]);

  const groupedDocuments = useMemo(() => {
    return filteredDocuments.reduce<Record<string, CatalogDocument[]>>(
      (groups, document) => {
        const groupKey =
          globalScope === "all"
            ? `${document.courseId}::${document.unit}`
            : document.unit;
        (groups[groupKey] ??= []).push(document);
        return groups;
      },
      {},
    );
  }, [filteredDocuments, globalScope]);

  useEffect(() => {
    Promise.all([
      readPreference<string[]>("completed", []),
      readPreference<string[]>("bookmarks", []),
      readPreference<Record<string, string>>("notes", {}),
      readPreference<string>("lastDocument", ""),
      readPreference<string>("globalScope", "all"),
    ]).then(([savedCompleted, savedBookmarks, savedNotes, lastDocument, savedScope]) => {
      setCompleted(savedCompleted);
      setBookmarks(savedBookmarks);
      setNotes(savedNotes);
      setLastDocumentId(lastDocument);
      if (
        savedScope === "all" ||
        catalog.courses.some((course) => course.id === savedScope)
      ) {
        setGlobalScope(savedScope);
        if (savedScope !== "all") setActiveCourseId(savedScope);
      }
      setStorageReady(true);
    });
  }, [catalog.courses]);

  useEffect(() => {
    if (storageReady) void writePreference("completed", completed);
  }, [completed, storageReady]);
  useEffect(() => {
    if (storageReady) void writePreference("bookmarks", bookmarks);
  }, [bookmarks, storageReady]);
  useEffect(() => {
    if (storageReady) void writePreference("notes", notes);
  }, [notes, storageReady]);
  useEffect(() => {
    if (storageReady) void writePreference("globalScope", globalScope);
  }, [globalScope, storageReady]);

  function changeGlobalScope(scope: string) {
    setGlobalScope(scope);
    if (scope !== "all") setActiveCourseId(scope);
  }

  function navigateTo(nextView: View) {
    setTutorDraft(null);
    setView(nextView);
    setMobileNavOpen(false);
  }

  function openTutorWithDraft(draft: TutorDraft | null) {
    setTutorDraft(draft);
    setView("tutor");
    setMobileNavOpen(false);
  }

  useEffect(() => {
    if (!lastDocumentId) return;
    fetch(`/api/documents/${encodeURIComponent(lastDocumentId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((document: CourseDocument | null) => {
        if (document) {
          setActiveDocument(document);
          setActiveCourseId(document.courseId);
        }
      })
      .catch(() => undefined);
  }, [lastDocumentId]);

  async function openDocument(documentId: string) {
    setLoadingDocument(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(documentId)}`,
      );
      if (!response.ok) throw new Error("No se pudo abrir el documento.");
      const document = (await response.json()) as CourseDocument;
      setActiveDocument(document);
      setActiveCourseId(document.courseId);
      setView("library");
      setMobileNavOpen(false);
      void writePreference("lastDocument", document.id);
    } finally {
      setLoadingDocument(false);
    }
  }

  function toggleInList(
    id: string,
    current: string[],
    setter: (value: string[]) => void,
  ) {
    setter(
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("aula-theme", nextTheme);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function resetStudyData() {
    const themeToKeep = localStorage.getItem("aula-theme");
    await clearStudyData();
    localStorage.removeItem("aula-theme");
    setCompleted([]);
    setBookmarks([]);
    setNotes({});
    setActiveDocument(null);
    setLastDocumentId("");
    setGlobalScope("all");
    setActiveCourseId(catalog.courses[0]?.id ?? "");
    setTheme("light");
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
    if (themeToKeep) localStorage.removeItem("aula-theme");
    setResetOpen(false);
    router.push("/aula");
    router.refresh();
  }

  const overallProgress = Math.round(
    (completed.length / Math.max(catalog.stats.documents, 1)) * 100,
  );

  return (
    <div
      className={cn(
        "app-shell",
        !sidebarOpen && "app-shell-sidebar-collapsed",
      )}
    >
      <aside
        className={cn("app-sidebar", !sidebarOpen && "app-sidebar-collapsed")}
      >
        <div className="brand-row">
          <div className="brand-mark">
            <GraduationCap size={19} />
          </div>
          {sidebarOpen && (
            <div>
              <strong>Temaria</strong>
              <span>Estudio SSCS0208</span>
            </div>
          )}
          <ToolButton
            label={sidebarOpen ? "Contraer navegación" : "Expandir navegación"}
            className="icon-button desktop-only"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <PanelLeftClose
              size={17}
              className={cn(!sidebarOpen && "rotate-180")}
            />
          </ToolButton>
        </div>

        <nav className="primary-nav" aria-label="Navegación principal">
          {(
            [
              ["library", Library, "Biblioteca"],
              ["official", ClipboardCheck, "Evaluaciones"],
              ["tutor", Bot, "Tutor IA"],
              ["exam", FileQuestion, "Simulador"],
              ["progress", Target, "Progreso"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={cn("nav-button", view === id && "nav-button-active")}
              onClick={() => {
                navigateTo(id);
              }}
            >
              <Icon size={19} />
              {sidebarOpen && <span>{label}</span>}
            </button>
          ))}
        </nav>

        {sidebarOpen && (
          <div className="sidebar-progress">
            <div className="progress-copy">
              <span>Progreso general</span>
              <strong>{overallProgress}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${overallProgress}%` }} />
            </div>
            <small>
              {completed.length} de {catalog.stats.documents} temas completados
            </small>
          </div>
        )}
        <div className="sidebar-utilities">
          <button onClick={() => setResetOpen(true)}>
            <Target size={18} />
            {sidebarOpen && <span>Restablecer datos</span>}
          </button>
          <button
            aria-label={
              theme === "dark" ? "Usar tema claro" : "Usar tema oscuro"
            }
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {sidebarOpen && (
              <span>{theme === "dark" ? "Tema claro" : "Tema oscuro"}</span>
            )}
          </button>
          <button aria-label="Cerrar sesión" onClick={() => void logout()}>
            <LogOut size={18} />
            {sidebarOpen && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <ToolButton
          label="Abrir navegación"
          className="icon-button"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu size={20} />
        </ToolButton>
        <div className="brand-mark">
          <GraduationCap size={18} />
        </div>
        <strong>Temaria</strong>
        <div className="mobile-header-actions">
          <ToolButton
            label={theme === "dark" ? "Usar tema claro" : "Usar tema oscuro"}
            className="icon-button"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </ToolButton>
          <ToolButton
            label="Cerrar sesión"
            className="icon-button"
            onClick={() => void logout()}
          >
            <LogOut size={18} />
          </ToolButton>
        </div>
      </header>

      {mobileNavOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Cerrar navegación"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={cn("mobile-drawer", mobileNavOpen && "mobile-drawer-open")}
      >
        <div className="drawer-header">
          <strong>Navegación</strong>
          <ToolButton
            label="Cerrar"
            className="icon-button"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={19} />
          </ToolButton>
        </div>
        {(["library", "official", "tutor", "exam", "progress"] as View[]).map((item) => (
          <button
            key={item}
            className={cn("drawer-link", view === item && "drawer-link-active")}
            onClick={() => {
              navigateTo(item);
            }}
          >
            {item === "library"
              ? "Biblioteca"
              : item === "official"
                ? "Evaluaciones"
              : item === "tutor"
                ? "Tutor IA"
                : item === "exam"
                  ? "Simulador"
                  : "Progreso"}
          </button>
        ))}
        <div className="drawer-utilities">
          <button onClick={() => setResetOpen(true)}>
            <Target size={18} />
            Restablecer datos
          </button>
          <button onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Tema claro" : "Tema oscuro"}
          </button>
          <button onClick={() => void logout()}>
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="app-main" id="main-content">
        <GlobalScopeBar
          catalog={catalog}
          value={globalScope}
          onChange={changeGlobalScope}
        />
        <div className="app-view-area">
        {view === "library" && (
          <LibraryView
            catalog={catalog}
            activeCourse={globalScope === "all" ? undefined : activeCourse}
            activeCourseId={globalScope}
            setActiveCourseId={(id) => changeGlobalScope(id)}
            groupedDocuments={groupedDocuments}
            query={query}
            setQuery={setQuery}
            activeDocument={activeDocument}
            loadingDocument={loadingDocument}
            openDocument={openDocument}
            completed={completed}
            bookmarks={bookmarks}
            toggleCompleted={(id) => toggleInList(id, completed, setCompleted)}
            toggleBookmark={(id) => toggleInList(id, bookmarks, setBookmarks)}
            openNote={() => setNoteOpen(true)}
            openTutor={() => openTutorWithDraft(null)}
            openTutorWithSelection={(mode, selectedText) =>
              openTutorWithDraft({
                mode,
                text:
                  mode === "explain"
                    ? "Explícame este fragmento."
                    : "",
                documentId: activeDocument?.id,
                documentTitle: activeDocument?.title,
                selectedText,
              })
            }
          />
        )}
        {view === "tutor" && (
          <TutorView
            activeDocument={activeDocument}
            openDocument={openDocument}
            globalScope={globalScope}
            initialDraft={tutorDraft}
          />
        )}
        {view === "official" && (
          <OfficialAssessmentsView
            assessments={officialAssessments}
            globalScope={globalScope}
            openDocument={openDocument}
          />
        )}
        {view === "exam" && (
          <ExamView
            catalog={catalog}
            openDocument={openDocument}
            globalScope={globalScope}
          />
        )}
        {view === "progress" && (
          <ProgressView
            catalog={catalog}
            completed={completed}
            bookmarks={bookmarks}
            openDocument={openDocument}
            globalScope={globalScope}
          />
        )}
        </div>
      </main>

      <Dialog.Root open={noteOpen} onOpenChange={setNoteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <div className="dialog-title-row">
              <Dialog.Title>Notas del tema</Dialog.Title>
              <Dialog.Close asChild>
                <button className="icon-button">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Estas notas se guardan únicamente en este navegador.
            </Dialog.Description>
            <textarea
              id="topic-notes"
              name="topic-notes"
              className="note-textarea"
              value={activeDocument ? (notes[activeDocument.id] ?? "") : ""}
              onChange={(event) =>
                activeDocument &&
                setNotes({ ...notes, [activeDocument.id]: event.target.value })
              }
              placeholder="Escribe recordatorios, dudas o relaciones importantes..."
            />
            <Dialog.Close asChild>
              <button className="button button-primary">
                <Check size={17} />
                Guardar
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={resetOpen} onOpenChange={setResetOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content reset-dialog">
            <div className="dialog-title-row">
              <Dialog.Title>Restablecer todo el estudio</Dialog.Title>
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="Cerrar">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Se borrarán el progreso, favoritos, notas, conversaciones,
              exámenes generados, respuestas y calificaciones guardadas en
              este navegador. Esta acción no afecta al campus oficial.
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button className="button button-secondary">Cancelar</button>
              </Dialog.Close>
              <button
                className="button button-danger"
                onClick={() => void resetStudyData()}
              >
                Restablecer definitivamente
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function LibraryView(props: {
  catalog: Catalog;
  activeCourse?: CatalogCourse;
  activeCourseId: string;
  setActiveCourseId: (id: string) => void;
  groupedDocuments: Record<string, CatalogDocument[]>;
  query: string;
  setQuery: (value: string) => void;
  activeDocument: CourseDocument | null;
  loadingDocument: boolean;
  openDocument: (id: string) => Promise<void>;
  completed: string[];
  bookmarks: string[];
  toggleCompleted: (id: string) => void;
  toggleBookmark: (id: string) => void;
  openNote: () => void;
  openTutor: () => void;
  openTutorWithSelection: (
    mode: "chat" | "explain",
    selectedText: string,
  ) => void;
}) {
  const [contentsOpen, setContentsOpen] = useState(true);
  const readerRef = useRef<HTMLDivElement>(null);
  const readerViewportRef = useRef<HTMLDivElement>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [selectionAction, setSelectionAction] = useState<{
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const readingSections = useMemo(
    () => extractStudyHeadings(props.activeDocument?.markdown ?? ""),
    [props.activeDocument?.markdown],
  );
  const currentCourseDocuments =
    props.catalog.courses.find(
      (course) => course.id === props.activeDocument?.courseId,
    )?.documents ?? [];
  const currentDocumentIndex = currentCourseDocuments.findIndex(
    (document) => document.id === props.activeDocument?.id,
  );
  const previousDocument =
    currentDocumentIndex > 0
      ? currentCourseDocuments[currentDocumentIndex - 1]
      : undefined;
  const nextDocument =
    currentDocumentIndex >= 0 &&
    currentDocumentIndex < currentCourseDocuments.length - 1
      ? currentCourseDocuments[currentDocumentIndex + 1]
      : undefined;

  useEffect(() => {
    const viewport = readerViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: 0 });
    setReadingProgress(0);
    setActiveSectionIndex(0);
    setOutlineOpen(false);
  }, [props.activeDocument?.id]);

  function updateReadingPosition() {
    const viewport = readerViewportRef.current;
    if (!viewport) return;
    const scrollable = Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    setReadingProgress(Math.min(100, (viewport.scrollTop / scrollable) * 100));
    const viewportTop = viewport.getBoundingClientRect().top;
    const headings = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-study-heading='true']"),
    );
    let current = 0;
    headings.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top <= viewportTop + 150) current = index;
    });
    setActiveSectionIndex(current);
  }

  function scrollToReaderTop() {
    readerViewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToSection(index: number) {
    const viewport = readerViewportRef.current;
    const target = viewport?.querySelectorAll<HTMLElement>(
      "[data-study-heading='true']",
    )[index];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => target.focus({ preventScroll: true }), 350);
    setActiveSectionIndex(index);
    setOutlineOpen(false);
  }

  function captureSelection() {
    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!selection || selection.rangeCount === 0 || text.length < 3) {
        setSelectionAction(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const reader = readerRef.current;
      if (!reader || !reader.contains(range.commonAncestorContainer)) {
        setSelectionAction(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const container = reader.getBoundingClientRect();
      setSelectionAction({
        text: text.slice(0, 4_000),
        left: Math.min(
          Math.max(rect.left - container.left + rect.width / 2, 120),
          Math.max(container.width - 120, 120),
        ),
        top: Math.max(rect.top - container.top - 10, 54),
      });
    });
  }

  function sendSelectionToTutor(mode: "chat" | "explain") {
    if (!selectionAction) return;
    props.openTutorWithSelection(mode, selectionAction.text);
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
  }

  return (
    <div className="library-layout">
      <section
        className={cn("catalog-panel", !contentsOpen && "catalog-panel-hidden")}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Biblioteca</span>
            <h1>Material del curso</h1>
          </div>
          <ToolButton
            label="Ocultar índice"
            className="icon-button mobile-tablet"
            onClick={() => setContentsOpen(false)}
          >
            <ArrowLeft size={18} />
          </ToolButton>
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            id="library-search"
            name="library-search"
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
            placeholder="Buscar temas..."
          />
        </label>
        <label className="select-label">
          Curso
          <select
            id="library-course"
            name="library-course"
            value={props.activeCourseId}
            onChange={(event) => props.setActiveCourseId(event.target.value)}
          >
            <option value="all">Todos los cursos</option>
            {props.catalog.courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
          <ChevronDown size={16} />
        </label>
        <ScrollArea.Root className="catalog-scroll">
          <ScrollArea.Viewport className="scroll-viewport">
            {Object.entries(props.groupedDocuments).map(([unitKey, documents]) => {
              const [groupCourseId, unit] = unitKey.includes("::")
                ? unitKey.split("::", 2)
                : [props.activeCourseId, unitKey];
              const groupCourse = props.catalog.courses.find(
                (course) => course.id === groupCourseId,
              );
              return (
              <div className="unit-group" key={unitKey}>
                <div className="unit-label">
                  <span className="unit-label-copy">
                    {props.activeCourseId !== groupCourseId && (
                      <small>{groupCourse?.shortTitle ?? groupCourseId}</small>
                    )}
                    {unitLabel(unit)}
                  </span>
                  <span>{documents.length}</span>
                </div>
                {documents.map((document) => (
                  <button
                    key={document.id}
                    className={cn(
                      "document-link",
                      props.activeDocument?.id === document.id &&
                        "document-link-active",
                    )}
                    onClick={() => void props.openDocument(document.id)}
                  >
                    <span
                      className={cn(
                        "completion-dot",
                        props.completed.includes(document.id) &&
                          "completion-dot-done",
                      )}
                    >
                      {props.completed.includes(document.id) && (
                        <Check size={11} />
                      )}
                    </span>
                    <span>
                      {document.title.replace(/^Unidad \d+\s*[-–]\s*/i, "")}
                    </span>
                    {props.bookmarks.includes(document.id) && (
                      <Bookmark size={13} />
                    )}
                  </button>
                ))}
              </div>
            )})}
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar className="scrollbar" orientation="vertical">
            <ScrollArea.Thumb className="scroll-thumb" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </section>

      <section
        className="reader-panel"
        ref={readerRef}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        {selectionAction && (
          <div
            className="selection-toolbar"
            style={{ left: selectionAction.left, top: selectionAction.top }}
            role="toolbar"
            aria-label="Acciones para el texto seleccionado"
          >
            <button type="button" onClick={() => sendSelectionToTutor("explain")}>
              <Sparkles size={15} /> Explicar selección
            </button>
            <button type="button" onClick={() => sendSelectionToTutor("chat")}>
              <MessageSquareText size={15} /> Llevar al chat
            </button>
            <button
              type="button"
              aria-label="Cerrar acciones de selección"
              onClick={() => setSelectionAction(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!contentsOpen && (
          <button
            className="button button-secondary index-toggle"
            onClick={() => setContentsOpen(true)}
          >
            <BookOpen size={17} />
            Índice
          </button>
        )}
        {props.loadingDocument ? (
          <ReaderSkeleton />
        ) : props.activeDocument ? (
          <>
            <div className="reader-toolbar">
              <div>
                <span className="reader-path">
                  {props.catalog.courses.find(
                    (course) => course.id === props.activeDocument?.courseId,
                  )?.title} /{" "}
                  {unitLabel(props.activeDocument.unit)}
                </span>
                <h2>{props.activeDocument.title}</h2>
              </div>
              <div className="reader-actions">
                {readingSections.length > 1 && (
                  <button
                    type="button"
                    className="button button-secondary reader-outline-button"
                    aria-expanded={outlineOpen}
                    aria-controls="reader-outline"
                    onClick={() => setOutlineOpen((open) => !open)}
                  >
                    <ListTree size={17} />
                    Secciones
                  </button>
                )}
                <ToolButton
                  label="Añadir a favoritos"
                  className={cn(
                    "icon-button",
                    props.bookmarks.includes(props.activeDocument.id) &&
                      "icon-button-active",
                  )}
                  onClick={() => props.toggleBookmark(props.activeDocument!.id)}
                >
                  {props.bookmarks.includes(props.activeDocument.id) ? (
                    <BookmarkCheck size={18} />
                  ) : (
                    <Bookmark size={18} />
                  )}
                </ToolButton>
                <ToolButton
                  label="Abrir notas"
                  className="icon-button"
                  onClick={props.openNote}
                >
                  <NotebookPen size={18} />
                </ToolButton>
                <button
                  className={cn(
                    "button button-complete",
                    props.completed.includes(props.activeDocument.id) &&
                      "button-complete-done",
                  )}
                  onClick={() =>
                    props.toggleCompleted(props.activeDocument!.id)
                  }
                >
                  <CheckCircle2 size={17} />
                  {props.completed.includes(props.activeDocument.id)
                    ? "Completado"
                    : "Marcar leído"}
                </button>
              </div>
            </div>
            <div className="reading-progress" aria-hidden="true">
              <span style={{ width: `${readingProgress}%` }} />
            </div>
            {outlineOpen && readingSections.length > 1 && (
              <nav
                className="reader-outline"
                id="reader-outline"
                aria-label="Secciones del tema"
              >
                <header>
                  <div>
                    <span>Contenido del tema</span>
                    <strong>{readingSections.length} secciones</strong>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Cerrar contenido del tema"
                    onClick={() => setOutlineOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </header>
                <ol>
                  {readingSections.map((section, index) => (
                    <li
                      className={cn(
                        section.level > 2 && "reader-outline-nested",
                        index === activeSectionIndex && "reader-outline-active",
                      )}
                      key={section.id}
                    >
                      <button type="button" onClick={() => scrollToSection(index)}>
                        <span>{index + 1}</span>
                        {section.text}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            <ScrollArea.Root className="reader-scroll">
              <ScrollArea.Viewport
                className="reader-viewport"
                ref={readerViewportRef}
                onScroll={updateReadingPosition}
              >
                <MarkdownView navigableHeadings>
                  {props.activeDocument.markdown}
                </MarkdownView>
                <div className="reader-end">
                  <Sparkles size={20} />
                  <div>
                    <strong>¿Quieres trabajar este tema?</strong>
                    <span>
                      Pide una explicación, un resumen o preguntas de práctica.
                    </span>
                  </div>
                  <button
                    className="button button-primary"
                    onClick={props.openTutor}
                  >
                    <Bot size={17} />
                    Abrir tutor
                  </button>
                </div>
                {(previousDocument || nextDocument) && (
                  <nav className="reader-topic-pagination" aria-label="Navegación entre temas">
                    {previousDocument ? (
                      <button
                        type="button"
                        onClick={() => void props.openDocument(previousDocument.id)}
                      >
                        <ChevronLeft size={18} />
                        <span><small>Tema anterior</small><strong>{previousDocument.title}</strong></span>
                      </button>
                    ) : <span />}
                    {nextDocument ? (
                      <button
                        type="button"
                        onClick={() => void props.openDocument(nextDocument.id)}
                      >
                        <span><small>Tema siguiente</small><strong>{nextDocument.title}</strong></span>
                        <ChevronRight size={18} />
                      </button>
                    ) : <span />}
                  </nav>
                )}
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar
                className="scrollbar"
                orientation="vertical"
              >
                <ScrollArea.Thumb className="scroll-thumb" />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
            {readingProgress > 4 && (
              <div className="reader-section-controls" aria-label="Controles de lectura">
                {readingSections.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Ir a la sección anterior"
                      disabled={activeSectionIndex === 0}
                      onClick={() => scrollToSection(activeSectionIndex - 1)}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span>
                      <small>Sección</small>
                      <strong>{activeSectionIndex + 1}/{readingSections.length}</strong>
                    </span>
                    <button
                      type="button"
                      aria-label="Ir a la sección siguiente"
                      disabled={activeSectionIndex >= readingSections.length - 1}
                      onClick={() => scrollToSection(activeSectionIndex + 1)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-label="Volver al inicio del tema"
                  onClick={scrollToReaderTop}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyReader
            course={props.activeCourse}
            onOpen={(id) => void props.openDocument(id)}
          />
        )}
      </section>
    </div>
  );
}

function EmptyReader({
  course,
  onOpen,
}: {
  course?: CatalogCourse;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="empty-reader">
      <div className="empty-reader-icon">
        <BookOpen size={28} />
      </div>
      <span className="eyebrow">Listo para estudiar</span>
      <h2>{course?.title ?? "Selecciona un curso"}</h2>
      <p>
        Abre un tema del índice para leerlo, tomar notas y usarlo como alcance
        del tutor.
      </p>
      {course?.documents[0] && (
        <button
          className="button button-primary"
          onClick={() => onOpen(course.documents[0].id)}
        >
          <BookOpen size={17} />
          Empezar el primer tema
        </button>
      )}
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="reader-skeleton">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function TutorView({
  activeDocument,
  openDocument,
  globalScope,
  initialDraft,
}: {
  activeDocument: CourseDocument | null;
  openDocument: (id: string) => Promise<void>;
  globalScope: string;
  initialDraft: TutorDraft | null;
}) {
  const [mode, setMode] = useState<StudyMode>(initialDraft?.mode ?? "chat");
  const [prompt, setPrompt] = useState(initialDraft?.text ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [draftContext, setDraftContext] = useState<TutorDraft | null>(initialDraft);
  const selectedMode = aiModes.find((item) => item.id === mode) ?? aiModes[0];

  useEffect(() => {
    readPreference<ChatMessage[]>("chatMessages", []).then((saved) => {
      setMessages(saved);
      setHistoryReady(true);
    });
  }, []);

  useEffect(() => {
    if (historyReady) {
      void writePreference(
        "chatMessages",
        messages.slice(-40),
      );
    }
  }, [historyReady, messages]);

  function clearConversation() {
    setMessages([]);
    setPrompt("");
    setDraftContext(null);
    setError("");
    void writePreference("chatMessages", []);
  }

  async function submit() {
    if ((!prompt.trim() && !draftContext?.selectedText) || busy) return;
    const visiblePrompt =
      prompt.trim() ||
      (mode === "explain"
        ? "Explícame este fragmento."
        : "Quiero hablar sobre este fragmento.");
    const userMessage: ChatMessage = {
      id: stableId("user"),
      role: "user",
      content: visiblePrompt,
      attachment: draftContext?.selectedText
        ? {
            type: "selection",
            text: draftContext.selectedText,
            documentId: draftContext.documentId,
            documentTitle: draftContext.documentTitle,
          }
        : undefined,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setPrompt("");
    const requestDraft = draftContext;
    setDraftContext(null);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          prompt:
            (mode === "explain" || mode === "visualize") &&
            activeDocument &&
            !userMessage.content.includes(activeDocument.title)
              ? `${userMessage.content}\n\nTema abierto: ${activeDocument.title}. Usa este tema como contexto principal.${requestDraft?.selectedText ? `\n\nFragmento adjunto por el estudiante:\n${requestDraft.selectedText}` : ""}`
              : `${userMessage.content}${requestDraft?.selectedText ? `\n\nFragmento adjunto por el estudiante:\n${requestDraft.selectedText}` : ""}`,
          courseIds: globalScope === "all" ? [] : [globalScope],
          documentIds:
            (requestDraft?.documentId || activeDocument?.id) &&
            (mode === "explain" || mode === "visualize")
              ? [requestDraft?.documentId ?? activeDocument!.id]
              : [],
          retrievalTerms: [
            ...(requestDraft?.selectedText ? [requestDraft.selectedText] : []),
            ...(activeDocument && (mode === "explain" || mode === "visualize")
              ? [activeDocument.title]
              : []),
          ],
          history: messages
            .slice(-6)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.sources?.length) {
          setMessages((current) => [
            ...current,
            {
              id: stableId("assistant"),
              role: "assistant",
              content:
                "AgentRouter no pudo completar la generación, pero la recuperación local sí encontró material relacionado. Revisa estas fuentes mientras corriges la autorización del proveedor.",
              sources: data.sources as SourceReference[],
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        throw new Error(data.error ?? "No se pudo generar la respuesta.");
      }
      const explanation = data.explanation as TeachingExplanation | undefined;
      setMessages((current) => [
        ...current,
        {
          id: stableId("assistant"),
          role: "assistant",
          prompt: userMessage.content,
          content: explanation?.simple ?? data.answer,
          explanation,
          sources: data.sources as SourceReference[],
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-view tutor-view">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Tutor fundamentado</span>
          <h1>Estudia con el material, no con suposiciones</h1>
          <p>
            Las respuestas se construyen con fragmentos recuperados de los seis
            módulos y muestran sus fuentes.
          </p>
        </div>
        <div className="tutor-trust-strip">
          <ShieldCheck size={18} />
          <span><strong>Material local</strong><small>Sin web · con fuentes</small></span>
          <button
            type="button"
            disabled={messages.length === 0 && !draftContext}
            onClick={clearConversation}
          >
            <Trash2 size={16} />
            Limpiar chat
          </button>
        </div>
      </header>
      <div className="tutor-layout">
        <section className="chat-panel">
          <Tabs.Root
            value={mode}
            onValueChange={(value) => setMode(value as StudyMode)}
          >
            <Tabs.List className="mode-tabs">
              {aiModes.map(({ id, label, icon: Icon }) => (
                <Tabs.Trigger key={id} value={id} className="mode-tab">
                  <Icon size={16} />
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
          {activeDocument && (
            <div className="tutor-active-context">
              <BookOpen size={15} />
              <span>Tema abierto:</span>
              <strong>{activeDocument.title}</strong>
            </div>
          )}
          <ScrollArea.Root className="messages-scroll">
            <ScrollArea.Viewport className="messages-viewport">
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <div className="chat-empty-icon">
                    <Bot size={28} />
                  </div>
                  <h2>¿Qué quieres trabajar?</h2>
                  <p>
                    Consulta un concepto o elige una herramienta. El tutor
                    citará los capítulos utilizados.
                  </p>
                  <div className="starter-grid">
                    {[
                      "Resume los puntos esenciales del tema actual",
                      "Explícame la diferencia entre autonomía y dependencia",
                      "Crea cinco preguntas para comprobar lo aprendido",
                      "Ayúdame a resolver un caso práctico",
                    ].map((text) => (
                      <button key={text} onClick={() => setPrompt(text)}>
                        {text}
                        <Send size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    openDocument={openDocument}
                    courseIds={globalScope === "all" ? [] : [globalScope]}
                  />
                ))
              )}
              {busy && (
                <div className="assistant-thinking">
                  <span />
                  <span />
                  <span />
                  Buscando evidencia y preparando la respuesta...
                </div>
              )}
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar className="scrollbar" orientation="vertical">
              <ScrollArea.Thumb className="scroll-thumb" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
          {error && <div className="error-banner">{error}</div>}
          <div className="composer">
            {draftContext?.selectedText && (
              <div className="composer-attachment">
                <div>
                  <span>
                    <BookOpen size={15} /> Fragmento del tema adjunto
                  </span>
                  <strong>{draftContext.documentTitle ?? "Texto seleccionado"}</strong>
                  <p>{draftContext.selectedText}</p>
                </div>
                <ToolButton
                  label="Quitar fragmento adjunto"
                  className="icon-button"
                  onClick={() => setDraftContext(null)}
                >
                  <X size={16} />
                </ToolButton>
              </div>
            )}
            <textarea
              id="tutor-prompt"
              name="tutor-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={selectedMode.placeholder}
            />
            <button
              className="send-button"
              aria-label="Enviar"
              disabled={busy || (!prompt.trim() && !draftContext?.selectedText)}
              onClick={() => void submit()}
            >
              <Send size={19} />
            </button>
            <small>
              Enter para enviar · Shift + Enter para una nueva línea
            </small>
          </div>
        </section>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  openDocument,
  courseIds,
}: {
  message: ChatMessage;
  openDocument: (id: string) => Promise<void>;
  courseIds: string[];
}) {
  return (
    <div
      className={cn(
        "message-row",
        message.role === "user" && "message-row-user",
      )}
    >
      <div className="message-avatar">
        {message.role === "user" ? "TÚ" : <Bot size={17} />}
      </div>
      <div className="message-content">
        {message.attachment && (
          <div className="message-attachment">
            <span><BookOpen size={14} /> Fragmento adjunto</span>
            <strong>{message.attachment.documentTitle ?? "Texto seleccionado"}</strong>
            <p>{message.attachment.text}</p>
          </div>
        )}
        {message.explanation ? (
          <TeachingExplanationCard
            explanation={message.explanation}
            sources={message.sources ?? []}
            originalPrompt={message.prompt ?? message.explanation.title}
            courseIds={courseIds}
            openDocument={openDocument}
            compact
          />
        ) : (
          <MarkdownView>{message.content}</MarkdownView>
        )}
        {!message.explanation && message.sources && message.sources.length > 0 && (
          <div className="source-list">
            <span>Fuentes</span>
            {message.sources.map((source, index) => (
              <button
                key={source.id}
                onClick={() => void openDocument(source.documentId)}
              >
                <strong>F{index + 1}</strong>
                <span>{source.sourceLabel}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OfficialAssessmentsView({
  assessments,
  globalScope,
  openDocument,
}: {
  assessments: OfficialAssessment[];
  globalScope: string;
  openDocument: (id: string) => Promise<void>;
}) {
  const visibleAssessments = useMemo(
    () =>
      globalScope === "all"
        ? assessments
        : assessments.filter(
            (assessment) => assessment.courseId === globalScope,
          ),
    [assessments, globalScope],
  );
  const [activeId, setActiveId] = useState(visibleAssessments[0]?.id ?? "");
  const [explanations, setExplanations] = useState<
    Record<
      string,
      { explanation: TeachingExplanation; sources: SourceReference[]; prompt: string }
    >
  >({});
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [cacheReady, setCacheReady] = useState(false);
  const active =
    visibleAssessments.find((assessment) => assessment.id === activeId) ??
    visibleAssessments[0];
  const selectedActiveId = active?.id ?? "";

  useEffect(() => {
    readPreference<
      Record<
        string,
        { explanation: TeachingExplanation; sources: SourceReference[]; prompt: string }
      >
    >("officialExplanationCache", {}).then((saved) => {
      setExplanations(saved);
      setCacheReady(true);
    });
  }, []);

  useEffect(() => {
    if (cacheReady) {
      void writePreference("officialExplanationCache", explanations);
    }
  }, [cacheReady, explanations]);

  async function explainQuestion(
    assessment: OfficialAssessment,
    questionNumber?: number,
  ) {
    const question = questionNumber
      ? assessment.questions.find((item) => item.number === questionNumber)
      : undefined;
    const key = `${assessment.id}:${questionNumber ?? "overview"}`;
    if (explanations[key]) {
      setActiveId(assessment.id);
      setError("");
      return;
    }
    setBusyKey(key);
    setError("");
    try {
      const content = question
        ? `Pregunta oficial: ${question.prompt}\nOpciones: ${(question.options ?? []).join(" | ")}\nRespuesta correcta mostrada por la plataforma: ${question.correctAnswer ?? "La plataforma no muestra una solución oficial."}`
        : `Evaluación oficial: ${assessment.title}. Contenido: ${assessment.questions
            .map((item) => item.prompt)
            .join("\n")}`;
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "explain",
          prompt: question?.correctAnswer
            ? `${content}\nExplica por qué la respuesta oficial es correcta y por qué las demás opciones no lo son. No cambies la respuesta oficial y usa solo el material local.`
            : `${content}\nOfrece una guía de resolución fundamentada en el material local. Etiquétala como orientación de estudio, no como solución oficial.` ,
          courseIds: [assessment.courseId],
          documentIds: [],
          retrievalTerms: [
            question?.prompt ?? assessment.title,
            ...(question?.options ?? []),
            ...(question?.correctAnswer ? [question.correctAnswer] : []),
          ],
          history: [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo explicar.");
      if (!data.explanation) {
        throw new Error(data.answer ?? "No se devolvió una explicación estructurada.");
      }
      setExplanations((current) => ({
        ...current,
        [key]: {
          explanation: data.explanation as TeachingExplanation,
          sources: (data.sources ?? []) as SourceReference[],
          prompt: content,
        },
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo explicar.");
    } finally {
      setBusyKey("");
    }
  }

  if (!active) {
    return (
      <div className="workspace-view official-view">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Contenido verificado</span>
            <h1>Evaluaciones oficiales</h1>
            <p>El alcance seleccionado todavía no tiene evaluaciones oficiales recuperadas.</p>
          </div>
        </header>
        <div className="official-empty-scope">
          <ClipboardCheck size={30} />
          <h2>No hay pruebas en este alcance</h2>
          <p>Cambia el alcance global a “Todos los cursos” para consultar las evaluaciones disponibles.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-view official-view">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Contenido verificado</span>
          <h1>Evaluaciones oficiales</h1>
          <p>
            Preguntas recuperadas de revisiones y entregas ya finalizadas. Esta
            sección nunca inicia intentos ni modifica el campus.
          </p>
        </div>
        <div className="official-safety-badge">
          <ShieldCheck size={18} />
          <span>Solo lectura</span>
        </div>
      </header>

      <div className="assessment-coverage-note">
        <ClipboardCheck size={18} />
        <div>
          <strong>9 evaluaciones oficiales con contenido recuperado</strong>
          <span>
            Además se detectaron 5 evaluaciones interactivas en UF0127 y
            UF0129, pero sus archivos descargados solo contienen el contenedor
            y no incluyen preguntas ni respuestas estáticas.
          </span>
        </div>
      </div>

      <div className="official-layout">
        <aside className="official-list" aria-label="Evaluaciones oficiales">
          <div className="official-list-heading">
            <strong>MF1018_2</strong>
            <span>{visibleAssessments.length} pruebas</span>
          </div>
          {visibleAssessments.map((assessment) => (
            <article
              className={cn(
                "official-list-card",
                assessment.id === selectedActiveId && "official-list-card-active",
              )}
              key={assessment.id}
            >
              <button
                className="official-list-main"
                onClick={() => setActiveId(assessment.id)}
              >
                <span className="official-kind-icon">
                  {assessment.kind === "official_quiz" ? (
                    <ClipboardCheck size={18} />
                  ) : (
                    <NotebookPen size={18} />
                  )}
                </span>
                <span>
                  <small>{assessment.scope}</small>
                  <strong>{assessment.title}</strong>
                  <em>
                    {assessment.kind === "official_quiz"
                      ? `${assessment.questions.length} preguntas con solución`
                      : "Pregunta de desarrollo"}
                  </em>
                </span>
                <ChevronRight size={17} />
              </button>
              <button
                className="official-explain-small"
                disabled={busyKey === `${assessment.id}:overview`}
                onClick={() => {
                  setActiveId(assessment.id);
                  void explainQuestion(assessment);
                }}
              >
                <Sparkles size={14} />
                {busyKey === `${assessment.id}:overview`
                  ? "Explicando…"
                  : "Explicar"}
              </button>
            </article>
          ))}
        </aside>

        <section className="official-detail">
          <div className="official-detail-header">
            <div>
              <span className="official-source-label">
                <ShieldCheck size={14} /> Oficial · {active.scope}
              </span>
              <h2>{active.title}</h2>
              <p>{active.courseTitle}</p>
            </div>
            {active.result && (
              <div className="official-result">
                <strong>
                  {active.result.score}/{active.result.maximum}
                </strong>
                <span>
                  {active.result.correct} de {active.result.total} correctas
                </span>
              </div>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}
          {explanations[`${active.id}:overview`] && (
            <div className="official-overview-explanation">
              <TeachingExplanationCard
                explanation={explanations[`${active.id}:overview`].explanation}
                sources={explanations[`${active.id}:overview`].sources}
                originalPrompt={explanations[`${active.id}:overview`].prompt}
                courseIds={[active.courseId]}
                openDocument={openDocument}
              />
            </div>
          )}

          <div className="official-question-list">
            {active.questions.map((question) => {
              const key = `${active.id}:${question.number}`;
              return (
                <article className="official-question-card" key={key}>
                  <header>
                    <span>Pregunta {question.number}</span>
                    <button
                      disabled={busyKey === key}
                      onClick={() =>
                        void explainQuestion(active, question.number)
                      }
                    >
                      <Sparkles size={15} />
                      {busyKey === key ? "Explicando…" : "Explicar respuesta"}
                    </button>
                  </header>
                  <h3>{question.prompt}</h3>
                  {question.options?.length ? (
                    <ol className="official-option-list" type="a">
                      {question.options.map((option) => (
                        <li
                          className={cn(
                            option === question.correctAnswer &&
                              "official-option-correct",
                          )}
                          key={option}
                        >
                          <span>{option}</span>
                          {option === question.correctAnswer && (
                            <strong>
                              <Check size={14} /> Correcta
                            </strong>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="official-development-note">
                      <NotebookPen size={17} />
                      <span>
                        La plataforma no muestra una solución oficial. La IA
                        ofrecerá solo una orientación fundamentada.
                      </span>
                    </div>
                  )}
                  {explanations[key] && (
                    <div className="official-question-explanation">
                      <TeachingExplanationCard
                        explanation={explanations[key].explanation}
                        sources={explanations[key].sources}
                        originalPrompt={explanations[key].prompt}
                        courseIds={[active.courseId]}
                        openDocument={openDocument}
                        compact
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function ExamView({
  catalog,
  openDocument,
  globalScope,
}: {
  catalog: Catalog;
  openDocument: (id: string) => Promise<void>;
  globalScope: string;
}) {
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState("intermediate");
  const [exam, setExam] = useState<GeneratedExam | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState("");
  const [sources, setSources] = useState<SourceReference[]>([]);
  const [busy, setBusy] = useState(false);
  const [gradingBusy, setGradingBusy] = useState(false);
  const [error, setError] = useState("");
  const [examHistory, setExamHistory] = useState<SavedExam[]>([]);
  const [activeExamId, setActiveExamId] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyCourse, setHistoryCourse] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyToolsOpen, setHistoryToolsOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      readPreference<SavedExam[]>("examHistory", []),
      readPreference<GeneratedExam | null>("lastExam", null),
      readPreference<Record<string, string>>("lastExamAnswers", {}),
    ]).then(([savedHistory, legacyExam, legacyAnswers]) => {
      let nextHistory = savedHistory;
      if (!nextHistory.length && legacyExam) {
        const timestamp = new Date().toISOString();
        nextHistory = [
          {
            id: stableId("exam-migrated"),
            exam: legacyExam,
            courseId: "all",
            difficulty: "intermediate",
            requestedQuestionCount: legacyExam.questions.length,
            answers: legacyAnswers,
            sources: [],
            grading: "",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ];
      }
      setExamHistory(nextHistory);
      const latest = nextHistory[0];
      if (latest) {
        setActiveExamId(latest.id);
        setExam(latest.exam);
        setAnswers(latest.answers);
        setGrading(latest.grading);
        setSources(latest.sources);
        setDifficulty(latest.difficulty);
        setCount(latest.requestedQuestionCount);
      }
      setHistoryReady(true);
    });
  }, []);

  useEffect(() => {
    if (historyReady) void writePreference("examHistory", examHistory);
  }, [examHistory, historyReady]);

  const filteredExamHistory = useMemo(() => {
    const normalized = historyQuery.trim().toLocaleLowerCase("es");
    return examHistory.filter((item) => {
      const matchesText =
        !normalized ||
        `${item.exam.title} ${item.exam.instructions}`
          .toLocaleLowerCase("es")
          .includes(normalized);
      const matchesCourse =
        historyCourse === "all" || item.courseId === historyCourse;
      const matchesStatus =
        historyStatus === "all" ||
        (historyStatus === "graded" && Boolean(item.grading)) ||
        (historyStatus === "pending" && !item.grading);
      return matchesText && matchesCourse && matchesStatus;
    });
  }, [examHistory, historyCourse, historyQuery, historyStatus]);

  function openSavedExam(saved: SavedExam) {
    setActiveExamId(saved.id);
    setExam(saved.exam);
    setAnswers(saved.answers);
    setGrading(saved.grading);
    setSources(saved.sources);
    setDifficulty(saved.difficulty);
    setCount(saved.requestedQuestionCount);
    setError("");
  }

  function updateAnswers(nextAnswers: Record<string, string>) {
    setAnswers(nextAnswers);
    if (!activeExamId) return;
    const updatedAt = new Date().toISOString();
    setExamHistory((current) =>
      current.map((item) =>
        item.id === activeExamId
          ? { ...item, answers: nextAnswers, updatedAt }
          : item,
      ),
    );
  }

  async function generate() {
    setBusy(true);
    setError("");
    setGrading("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "exam",
          prompt: `Genera un examen equilibrado sobre el alcance seleccionado. Incluye preguntas de aplicación y no solo memorización. Si el alcance incluye todos los cursos, distribuye las preguntas entre ellos. En sourceIds usa exclusivamente identificadores exactos de las fuentes recibidas.`,
          courseIds: globalScope === "all" ? [] : [globalScope],
          documentIds: [],
          history: [],
          examOptions: {
            questionCount: count,
            difficulty,
            includeMultipleChoice: true,
            includeShortAnswer: true,
            includeEssay: true,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!data.exam)
        throw new Error(
          data.answer ?? "El proveedor no devolvió un examen estructurado.",
        );
      const generatedExam = data.exam as GeneratedExam;
      const timestamp = new Date().toISOString();
      const savedExam: SavedExam = {
        id: stableId("exam"),
        exam: generatedExam,
        courseId: globalScope,
        difficulty: difficulty as SavedExam["difficulty"],
        requestedQuestionCount: count,
        answers: {},
        sources: data.sources ?? [],
        grading: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setExamHistory((current) => [savedExam, ...current]);
      setActiveExamId(savedExam.id);
      setExam(generatedExam);
      setAnswers({});
      setSources(data.sources ?? []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo generar el examen.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function gradeExam() {
    if (!exam) return;
    setGradingBusy(true);
    setError("");
    const submission = exam.questions.map((question, index) => ({
      number: index + 1,
      type: question.type,
      prompt: question.prompt,
      expectedAnswer: question.answer,
      rationale: question.rationale,
      rubric: question.rubric,
      studentAnswer: answers[question.id] ?? "[Sin respuesta]",
    }));
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "grade",
          prompt: `Evalúa este examen completo. Da una nota global de 0 a 10 y una valoración por pregunta. Penaliza las omisiones, distingue errores conceptuales de redacción y ofrece una respuesta modelo mejorada.\n\n${JSON.stringify(submission)}`,
          courseIds: globalScope === "all" ? [] : [globalScope],
          documentIds: [],
          history: [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setGrading(data.answer);
      setSources(data.sources ?? sources);
      const structuredGrading = parseStructuredGrading(String(data.answer));
      const scoreMatch = String(data.answer).match(
        /(?:nota|calificaciÃ³n)(?:\s+global)?[^0-9]{0,20}(10|[0-9](?:[.,][0-9]+)?)/i,
      );
      const score = structuredGrading?.nota_global ?? (scoreMatch
        ? Number(scoreMatch[1].replace(",", "."))
        : undefined);
      const gradedAt = new Date().toISOString();
      setExamHistory((current) =>
        current.map((item) =>
          item.id === activeExamId
            ? {
                ...item,
                answers,
                grading: data.answer,
                sources: data.sources ?? sources,
                score,
                gradedAt,
                updatedAt: gradedAt,
              }
            : item,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo calificar el examen.",
      );
    } finally {
      setGradingBusy(false);
    }
  }
  return (
    <div className="workspace-view">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Simulador</span>
          <h1>Practica y recibe explicaciones</h1>
          <p>
            Genera pruebas mixtas de uno o de todos los cursos, o usa Resolver y
            Calificar para ejercicios propios.
          </p>
        </div>
      </header>
      <div className="exam-layout">
        <aside className="exam-sidebar">
          <section className="exam-settings">
          <h2>
            <Settings2 size={18} />
            Configurar examen
          </h2>
          <div className="exam-scope-summary">
            <span>Alcance actual</span>
            <strong>
              {catalog.courses.find((course) => course.id === globalScope)
                ?.title ?? "Todos los cursos"}
            </strong>
            <small>Se cambia desde la barra superior y se aplica a toda la app.</small>
          </div>
          <label>
            Número de preguntas
            <div className="stepper">
              <button
                type="button"
                aria-label="Reducir número de preguntas"
                onClick={() => setCount(Math.max(3, count - 1))}
              >
                −
              </button>
              <span>{count}</span>
              <button
                type="button"
                aria-label="Aumentar número de preguntas"
                onClick={() => setCount(Math.min(20, count + 1))}
              >
                +
              </button>
            </div>
          </label>
          <label>
            Dificultad
            <select
              id="exam-difficulty"
              name="exam-difficulty"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
            >
              <option value="basic">Básica</option>
              <option value="intermediate">Intermedia</option>
              <option value="advanced">Avanzada</option>
            </select>
          </label>
          <div className="question-types">
            <span>Tipos incluidos</span>
            <p>
              <Check size={15} />
              Opción múltiple
            </p>
            <p>
              <Check size={15} />
              Respuesta corta
            </p>
            <p>
              <Check size={15} />
              Desarrollo y casos
            </p>
          </div>
          <button
            className="button button-primary button-full"
            disabled={busy}
            onClick={() => void generate()}
          >
            <Sparkles size={17} />
            {busy
              ? "Generando..."
              : exam
                ? "Generar otro examen"
                : "Generar examen"}
          </button>
          </section>

          <section className="exam-history-panel">
            <div className="exam-history-heading">
              <div>
                <span className="eyebrow">Guardados</span>
                <h2>Historial de exámenes</h2>
              </div>
              <ToolButton
                label="Buscar y filtrar exámenes"
                className={cn(
                  "icon-button",
                  historyToolsOpen && "icon-button-active",
                )}
                onClick={() => setHistoryToolsOpen(!historyToolsOpen)}
              >
                {historyToolsOpen ? <X size={18} /> : <Settings2 size={18} />}
              </ToolButton>
            </div>
            {historyToolsOpen && (
              <div className="exam-history-tools">
                <label className="exam-history-search">
                  <Search size={16} />
                  <input
                    id="exam-history-search"
                    name="exam-history-search"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder="Buscar examen..."
                  />
                </label>
                <label>
                  Curso
                  <select
                    id="exam-history-course"
                    name="exam-history-course"
                    value={historyCourse}
                    onChange={(event) => setHistoryCourse(event.target.value)}
                  >
                    <option value="all">Todos</option>
                    {catalog.courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Estado
                  <select
                    id="exam-history-status"
                    name="exam-history-status"
                    value={historyStatus}
                    onChange={(event) => setHistoryStatus(event.target.value)}
                  >
                    <option value="all">Todos</option>
                    <option value="graded">Calificados</option>
                    <option value="pending">Sin calificar</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="exam-history-clear-filters"
                  disabled={
                    !historyQuery &&
                    historyCourse === "all" &&
                    historyStatus === "all"
                  }
                  onClick={() => {
                    setHistoryQuery("");
                    setHistoryCourse("all");
                    setHistoryStatus("all");
                  }}
                >
                  <X size={14} />
                  Limpiar filtros
                </button>
              </div>
            )}
            <div className="exam-history-list">
              {filteredExamHistory.length ? (
                filteredExamHistory.map((saved) => (
                  <button
                    key={saved.id}
                    className={cn(
                      "exam-history-item",
                      saved.id === activeExamId && "exam-history-item-active",
                    )}
                    onClick={() => openSavedExam(saved)}
                  >
                    <span>
                      <strong>{saved.exam.title}</strong>
                      <small>
                        {new Intl.DateTimeFormat("es", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(saved.createdAt))}
                      </small>
                    </span>
                    <em>{saved.grading ? `${saved.score ?? "—"}/10` : "Pendiente"}</em>
                  </button>
                ))
              ) : (
                <div className="empty-small">
                  <FileQuestion size={22} />
                  <p>No hay exámenes que coincidan con los filtros.</p>
                </div>
              )}
            </div>
          </section>
        </aside>
        <section className="exam-output">
          {error && <div className="error-banner">{error}</div>}
          {exam ? (
            <ScrollArea.Root className="exam-scroll">
              <ScrollArea.Viewport className="exam-viewport">
                <div className="exam-title">
                  <span className="eyebrow">Examen activo</span>
                  <h2>{exam.title}</h2>
                  <p>{exam.instructions}</p>
                </div>
                <div className="question-list">
                  {exam.questions.map((question, index) => (
                    <ExamQuestionCard
                      key={question.id}
                      number={index + 1}
                      question={question}
                      value={answers[question.id] ?? ""}
                      onChange={(value) =>
                        updateAnswers({ ...answers, [question.id]: value })
                      }
                    />
                  ))}
                </div>
                <button
                  className="button button-primary grade-button"
                  disabled={gradingBusy}
                  onClick={() => void gradeExam()}
                >
                  <ClipboardCheck size={17} />
                  {gradingBusy ? "Calificando..." : "Calificar mis respuestas"}
                </button>
                {grading && (
                  <div className="grading-result">
                    <span className="eyebrow">Retroalimentación</span>
                    <GradingFeedback value={grading} />
                  </div>
                )}
                {sources.length > 0 && (
                  <div className="source-list">
                    <span>Material utilizado</span>
                    {sources.map((source, index) => (
                      <button
                        key={source.id}
                        onClick={() => void openDocument(source.documentId)}
                      >
                        <strong>F{index + 1}</strong>
                        <span>{source.sourceLabel}</span>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea.Viewport>
            </ScrollArea.Root>
          ) : (
            <div className="exam-empty">
              <FileQuestion size={34} />
              <h2>Tu examen aparecerá aquí</h2>
              <p>
                Las preguntas y soluciones estarán fundamentadas en el curso
                seleccionado.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ExamQuestionCard({
  number,
  question,
  value,
  onChange,
}: {
  number: number;
  question: GeneratedExam["questions"][number];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="question-card">
      <legend>
        <span>{number}</span>
        {question.type === "multiple_choice"
          ? "Opción múltiple"
          : question.type === "short_answer"
            ? "Respuesta corta"
            : "Desarrollo"}
      </legend>
      <h3>{question.prompt}</h3>
      {question.type === "multiple_choice" && question.options?.length ? (
        <div className="option-list">
          {question.options.map((option) => (
            <label
              key={option}
              className={cn(
                "option-row",
                value === option && "option-row-selected",
              )}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === option}
                onChange={() => onChange(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          id={`exam-answer-${question.id}`}
          name={`exam-answer-${question.id}`}
          className="answer-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            question.type === "essay"
              ? "Desarrolla tu respuesta y justifica tus decisiones..."
              : "Escribe una respuesta breve y precisa..."
          }
        />
      )}
    </fieldset>
  );
}

function ProgressView({
  catalog,
  completed,
  bookmarks,
  openDocument,
  globalScope,
}: {
  catalog: Catalog;
  completed: string[];
  bookmarks: string[];
  openDocument: (id: string) => Promise<void>;
  globalScope: string;
}) {
  const [examHistory, setExamHistory] = useState<SavedExam[]>([]);

  useEffect(() => {
    readPreference<SavedExam[]>("examHistory", []).then(setExamHistory);
  }, []);

  const scopedCourses =
    globalScope === "all"
      ? catalog.courses
      : catalog.courses.filter((course) => course.id === globalScope);
  const courseProgress = scopedCourses.map((course, index) => ({
    ...course,
    index,
    done: course.documents.filter((document) => completed.includes(document.id))
      .length,
  }));
  const bookmarkedDocs = scopedCourses
    .flatMap((course) =>
      course.documents.map((document) => ({
        ...document,
        courseTitle: course.title,
      })),
    )
    .filter((document) => bookmarks.includes(document.id));
  const gradedExams = examHistory.filter(
    (item) =>
      (globalScope === "all" || item.courseId === globalScope) &&
      item.grading &&
      typeof item.score === "number",
  );
  const scopedExamHistory = examHistory.filter(
    (item) => globalScope === "all" || item.courseId === globalScope,
  );
  const averageScore = gradedExams.length
    ? gradedExams.reduce((sum, item) => sum + (item.score ?? 0), 0) /
      gradedExams.length
    : 0;
  const bestScore = gradedExams.length
    ? Math.max(...gradedExams.map((item) => item.score ?? 0))
    : 0;
  const dailyExamStats = scopedExamHistory.length
    ? Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - (6 - index));
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const items = scopedExamHistory.filter((item) => {
          const createdAt = new Date(item.createdAt);
          return createdAt >= date && createdAt < nextDate;
        });
        const scored = items.filter((item) => typeof item.score === "number");
        return {
          label: new Intl.DateTimeFormat("es", { weekday: "short" }).format(
            date,
          ),
          dateLabel: new Intl.DateTimeFormat("es", {
            day: "numeric",
            month: "short",
          }).format(date),
          generated: items.length,
          average: scored.length
            ? scored.reduce((sum, item) => sum + (item.score ?? 0), 0) /
              scored.length
            : 0,
        };
      })
    : [];
  const maxGenerated = Math.max(
    1,
    ...dailyExamStats.map((day) => day.generated),
  );
  return (
    <div className="workspace-view">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Tu avance</span>
          <h1>Progreso y temas guardados</h1>
          <p>Los datos se conservan en IndexedDB dentro de este navegador.</p>
        </div>
      </header>
      <div className="stats-row">
        <div>
          <Library size={20} />
          <span>Cursos</span>
            <strong>{scopedCourses.length}</strong>
        </div>
        <div>
          <CheckCircle2 size={20} />
          <span>Temas leídos</span>
          <strong>{completed.length}</strong>
        </div>
        <div>
          <Bookmark size={20} />
          <span>Favoritos</span>
          <strong>{bookmarks.length}</strong>
        </div>
        <div>
          <Target size={20} />
          <span>Avance total</span>
          <strong>
            {Math.round(
              (completed.length / Math.max(catalog.stats.documents, 1)) * 100,
            )}
            %
          </strong>
        </div>
      </div>
      <div className="progress-grid">
        <section className="progress-section">
          <h2>Avance por curso</h2>
          {courseProgress.map((course) => {
            const percentage = Math.round(
              (course.done / Math.max(course.documentCount, 1)) * 100,
            );
            return (
              <div className="course-progress-row" key={course.id}>
                <div
                  className={`course-swatch accent-${courseAccents[course.index % courseAccents.length]}`}
                >
                  <BookOpen size={18} />
                </div>
                <div>
                  <strong>{course.title}</strong>
                  <span>
                    {course.done} de {course.documentCount} temas
                  </span>
                  <div className="progress-track">
                    <i style={{ width: `${percentage}%` }} />
                  </div>
                </div>
                <b>{percentage}%</b>
              </div>
            );
          })}
        </section>
        <section className="progress-section">
          <h2>Favoritos</h2>
          {bookmarkedDocs.length ? (
            bookmarkedDocs.map((document) => (
              <button
                className="favorite-row"
                key={document.id}
                onClick={() => void openDocument(document.id)}
              >
                <Bookmark size={16} />
                <span>
                  <strong>{document.title}</strong>
                  <small>{document.courseTitle}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="empty-small">
              <Bookmark size={24} />
              <p>Guarda temas desde el lector para encontrarlos aquí.</p>
            </div>
          )}
        </section>
      </div>
      <section className="progress-section exam-analytics">
        <div className="analytics-heading">
          <div>
            <span className="eyebrow">Práctica</span>
            <h2>Rendimiento en exámenes generados</h2>
          </div>
          <span>Últimos 7 días</span>
        </div>
        <div className="exam-stats-grid">
          <div>
            <span>Generados</span>
            <strong>{scopedExamHistory.length}</strong>
          </div>
          <div>
            <span>Calificados</span>
            <strong>{gradedExams.length}</strong>
          </div>
          <div>
            <span>Nota media</span>
            <strong>{gradedExams.length ? averageScore.toFixed(1) : "—"}</strong>
          </div>
          <div>
            <span>Mejor nota</span>
            <strong>{gradedExams.length ? bestScore.toFixed(1) : "—"}</strong>
          </div>
        </div>
        {dailyExamStats.length ? (
          <div
            className="exam-chart"
            role="img"
            aria-label="Exámenes generados y nota media durante los últimos siete días"
          >
            <div className="chart-legend">
              <span><i className="legend-generated" /> Exámenes</span>
              <span><i className="legend-score" /> Nota media</span>
            </div>
            <div className="chart-bars">
              {dailyExamStats.map((day) => (
                <div className="chart-day" key={day.dateLabel}>
                  <div className="chart-values">
                    <div
                      className="chart-bar chart-bar-generated"
                      style={{
                        height: `${Math.max(
                          day.generated ? 12 : 0,
                          (day.generated / maxGenerated) * 100,
                        )}%`,
                      }}
                      title={`${day.dateLabel}: ${day.generated} exámenes`}
                    />
                    <div
                      className="chart-bar chart-bar-score"
                      style={{ height: `${day.average * 10}%` }}
                      title={`${day.dateLabel}: nota media ${day.average.toFixed(1)}`}
                    />
                  </div>
                  <strong>{day.generated || "–"}</strong>
                  <span>{day.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-small analytics-empty">
            <FileQuestion size={24} />
            <p>Genera tu primer examen para empezar a ver estadísticas.</p>
          </div>
        )}
      </section>
    </div>
  );
}
