import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const contentRoot = path.resolve(
  process.env.COURSE_CONTENT_ROOT ?? path.join(appRoot, ".."),
);
const outputPath = path.join(appRoot, "src", "data", "corpus.json");
const coursePattern = /^(MF|UF)\d{4}/;
const maxChunkLength = 2_400;
const knownCourseTitles = {
  MF1017_HigienicoAlimentaria:
    "Intervención en la atención higiénico-alimentaria en instituciones",
  MF1018_AtencionSociosanitaria:
    "Intervención en la atención sociosanitaria en instituciones",
};

function cleanMarkdown(markdown) {
  return markdown
    .replace(/^\*\*Fuente:\*\*.*$/gim, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstHeading(markdown, fallback) {
  return (
    markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    fallback.replace(/[-_]/g, " ")
  );
}

function splitLongText(text) {
  if (text.length <= maxChunkLength) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChunkLength) {
      chunks.push(current.trim());
      current = "";
    }

    if (paragraph.length > maxChunkLength) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (current && current.length + sentence.length + 1 > maxChunkLength) {
          chunks.push(current.trim());
          current = "";
        }
        current += `${current ? " " : ""}${sentence}`;
      }
    } else {
      current += `${current ? "\n\n" : ""}${paragraph}`;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function chunkDocument(document, courseTitle) {
  const sections = document.markdown.split(/(?=^#{2,3}\s+)/m);
  const chunks = [];

  sections.forEach((section, sectionIndex) => {
    const heading = section.match(/^#{2,3}\s+(.+)$/m)?.[1]?.trim();
    splitLongText(section.trim()).forEach((text, partIndex) => {
      if (text.length < 60) return;
      chunks.push({
        id: `${document.id}#${sectionIndex + 1}.${partIndex + 1}`,
        courseId: document.courseId,
        documentId: document.id,
        courseTitle,
        documentTitle: document.title,
        sectionTitle: heading ?? document.title,
        sourceLabel: `${courseTitle} > ${document.title}${heading ? ` > ${heading}` : ""}`,
        text,
      });
    });
  });

  return chunks;
}

async function buildCorpus() {
  let entries = [];
  try {
    entries = await readdir(contentRoot, { withFileTypes: true });
  } catch {
    console.warn(
      `Course content was not found at ${contentRoot}. An empty private corpus will be generated.`,
    );
  }
  const courses = [];
  const allChunks = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !coursePattern.test(entry.name)) continue;

    const markdownRoot = path.join(contentRoot, entry.name, "markdown");
    let markdownEntries;
    try {
      markdownEntries = await readdir(markdownRoot, {
        recursive: true,
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    const readmePath = path.join(markdownRoot, "README.md");
    let courseTitle =
      knownCourseTitles[entry.name] ?? entry.name.replace(/_/g, " ");
    try {
      const readmeTitle = firstHeading(await readFile(readmePath, "utf8"), courseTitle);
      if (readmeTitle !== "Curso") courseTitle = readmeTitle;
    } catch {
      // The folder name is a stable fallback.
    }

    const documents = [];
    for (const item of markdownEntries) {
      if (!item.isFile() || !item.name.endsWith(".md") || item.name === "README.md") {
        continue;
      }

      const fullPath = path.join(item.parentPath, item.name);
      const relativePath = path.relative(markdownRoot, fullPath).replaceAll("\\", "/");
      const markdown = cleanMarkdown(await readFile(fullPath, "utf8"));
      const id = `${entry.name}:${relativePath}`;
      const unit = relativePath.split("/")[0] || "general";
      const document = {
        id,
        courseId: entry.name,
        unit,
        path: relativePath,
        title: firstHeading(markdown, path.basename(item.name, ".md")),
        markdown,
        wordCount: markdown.split(/\s+/).filter(Boolean).length,
      };

      documents.push(document);
      allChunks.push(...chunkDocument(document, courseTitle));
    }

    documents.sort((a, b) => a.path.localeCompare(b.path, "es"));
    courses.push({
      id: entry.name,
      title: courseTitle,
      shortTitle: courseTitle.replace(/^(Apoyo|Intervención) en (la |el )?/i, ""),
      documents,
      documentCount: documents.length,
      wordCount: documents.reduce((sum, document) => sum + document.wordCount, 0),
    });
  }

  const corpus = {
    version: new Date().toISOString(),
    stats: {
      courses: courses.length,
      documents: courses.reduce((sum, course) => sum + course.documentCount, 0),
      chunks: allChunks.length,
      words: courses.reduce((sum, course) => sum + course.wordCount, 0),
    },
    courses,
    chunks: allChunks,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(corpus)}\n`, "utf8");
  console.log(
    `Corpus generated: ${corpus.stats.courses} courses, ${corpus.stats.documents} documents, ${corpus.stats.chunks} chunks.`,
  );
}

await buildCorpus();
