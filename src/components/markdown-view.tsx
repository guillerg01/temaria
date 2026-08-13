"use client";

import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  parseEducationalDiagram,
  TeachingVisualView,
} from "@/components/teaching-visual";

const actionLead =
  /^(Administrar|Adaptar|Aplicar|Ayudar|Colaborar|Colocar|Comprobar|Comunicar|Concienciar|Conocer|Controlar|Cortar|Desarrollar|Favorecer|Fomentar|Informar|Llevar|Medir|Motivar|Ofrecer|Organizar|Orientar|Participar|Potenciar|Prestar|Realizar|Recoger|Revisar|Saber|Siempre comprobar|Tener|Tomar|Transmitir|Trabajar|Utilizar|Valorar)\b/i;

function normalizeStudyMarkdown(markdown: string) {
  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const normalized: string[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index].trim();
    if (!block) continue;
    const isAction =
      !block.includes("\n") && block.length <= 260 && actionLead.test(block);

    if (isAction) {
      const items = [block];
      while (index + 1 < blocks.length) {
        const next = blocks[index + 1].trim();
        if (next.includes("\n") || next.length > 260 || !actionLead.test(next))
          break;
        items.push(next);
        index += 1;
      }
      if (items.length >= 2) {
        normalized.push(items.map((item) => `- ${item}`).join("\n"));
      } else {
        normalized.push(block);
      }
      continue;
    }

    const next = blocks[index + 1]?.trim() ?? "";
    const afterNext = blocks[index + 2]?.trim() ?? "";
    const isSectionLabel =
      !block.includes("\n") &&
      block.length <= 90 &&
      !/[.!?;:]$/.test(block) &&
      actionLead.test(next) &&
      actionLead.test(afterNext);
    normalized.push(isSectionLabel ? `### ${block}` : block);
  }

  return normalized.join("\n\n");
}

function plainHeadingText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function extractStudyHeadings(markdown: string) {
  return normalizeStudyMarkdown(markdown)
    .split("\n")
    .map((line) => line.match(/^(#{1,4})\s+(.+?)\s*#*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match, index) => ({
      id: `reader-section-${index + 1}`,
      level: match[1].length,
      text: plainHeadingText(match[2]),
    }));
}

export function MarkdownView({
  children,
  navigableHeadings = false,
}: {
  children: string;
  navigableHeadings?: boolean;
}) {
  const headingProps = navigableHeadings
    ? { tabIndex: -1, "data-study-heading": "true" }
    : {};

  return (
    <article className="prose-study">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children: headingChildren }) {
            return <h1 {...headingProps}>{headingChildren}</h1>;
          },
          h2({ children: headingChildren }) {
            return <h2 {...headingProps}>{headingChildren}</h2>;
          },
          h3({ children: headingChildren }) {
            return <h3 {...headingProps}>{headingChildren}</h3>;
          },
          h4({ children: headingChildren }) {
            return <h4 {...headingProps}>{headingChildren}</h4>;
          },
          pre({ children: preChildren }) {
            const child = Children.toArray(preChildren)[0];
            if (
              isValidElement<{
                className?: string;
                children?: ReactNode;
              }>(child)
            ) {
              const source = String(child.props.children ?? "").trim();
              const visual =
                child.props.className?.includes("language-mermaid") ||
                child.props.className?.includes("language-mindmap") ||
                /^\s*(flowchart|graph)\s+(LR|RL|TD|TB|BT)/i.test(source) ||
                /(^|\n)\s*mindmap\s*(\n|$)/i.test(source)
                  ? parseEducationalDiagram(source)
                  : null;
              if (visual) return <TeachingVisualView visual={visual} />;
            }
            return <pre>{preChildren}</pre>;
          },
        }}
      >
        {normalizeStudyMarkdown(children)}
      </ReactMarkdown>
    </article>
  );
}
