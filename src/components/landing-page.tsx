import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  Download,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const features = [
  {
    icon: BookOpenCheck,
    title: "Todo el material ordenado",
    copy: "Lee por módulo y unidad, guarda favoritos, escribe notas y continúa donde lo dejaste.",
  },
  {
    icon: Bot,
    title: "Tutor con fuentes",
    copy: "Pregunta, resume o pide una explicación. Cada respuesta se apoya en el contenido recuperado.",
  },
  {
    icon: BarChart3,
    title: "Práctica que deja huella",
    copy: "Conserva exámenes, respuestas, calificaciones y una vista clara de tu evolución diaria.",
  },
];

export function LandingPage() {
  return (
    <main className="landing-page" id="main-content">
      <header className="landing-nav">
        <Link className="landing-brand" href="/" aria-label="Temaria, inicio">
          <span className="brand-mark"><Sparkles size={20} /></span>
          <span><strong>Temaria</strong><small>Estudio SSCS0208</small></span>
        </Link>
        <Link className="button button-secondary" href="/login?next=/aula">
          Entrar
          <ArrowRight size={17} />
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-kicker"><ShieldCheck size={16} /> Aprendizaje privado y fundamentado</span>
          <h1>Estudiar el curso puede sentirse mucho más claro.</h1>
          <p>
            Temaria convierte los materiales SSCS0208 en una experiencia de
            estudio organizada: lectura, evaluaciones, práctica y una IA que
            explica sin inventar ni navegar por Internet.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary landing-primary" href="/login?next=/aula">
              Entrar al aula
              <ArrowRight size={18} />
            </Link>
            <a className="landing-text-link" href="#como-funciona">Ver cómo ayuda</a>
          </div>
          <ul className="landing-proof" aria-label="Características principales">
            <li><CheckCircle2 size={17} /> Fuentes visibles</li>
            <li><CheckCircle2 size={17} /> Progreso local</li>
            <li><CheckCircle2 size={17} /> Instalable en iPhone</li>
          </ul>
        </div>

        <div className="landing-preview" aria-label="Vista resumida de la plataforma">
          <div className="preview-top"><span /><span /><span /><strong>Temaria</strong></div>
          <div className="preview-body">
            <aside>
              <span className="preview-active" />
              <span />
              <span />
              <span />
            </aside>
            <section>
              <div className="preview-heading"><span /><span /></div>
              <div className="preview-question">
                <Bot size={20} />
                <div><strong>Explicación sencilla</strong><span /></div>
              </div>
              <div className="preview-source"><ShieldCheck size={15} /> Respuesta apoyada en el material</div>
              <div className="preview-bars"><span /><span /><span /><span /></div>
            </section>
          </div>
        </div>
      </section>

      <section className="landing-section" id="como-funciona">
        <div className="landing-section-heading">
          <span className="eyebrow">Un espacio para aprender</span>
          <h2>Menos tiempo buscando. Más tiempo comprendiendo.</h2>
          <p>Cada herramienta comparte el mismo alcance de estudio y conserva el trabajo en el dispositivo.</p>
        </div>
        <div className="landing-feature-grid">
          {features.map(({ icon: Icon, title, copy }) => (
            <article key={title}>
              <span><Icon size={21} /></span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-install">
        <span className="landing-install-icon"><Download size={24} /></span>
        <div>
          <span className="eyebrow">También como app</span>
          <h2>Instálala en la pantalla de inicio del iPhone.</h2>
          <p>Abre la web en Safari, pulsa Compartir y elige “Añadir a pantalla de inicio”. La sesión se recuerda durante 20 días.</p>
        </div>
        <Link className="button button-primary" href="/login?next=/aula">Comenzar <ArrowRight size={17} /></Link>
      </section>

      <footer className="landing-footer">
        <span>Temaria · Estudio SSCS0208</span>
        <span>Contenido privado · Sin acciones en el campus oficial</span>
      </footer>
    </main>
  );
}
