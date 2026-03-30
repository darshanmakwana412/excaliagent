import YAML from "yaml";
import type { ExcalidrawElement, ExcalidrawScene, BBox } from "./scene.js";
import { elementBBox, bboxCenter } from "./scene.js";

export type Relation =
  | { kind: "above"; a: string; b: string }
  | { kind: "below"; a: string; b: string }
  | { kind: "left-of"; a: string; b: string }
  | { kind: "right-of"; a: string; b: string }
  | { kind: "inside"; inner: string; outer: string };

function labelFor(
  el: ExcalidrawElement,
  textFromMd: Map<string, string>,
): string {
  if (el.type === "text") {
    const md = textFromMd.get(el.id);
    if (md) return md;
    const t = (el.originalText ?? el.text ?? "").trim();
    return t || el.id;
  }
  return `${el.type}:${el.id}`;
}

/** Top group id = shallowest in groupIds (last in array per Excalidraw). */
function topGroupId(el: ExcalidrawElement): string | null {
  const g = el.groupIds;
  if (!g?.length) return null;
  return g[g.length - 1] ?? null;
}

function deriveRelations(
  elements: ExcalidrawElement[],
  textFromMd: Map<string, string>,
  threshold = 8,
): Relation[] {
  const alive = elements.filter((e) => !e.isDeleted);
  const ids = alive.map((e) => e.id);
  const boxes = new Map<string, BBox>();
  for (const e of alive) {
    const b = elementBBox(e);
    if (b) boxes.set(e.id, b);
  }

  const relations: Relation[] = [];
  const labelIds = alive
    .filter((e) => e.type === "text" || textFromMd.has(e.id))
    .map((e) => e.id);

  const candidates =
    labelIds.length > 0
      ? labelIds
      : ids.filter((id) => {
          const e = alive.find((x) => x.id === id);
          return e && ["text", "rectangle", "ellipse", "diamond"].includes(e.type);
        });
  const pairIds = candidates.length > 0 ? candidates : ids.slice(0, 40);

  for (let i = 0; i < pairIds.length; i++) {
    for (let j = 0; j < pairIds.length; j++) {
      if (i === j) continue;
      const a = pairIds[i];
      const b = pairIds[j];
      const ba = boxes.get(a);
      const bb = boxes.get(b);
      if (!ba || !bb) continue;
      const ca = bboxCenter(ba);
      const cb = bboxCenter(bb);
      const dy = ca.y - cb.y;
      const dx = ca.x - cb.x;
      const vertGap =
        dy > 0 ? ba.minY - bb.maxY : bb.minY - ba.maxY;
      const horizGap =
        dx > 0 ? ba.minX - bb.maxX : bb.minX - ba.maxX;

      if (Math.abs(dy) > Math.abs(dx) && Math.abs(vertGap) < threshold + 200) {
        if (dy < 0 && ba.maxY < bb.minY + threshold)
          relations.push({ kind: "above", a, b });
        else if (dy > 0 && ba.minY > bb.maxY - threshold)
          relations.push({ kind: "below", a, b });
      } else if (Math.abs(horizGap) < threshold + 200) {
        if (dx < 0 && ba.maxX < bb.minX + threshold)
          relations.push({ kind: "left-of", a, b });
        else if (dx > 0 && ba.minX > bb.maxX - threshold)
          relations.push({ kind: "right-of", a, b });
      }
    }
  }

  // inside: text in container
  for (const e of alive) {
    if (e.type !== "text" || !e.containerId) continue;
    const outer = e.containerId;
    if (boxes.has(outer)) relations.push({ kind: "inside", inner: e.id, outer });
  }

  // dedupe
  const seen = new Set<string>();
  return relations.filter((r) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildSummary(
  scene: ExcalidrawScene,
  textFromMd: Map<string, string>,
): Record<string, unknown> {
  const elements = scene.elements.filter((e) => !e.isDeleted);
  const byType: Record<string, number> = {};
  for (const e of elements) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }

  const groupToMembers = new Map<string, string[]>();
  for (const e of elements) {
    const gid = topGroupId(e);
    if (!gid) continue;
    const list = groupToMembers.get(gid) ?? [];
    list.push(e.id);
    groupToMembers.set(gid, list);
  }

  const groups = [...groupToMembers.entries()].map(([groupId, memberIds]) => ({
    groupId,
    members: memberIds.map((id) => {
      const el = elements.find((x) => x.id === id);
      return {
        id,
        type: el?.type ?? "?",
        label: el ? labelFor(el, textFromMd) : id,
      };
    }),
  }));

  const frames = elements
    .filter((e) => e.type === "frame")
    .map((e) => ({
      id: e.id,
      name: (e as { name?: string }).name ?? "",
    }));

  const texts = elements
    .filter((e) => e.type === "text")
    .map((e) => ({
      id: e.id,
      markdownLabel: textFromMd.get(e.id) ?? null,
      containerId: e.containerId ?? null,
      containerType: e.containerId
        ? elements.find((x) => x.id === e.containerId)?.type ?? null
        : null,
    }));

  const arrows = elements
    .filter((e) => e.type === "arrow")
    .map((e) => ({
      id: e.id,
      start: e.startBinding?.elementId ?? null,
      end: e.endBinding?.elementId ?? null,
    }))
    .filter((a) => a.start || a.end);

  const relations = deriveRelations(scene.elements, textFromMd);

  return {
    elementCount: elements.length,
    types: byType,
    groups,
    frames,
    texts,
    arrows,
    relations,
    note:
      "Spatial relations are heuristic (axis-aligned, rotation ignored). Markdown ## Text Elements overrides JSON text when opened in Obsidian.",
  };
}

export function formatSummary(
  scene: ExcalidrawScene,
  textFromMd: Map<string, string>,
  asYaml: boolean,
): string {
  const obj = buildSummary(scene, textFromMd);
  if (!asYaml) return JSON.stringify(obj, null, 2);
  return YAML.stringify(obj, { indent: 2, lineWidth: 0 });
}

export function getElementDetail(
  scene: ExcalidrawScene,
  id: string,
  textFromMd: Map<string, string>,
): Record<string, unknown> | null {
  const el = scene.elements.find((e) => e.id === id);
  if (!el) return null;
  const bbox = elementBBox(el);
  const md = textFromMd.get(id);
  return {
    ...el,
    markdownLabel: md ?? null,
    derivedBBox: bbox,
  };
}
