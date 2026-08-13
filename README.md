# Temaria

Temaria es una aplicación privada de estudio para el certificado SSCS0208. Está construida con Next.js 16, React 19 y TypeScript, organiza el material descargado en una biblioteca local y ofrece herramientas de aprendizaje fundamentadas exclusivamente en ese contenido.

La aplicación no navega por Internet para responder dudas y nunca ejecuta acciones en el campus oficial. Las URL oficiales conservadas en los datos son solo metadatos de procedencia.

## Funciones

- Biblioteca global de cursos, unidades y documentos.
- Lector accesible con índice de secciones, progreso de lectura, navegación anterior/siguiente, volver arriba, favoritos y notas.
- Selección de texto para explicarlo o adjuntarlo al chat sin copiar un bloque enorme en el mensaje.
- Tutor IA para consultar, resumir, explicar, visualizar, resolver y calificar.
- Explicaciones simple y detallada, ideas clave, pregunta de comprobación y revisión de objeciones del estudiante.
- Mapas conceptuales, mapas mentales, flujos, líneas de tiempo, comparaciones y gráficos de barras renderizados como componentes visuales reales.
- Caché local de explicaciones oficiales para no repetir llamadas cuando la pregunta es la misma.
- Nueve evaluaciones oficiales recuperadas de intentos ya terminados.
- Aviso explícito para cinco evaluaciones interactivas detectadas cuyos archivos descargados no contienen preguntas ni respuestas recuperables.
- Simulador de exámenes de uno o todos los cursos, con opción múltiple, respuesta corta y desarrollo.
- Historial persistente de exámenes, respuestas, fuentes, calificaciones, filtros y analíticas diarias.
- Progreso, favoritos, notas, chat, revisiones y exámenes guardados en IndexedDB.
- Tema claro y oscuro.
- PWA instalable, incluida la instalación desde Safari en iPhone.
- Acceso por contraseña con sesión HTTP-only de 20 días.
- Restablecimiento completo de los datos locales con confirmación.

## Arquitectura

```text
src/app/                    App Router, páginas, autenticación y API
src/components/             biblioteca, lector, tutor, evaluaciones y simulador
src/lib/corpus.ts           recuperación léxica y ranking de fragmentos
src/lib/agentrouter.ts      cliente compatible con Responses API
src/lib/client-db.ts        persistencia local mediante IndexedDB
src/lib/official-assessments.ts  carga opcional de evaluaciones privadas
scripts/generate-corpus.mjs procesamiento de módulos Markdown
public/                     iconos, manifest y service worker de la PWA
```

## RAG local

1. El cliente envía la pregunta, el alcance global, documentos ancla y términos de recuperación.
2. El recuperador normaliza la consulta, pondera términos poco frecuentes y prioriza opciones, respuestas oficiales o texto seleccionado.
3. Solo los fragmentos mejor clasificados se envían al modelo.
4. El modelo debe responder con citas `[F1]`, `[F2]`, etc.
5. Si la evidencia recuperada no basta, debe reconocerlo sin completar lagunas con conocimiento externo.
6. Las fuentes pueden abrirse desde la respuesta para contrastar el material original.

El modo `Visualizar` exige una representación estructurada. Los diagramas se dibujan en la interfaz; el código Mermaid antiguo también se transforma cuando usa `flowchart`, `graph` o `mindmap`.

## Datos privados y repositorio público

El repositorio puede ser público, pero el material del curso no debe publicarse. `.gitignore` excluye:

- `src/data/corpus.json`;
- `src/data/official-assessments.json`;
- `src/data/official-assessments/`;
- carpetas de contenido descargado, credenciales y archivos `.env`.

Sin esos archivos la aplicación compila con un catálogo vacío y sin evaluaciones oficiales. En un despliegue real deben generarse o inyectarse durante el build desde una fuente privada autorizada.

## Variables de entorno

Copia `.env.example` a `.env.local`:

```env
SITE_PASSWORD=una-contrasena-larga
AUTH_SECRET=un-secreto-aleatorio-de-al-menos-32-caracteres

AGENTROUTER_API_KEY=tu-clave
AGENTROUTER_BASE_URL=https://agentrouter.org/v1
AGENTROUTER_MODEL=gpt-5.6-sol
AGENTROUTER_USER_AGENT=codex_cli_rs/0.114.0

# Carpeta privada que contiene los módulos MF/UF.
COURSE_CONTENT_ROOT=C:\ruta\a\los\cursos
```

La contraseña nunca se guarda en el navegador. Tras validarla, el servidor emite una cookie HTTP-only, `SameSite=Lax`, segura en producción y válida durante 20 días.

## Desarrollo

```bash
npm install
npm run dev
```

Antes de desarrollo y producción se genera el corpus automáticamente. Comprobaciones finales:

```bash
npm run lint
npm run build
```

## Añadir un módulo o unidad

El importador busca carpetas cuyo nombre comience por `MF` o `UF` dentro de `COURSE_CONTENT_ROOT`.

```text
COURSE_CONTENT_ROOT/
  MF0000_NuevoModulo/
    markdown/
      README.md
      unidad-01/
        01-tema.md
        02-otro-tema.md
```

Proceso recomendado:

1. Obtener el contenido solo mediante navegación de lectura.
2. Nunca iniciar intentos, enviar respuestas, editar entregas o modificar el progreso oficial.
3. Convertir cada página a Markdown UTF-8 y conservar títulos y jerarquía.
4. Guardar los documentos bajo `markdown/`.
5. Ejecutar `npm run generate:corpus`.
6. Revisar el conteo de cursos, documentos y fragmentos.
7. Probar recuperación, citas, listas, tablas, diagramas y caracteres españoles.
8. Ejecutar lint y build.

Para evaluaciones oficiales, coloca los JSON privados en `src/data/official-assessments.json` o `src/data/official-assessments/*.json`. Solo se admiten revisiones ya completadas o entregas ya realizadas; Temaria no debe automatizar intentos nuevos.

## Persistencia local

IndexedDB guarda el alcance global, temas completados, favoritos, notas, último documento, conversación, fragmentos adjuntos, historial de exámenes, respuestas, notas, explicaciones oficiales en caché y revisiones de explicaciones.

“Restablecer datos” elimina esta información únicamente del navegador actual. No afecta al campus oficial.

## Producción

Antes de desplegar:

- configura las variables de entorno en el proveedor;
- inyecta el contenido privado durante el build sin incluirlo en Git;
- ejecuta lint y build;
- prueba autenticación, biblioteca, tutor, evaluaciones, simulador y progreso;
- revisa claro/oscuro y 375, 768, 1024 y 1440 px;
- prueba AgentRouter desde el entorno final;
- usa HTTPS y secretos distintos a desarrollo.

El proyecto produce una salida `standalone`. La configuración recomendada está en `render.yaml` y ejecuta Temaria como un servicio Node persistente en Render.

### Despliegue recomendado en Render

1. Crea un Blueprint desde este repositorio y aplica `render.yaml`.
2. Configura `SITE_PASSWORD` y `AGENTROUTER_API_KEY` en el panel; `AUTH_SECRET` se genera automáticamente.
3. Genera una clave aleatoria de 32 bytes, guárdala como `TEMARIA_DATA_KEY` y ejecuta `npm run encrypt:data`.
4. El repositorio contiene únicamente `private-data/*.enc`, cifrados con AES-256-GCM. El material original continúa ignorado por Git.
5. Configura la misma `TEMARIA_DATA_KEY` en Render. La aplicación valida y descifra los archivos únicamente en memoria.
6. Despliega y comprueba `/api/health`. Debe indicar autenticación, IA, corpus y evaluaciones configuradas.

El build usa `npm ci --include=dev` porque Tailwind y PostCSS son dependencias de compilación aunque el servicio se ejecute con `NODE_ENV=production`.

La llamada a AgentRouter se corta de forma controlada antes del límite de la petición y devuelve un error reintentable sin perder el progreso local. El plan gratuito de Render puede suspender el servicio por inactividad, por lo que la primera carga puede tardar; un plan de pago elimina ese arranque en frío. Si en el futuro una generación necesita varios minutos, debe convertirse en un trabajo asíncrono persistente con estado y reintentos, no en una petición HTTP indefinida.
