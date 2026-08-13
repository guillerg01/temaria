"use client";

import {
  ArrowDown,
  BarChart3,
  Clock3,
  GitBranch,
  Network,
  Scale,
} from "lucide-react";
import { useId } from "react";

import type { TeachingVisual } from "@/lib/types";
import { cn } from "@/lib/utils";

const diagramWidth = 820;
const nodeWidth = 220;
const nodeHeight = 120;
const nodesPerRow = 3;

type PositionedNode = TeachingVisual["items"][number] & {
  x: number;
  y: number;
  tone: number;
  isRoot: boolean;
};

function graphLayout(visual: TeachingVisual) {
  const ids = new Set(visual.items.map((item) => item.id));
  const connections = visual.connections.filter(
    (connection) => ids.has(connection.from) && ids.has(connection.to),
  );
  const incoming = new Map(visual.items.map((item) => [item.id, 0]));
  connections.forEach((connection) => {
    incoming.set(connection.to, (incoming.get(connection.to) ?? 0) + 1);
  });

  const roots = visual.items.filter((item) => (incoming.get(item.id) ?? 0) === 0);
  const rootItems = roots.length > 0 ? roots : visual.items.slice(0, 1);
  const levels = new Map(rootItems.map((item) => [item.id, 0]));

  for (let pass = 0; pass < visual.items.length; pass += 1) {
    let changed = false;
    connections.forEach((connection) => {
      const fromLevel = levels.get(connection.from);
      if (fromLevel === undefined) return;
      const nextLevel = Math.min(fromLevel + 1, visual.items.length - 1);
      const currentLevel = levels.get(connection.to);
      if (currentLevel === undefined || currentLevel < nextLevel) {
        levels.set(connection.to, nextLevel);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const maximumLevel = Math.max(0, ...levels.values());
  visual.items.forEach((item) => {
    if (!levels.has(item.id)) levels.set(item.id, maximumLevel + 1);
  });

  const grouped = new Map<number, TeachingVisual["items"]>();
  visual.items.forEach((item) => {
    const level = levels.get(item.id) ?? 0;
    grouped.set(level, [...(grouped.get(level) ?? []), item]);
  });

  const rows: TeachingVisual["items"][] = [];
  [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([, items]) => {
      for (let index = 0; index < items.length; index += nodesPerRow) {
        rows.push(items.slice(index, index + nodesPerRow));
      }
    });

  const groups = new Map<string, number>();
  const positioned: PositionedNode[] = [];
  rows.forEach((row, rowIndex) => {
    const gap = row.length === 1 ? 0 : 26;
    const rowWidth = row.length * nodeWidth + (row.length - 1) * gap;
    const startX = (diagramWidth - rowWidth) / 2;
    row.forEach((item, columnIndex) => {
      const groupKey = item.group.trim() || "General";
      if (!groups.has(groupKey)) groups.set(groupKey, groups.size % 5);
      positioned.push({
        ...item,
        x: startX + columnIndex * (nodeWidth + gap),
        y: 28 + rowIndex * (nodeHeight + 78),
        tone: groups.get(groupKey) ?? 0,
        isRoot: rowIndex === 0,
      });
    });
  });

  return {
    nodes: positioned,
    connections,
    height: Math.max(260, rows.length * (nodeHeight + 78) - 22),
  };
}

function ConceptMap({ visual }: { visual: TeachingVisual }) {
  const markerId = `visual-arrow-${useId().replaceAll(":", "")}`;
  const titleId = `visual-title-${useId().replaceAll(":", "")}`;
  const descriptionId = `visual-description-${useId().replaceAll(":", "")}`;
  const { nodes, connections, height } = graphLayout(visual);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const effectiveConnections =
    connections.length > 0
      ? connections
      : nodes.slice(1).map((node) => ({
          from: nodes[0]?.id ?? node.id,
          to: node.id,
          label: "",
        }));

  return (
    <div className="visual-svg-shell">
      <svg
        className="visual-concept-svg"
        viewBox={`0 0 ${diagramWidth} ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>{visual.title}</title>
        <desc id={descriptionId}>{visual.description}</desc>
        <defs>
          <marker
            id={markerId}
            markerWidth="9"
            markerHeight="9"
            refX="7"
            refY="4.5"
            orient="auto"
          >
            <path d="M0,0 L9,4.5 L0,9 Z" className="visual-arrow-head" />
          </marker>
        </defs>

        <g className="visual-edge-layer">
          {effectiveConnections.map((connection, index) => {
            const from = byId.get(connection.from);
            const to = byId.get(connection.to);
            if (!from || !to || from.id === to.id) return null;
            const forward = to.y > from.y;
            const startX = forward ? from.x + nodeWidth / 2 : from.x + nodeWidth;
            const startY = forward ? from.y + nodeHeight : from.y + nodeHeight / 2;
            const endX = forward ? to.x + nodeWidth / 2 : to.x;
            const endY = forward ? to.y : to.y + nodeHeight / 2;
            const midpoint = forward
              ? startY + (endY - startY) / 2
              : Math.max(startX, endX) + 42;
            const path = forward
              ? `M ${startX} ${startY} C ${startX} ${midpoint}, ${endX} ${midpoint}, ${endX} ${endY}`
              : `M ${startX} ${startY} C ${midpoint} ${startY}, ${midpoint} ${endY}, ${endX} ${endY}`;
            return (
              <g key={`${connection.from}-${connection.to}-${index}`}>
                <path
                  d={path}
                  className="visual-edge"
                  markerEnd={`url(#${markerId})`}
                />
                {connection.label && forward && (
                  <text
                    x={(startX + endX) / 2}
                    y={midpoint - 7}
                    className="visual-edge-label"
                    textAnchor="middle"
                  >
                    {connection.label.slice(0, 34)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {nodes.map((node) => (
          <foreignObject
            key={node.id}
            x={node.x}
            y={node.y}
            width={nodeWidth}
            height={nodeHeight}
          >
            <div
              className={cn(
                "visual-svg-node",
                `visual-tone-${node.tone}`,
                node.isRoot && "visual-svg-node-root",
              )}
            >
              <small>{node.group || (node.isRoot ? "Idea central" : "Concepto")}</small>
              <strong>{node.label}</strong>
              {node.description && <p>{node.description}</p>}
            </div>
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}

function HierarchicalMindMap({ visual }: { visual: TeachingVisual }) {
  const incoming = new Map(visual.items.map((item) => [item.id, 0]));
  visual.connections.forEach((connection) => {
    incoming.set(connection.to, (incoming.get(connection.to) ?? 0) + 1);
  });
  const root =
    visual.items.find((item) => (incoming.get(item.id) ?? 0) === 0) ??
    visual.items[0];
  const byId = new Map(visual.items.map((item) => [item.id, item]));
  const children = new Map<string, string[]>();
  visual.connections.forEach((connection) => {
    children.set(connection.from, [
      ...(children.get(connection.from) ?? []),
      connection.to,
    ]);
  });
  const branches = (children.get(root?.id ?? "") ?? [])
    .map((id) => byId.get(id))
    .filter((item): item is TeachingVisual["items"][number] => Boolean(item));

  function descendants(id: string) {
    const result: TeachingVisual["items"] = [];
    const queue = [...(children.get(id) ?? [])];
    const visited = new Set<string>();
    while (queue.length) {
      const childId = queue.shift();
      if (!childId || visited.has(childId)) continue;
      visited.add(childId);
      const item = byId.get(childId);
      if (item) result.push(item);
      queue.push(...(children.get(childId) ?? []));
    }
    return result;
  }

  if (!root || branches.length < 3) return <ConceptMap visual={visual} />;

  return (
    <div className="visual-mindmap" role="img" aria-label={`${visual.title}. ${visual.description}`}>
      <div className="visual-mindmap-root">
        <Network size={22} />
        <span><small>Idea central</small><strong>{root.label}</strong></span>
      </div>
      <div className="visual-mindmap-branches">
        {branches.map((branch, index) => {
          const branchItems = descendants(branch.id);
          return (
            <section className={`visual-mindmap-branch visual-tone-${index % 5}`} key={branch.id}>
              <header>
                <span>{index + 1}</span>
                <strong>{branch.label}</strong>
              </header>
              {branch.description && <p>{branch.description}</p>}
              {branchItems.length > 0 && (
                <ul>
                  {branchItems.map((item) => (
                    <li key={item.id}>
                      <i aria-hidden="true" />
                      <span>
                        <strong>{item.label}</strong>
                        {item.description && <small>{item.description}</small>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProcessDiagram({
  visual,
  timeline = false,
}: {
  visual: TeachingVisual;
  timeline?: boolean;
}) {
  return (
    <ol className={cn("visual-flow", timeline && "visual-timeline")}>
      {visual.items.map((item, index) => (
        <li key={item.id} className={`visual-tone-${index % 5}`}>
          <div className="visual-flow-marker">
            {timeline ? <Clock3 size={17} /> : <span>{index + 1}</span>}
          </div>
          <article>
            <small>{item.group || (timeline ? `Momento ${index + 1}` : `Paso ${index + 1}`)}</small>
            <strong>{item.label}</strong>
            <p>{item.description}</p>
          </article>
          {index < visual.items.length - 1 && (
            <ArrowDown className="visual-flow-arrow" size={19} aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

function ComparisonDiagram({ visual }: { visual: TeachingVisual }) {
  const grouped = new Map<string, TeachingVisual["items"]>();
  visual.items.forEach((item) => {
    const group = item.group.trim() || item.label;
    grouped.set(group, [...(grouped.get(group) ?? []), item]);
  });

  return (
    <div className="visual-comparison" role="group" aria-label={visual.title}>
      {[...grouped.entries()].map(([group, items], groupIndex) => (
        <section className={`visual-comparison-column visual-tone-${groupIndex % 5}`} key={group}>
          <header>
            <span>{groupIndex + 1}</span>
            <strong>{group}</strong>
          </header>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                {item.label !== group && <strong>{item.label}</strong>}
                <p>{item.description}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function BarDiagram({ visual }: { visual: TeachingVisual }) {
  const maximum = Math.max(1, ...visual.items.map((item) => item.value));
  return (
    <div className="visual-bars" role="img" aria-label={`${visual.title}. ${visual.description}`}>
      {visual.items.map((item, index) => (
        <div className={`visual-bar-row visual-tone-${index % 5}`} key={item.id}>
          <span>{item.label}</span>
          <div>
            <i style={{ width: `${Math.max(3, (item.value / maximum) * 100)}%` }} />
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

const visualLabels: Record<TeachingVisual["type"], string> = {
  concept_map: "Mapa conceptual",
  process: "Flujo paso a paso",
  timeline: "Línea de tiempo",
  comparison: "Comparación visual",
  bar_chart: "Gráfico de magnitudes",
};

export function TeachingVisualView({ visual }: { visual: TeachingVisual }) {
  const icon =
    visual.type === "bar_chart"
      ? BarChart3
      : visual.type === "comparison"
        ? Scale
        : visual.type === "timeline"
          ? Clock3
          : visual.type === "process"
            ? GitBranch
            : Network;
  const Icon = icon;
  const hasValues = visual.items.some((item) => item.value > 0);
  const isLargeMindMap =
    visual.type === "concept_map" && visual.items.length > 12;

  return (
    <figure className={cn("teaching-visual", `teaching-visual-${visual.type}`)}>
      <figcaption>
        <span><Icon size={19} /></span>
        <div>
          <small>{visualLabels[visual.type]}</small>
          <strong>{visual.title}</strong>
          <p>{visual.description}</p>
        </div>
      </figcaption>

      {visual.type === "concept_map" &&
        (isLargeMindMap ? (
          <HierarchicalMindMap visual={visual} />
        ) : (
          <ConceptMap visual={visual} />
        ))}
      {visual.type === "process" && <ProcessDiagram visual={visual} />}
      {visual.type === "timeline" && <ProcessDiagram visual={visual} timeline />}
      {visual.type === "comparison" && <ComparisonDiagram visual={visual} />}
      {visual.type === "bar_chart" && hasValues && <BarDiagram visual={visual} />}
      {visual.type === "bar_chart" && !hasValues && <ComparisonDiagram visual={visual} />}

      <details className="visual-text-fallback">
        <summary>Ver el esquema en formato de lista</summary>
        <ol>
          {visual.items.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              {item.description && <span>{item.description}</span>}
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

export function parseMermaidFlowchart(source: string): TeachingVisual | null {
  const cleaned = source.trim();
  if (!/^\s*(flowchart|graph)\s+(LR|RL|TD|TB|BT)/i.test(cleaned)) return null;

  const labels = new Map<string, string>();
  const order: string[] = [];
  const remember = (id: string, label?: string) => {
    if (!labels.has(id)) order.push(id);
    labels.set(id, (label || labels.get(id) || id).replace(/^['"]|['"]$/g, "").trim());
  };
  const connections: TeachingVisual["connections"] = [];
  const lines = cleaned.split(/\r?\n/).slice(1);

  lines.forEach((line) => {
    const nodePattern = /([A-Za-z][\w-]*)\s*(?:\[\s*"([\s\S]*?)"\s*\]|\[\s*([^\]]+?)\s*\]|\(\s*"([\s\S]*?)"\s*\)|\(\s*([^\)]+?)\s*\))/g;
    for (const match of line.matchAll(nodePattern)) {
      remember(match[1], match[2] ?? match[3] ?? match[4] ?? match[5]);
    }

    const arrowAt = line.indexOf("-->");
    if (arrowAt < 0) return;
    const left = line.slice(0, arrowAt).match(/^\s*([A-Za-z][\w-]*)/);
    const right = line.slice(arrowAt + 3).match(/^\s*([A-Za-z][\w-]*)/);
    if (!left || !right) return;
    remember(left[1]);
    remember(right[1]);
    connections.push({ from: left[1], to: right[1], label: "" });
  });

  if (order.length < 2) return null;
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  connections.forEach((connection) => {
    outDegree.set(connection.from, (outDegree.get(connection.from) ?? 0) + 1);
    inDegree.set(connection.to, (inDegree.get(connection.to) ?? 0) + 1);
  });
  const branched = order.some(
    (id) => (outDegree.get(id) ?? 0) > 1 || (inDegree.get(id) ?? 0) > 1,
  );

  return {
    type: branched ? "concept_map" : "process",
    title: "Esquema visual de la explicación",
    description: branched
      ? "Las flechas muestran cómo se relacionan las ideas del material."
      : "Sigue las etapas en el orden indicado para recordar el procedimiento.",
    items: order.map((id, index) => ({
      id,
      label: labels.get(id) ?? id,
      description: "",
      value: 0,
      group: index === 0 ? "Idea central" : branched ? "Idea relacionada" : `Paso ${index + 1}`,
    })),
    connections,
  };
}

export function parseMermaidMindmap(source: string): TeachingVisual | null {
  const cleaned = source.replace(/\t/g, "  ").trimEnd();
  const lines = cleaned.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => /^\s*mindmap\s*$/i.test(line));
  const contentStart =
    markerIndex >= 0
      ? markerIndex + 1
      : /^\s*root\s*(?:\(\(|\(|\[)/i.test(lines[0] ?? "")
        ? 0
        : -1;
  if (contentStart < 0) return null;

  const nodes: TeachingVisual["items"] = [];
  const connections: TeachingVisual["connections"] = [];
  const stack: Array<{ indent: number; id: string }> = [];
  let rootLabel = "Mapa mental";

  lines.slice(contentStart).forEach((line) => {
    if (!line.trim()) return;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    let label = line.trim();
    label = label
      .replace(/^root\s*\(\((.*)\)\)\s*$/i, "$1")
      .replace(/^root\s*\((.*)\)\s*$/i, "$1")
      .replace(/^root\s*\[(.*)\]\s*$/i, "$1")
      .replace(/^[-*+]\s+/, "")
      .trim();
    if (!label) return;

    const id = `mindmap-${nodes.length + 1}`;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const depth = stack.length;
    if (nodes.length === 0) rootLabel = label;
    nodes.push({
      id,
      label,
      description: "",
      value: 0,
      group:
        depth === 0
          ? "Idea central"
          : depth === 1
            ? "Rama principal"
            : "Idea relacionada",
    });
    if (parent) connections.push({ from: parent.id, to: id, label: "" });
    stack.push({ indent, id });
  });

  if (nodes.length < 2) return null;
  return {
    type: "concept_map",
    title: rootLabel,
    description:
      "Mapa mental organizado por ramas para recordar las relaciones entre las ideas principales y sus detalles.",
    items: nodes,
    connections,
  };
}

export function parseEducationalDiagram(source: string) {
  return parseMermaidMindmap(source) ?? parseMermaidFlowchart(source);
}
