import { parse as parseYaml } from "yaml";
import type { ExcalidrawElement, ExcalidrawScene, BBox, Edge } from "./scene.js";
import { elementBBox, bboxCenter, edgeMidpoint, autoEdges } from "./scene.js";
import { appendTextElementLine, replaceDrawingBlock, isCompressedMd } from "./mdParse.js";

function randomId(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function randomInt(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function bump(el: ExcalidrawElement): void {
  el.version = ((el.version as number) ?? 1) + 1;
  el.versionNonce = randomInt();
}

const DEFAULT_STROKE = "#1e1e1e";
const DEFAULT_BG = "transparent";

/** Known style properties that can be passed through from patch ops. */
const STYLE_KEYS = new Set([
  "backgroundColor",
  "strokeColor",
  "strokeWidth",
  "strokeStyle",
  "fillStyle",
  "roughness",
  "opacity",
  "roundness",
]);

function baseDefaults(): Partial<ExcalidrawElement> {
  return {
    strokeColor: DEFAULT_STROKE,
    backgroundColor: DEFAULT_BG,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roundness: null,
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    groupIds: [],
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

/** Extract style overrides from an AddOp. */
function extractStyles(op: AddOp): Partial<ExcalidrawElement> {
  const out: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    if (key in op) out[key] = op[key];
  }
  return out as Partial<ExcalidrawElement>;
}

/**
 * Resolve position for a new element.
 * Supports three modes:
 *   1. ref + place  → centered relative to anchor
 *   2. explicit x/y → absolute coordinates
 *   3. neither      → origin (0, 0)
 */
function resolvePosition(
  scene: ExcalidrawScene,
  op: AddOp,
  w: number,
  h: number,
): { x: number; y: number } {
  if (op.ref) {
    const b = getAnchorBBox(scene, String(op.ref));
    const place = String(op.place ?? "below");
    const gap = Number(op.gap ?? 40);
    return resolvePlacement(b, place, gap, w, h);
  }
  if (op.x !== undefined && op.y !== undefined) {
    return { x: Number(op.x), y: Number(op.y) };
  }
  return { x: 0, y: 0 };
}

/**
 * Place relative to anchor bbox — new element is **centered** on the
 * relevant axis (e.g. below → horizontally centered).
 */
function resolvePlacement(
  anchorBBox: BBox,
  place: string,
  gap: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const acx = (anchorBBox.minX + anchorBBox.maxX) / 2;
  const acy = (anchorBBox.minY + anchorBBox.maxY) / 2;
  switch (place) {
    case "below":
      return { x: acx - w / 2, y: anchorBBox.maxY + gap };
    case "above":
      return { x: acx - w / 2, y: anchorBBox.minY - gap - h };
    case "right-of":
      return { x: anchorBBox.maxX + gap, y: acy - h / 2 };
    case "left-of":
      return { x: anchorBBox.minX - gap - w, y: acy - h / 2 };
    default:
      throw new Error(`Unknown place: ${place} (use below|above|right-of|left-of)`);
  }
}

function getAnchorBBox(scene: ExcalidrawScene, refId: string): BBox {
  const el = scene.elements.find((e) => e.id === refId && !e.isDeleted);
  if (!el) throw new Error(`Anchor element not found: ${refId}`);
  const b = elementBBox(el);
  if (!b) throw new Error(`Cannot compute bbox for ${refId}`);
  return b;
}

type AddOp = Record<string, unknown>;
type TextLineCallback = (label: string, id: string) => void;

/**
 * Estimate text pixel width using character-class heuristics.
 * Narrow chars (i, l, 1, etc.) count ~0.35, wide (M, W, etc.) ~0.7, average ~0.55.
 */
function estimateTextWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  let maxLineW = 0;
  for (const line of lines) {
    let w = 0;
    for (const ch of line) {
      if ("iIlj1|!.,;:'".includes(ch)) w += 0.35;
      else if ("MWmw@".includes(ch)) w += 0.75;
      else if (ch === " ") w += 0.3;
      else w += 0.55;
    }
    maxLineW = Math.max(maxLineW, w);
  }
  return Math.max(30, maxLineW * fontSize);
}

function estimateTextHeight(text: string, fontSize: number, lineHeight = 1.25): number {
  const lines = text.split("\n").length;
  return fontSize * lineHeight * lines;
}

/** Create a bound text element inside a container. */
function makeBoundText(
  containerId: string,
  label: string,
  fontSize: number,
): ExcalidrawElement {
  const id = randomId();
  return {
    ...baseDefaults(),
    type: "text",
    id,
    x: 0, // Excalidraw auto-centers bound text
    y: 0,
    width: estimateTextWidth(label, fontSize),
    height: estimateTextHeight(label, fontSize),
    text: label,
    originalText: label,
    fontSize,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    containerId,
    baseline: fontSize,
    lineHeight: 1.25,
    strokeWidth: 1,
    backgroundColor: "transparent",
    roundness: null,
  } as ExcalidrawElement;
}

function addRectangle(
  scene: ExcalidrawScene,
  op: AddOp,
  onNewTextLine: TextLineCallback,
): void {
  const width = Number(op.width ?? 200);
  const height = Number(op.height ?? 80);
  const { x, y } = resolvePosition(scene, op, width, height);
  const id = String(op.id ?? randomId());
  const styles = extractStyles(op);

  const el: ExcalidrawElement = {
    ...baseDefaults(),
    type: "rectangle",
    id,
    x,
    y,
    width,
    height,
    roundness: { type: 3 },
    ...styles,
  } as ExcalidrawElement;

  // Auto-create bound text if label provided
  const label = op.label ? String(op.label) : "";
  if (label) {
    const fontSize = Number(op.fontSize ?? 20);
    const textEl = makeBoundText(id, label, fontSize);
    el.boundElements = [{ id: textEl.id, type: "text" }];
    scene.elements.push(el);
    scene.elements.push(textEl);
    onNewTextLine(label, textEl.id);
  } else {
    scene.elements.push(el);
  }
}

function addEllipse(
  scene: ExcalidrawScene,
  op: AddOp,
  onNewTextLine: TextLineCallback,
): void {
  const width = Number(op.width ?? 120);
  const height = Number(op.height ?? 120);
  const { x, y } = resolvePosition(scene, op, width, height);
  const id = String(op.id ?? randomId());
  const styles = extractStyles(op);

  const el: ExcalidrawElement = {
    ...baseDefaults(),
    type: "ellipse",
    id,
    x,
    y,
    width,
    height,
    ...styles,
  } as ExcalidrawElement;

  const label = op.label ? String(op.label) : "";
  if (label) {
    const fontSize = Number(op.fontSize ?? 20);
    const textEl = makeBoundText(id, label, fontSize);
    el.boundElements = [{ id: textEl.id, type: "text" }];
    scene.elements.push(el);
    scene.elements.push(textEl);
    onNewTextLine(label, textEl.id);
  } else {
    scene.elements.push(el);
  }
}

function addArrow(scene: ExcalidrawScene, op: AddOp): void {
  const fromId = String(op.from ?? op.start ?? "");
  const toId = String(op.to ?? op.end ?? "");
  if (!fromId || !toId) throw new Error("arrow requires from and to (element ids)");

  const b1 = getAnchorBBox(scene, fromId);
  const b2 = getAnchorBBox(scene, toId);

  // Resolve edge connection points
  const fromEdge = op.fromEdge as Edge | undefined;
  const toEdge = op.toEdge as Edge | undefined;
  const auto = autoEdges(b1, b2);
  const fEdge = fromEdge ?? auto.fromEdge;
  const tEdge = toEdge ?? auto.toEdge;
  const p1 = edgeMidpoint(b1, fEdge);
  const p2 = edgeMidpoint(b2, tEdge);

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const id = String(op.id ?? randomId());
  const styles = extractStyles(op);

  const el: ExcalidrawElement = {
    ...baseDefaults(),
    type: "arrow",
    id,
    x: p1.x,
    y: p1.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: fromId, focus: 0, gap: 4 },
    endBinding: { elementId: toId, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: op.endArrowhead !== undefined ? op.endArrowhead : "arrow",
    roundness: { type: 2 },
    ...styles,
  } as ExcalidrawElement;
  scene.elements.push(el);
}

function addText(
  scene: ExcalidrawScene,
  op: AddOp,
  onNewTextLine: TextLineCallback,
): void {
  const label = String(op.text ?? op.label ?? "");
  if (!label) throw new Error("text add requires text or label");
  const fontSize = Number(op.fontSize ?? 20);
  const id = String(op.id ?? randomId());
  const styles = extractStyles(op);

  const w = estimateTextWidth(label, fontSize);
  const h = estimateTextHeight(label, fontSize);
  const { x, y } = resolvePosition(scene, op, w, h);

  const el: ExcalidrawElement = {
    ...baseDefaults(),
    type: "text",
    id,
    x,
    y,
    width: w,
    height: h,
    text: label,
    originalText: label,
    fontSize,
    fontFamily: 1,
    textAlign: op.textAlign ? String(op.textAlign) : "left",
    verticalAlign: "top",
    containerId: null,
    baseline: fontSize,
    lineHeight: 1.25,
    strokeWidth: 1,
    roundness: null,
    ...styles,
  } as ExcalidrawElement;
  scene.elements.push(el);
  onNewTextLine(label, id);
}

export type PatchDoc = {
  add?: AddOp[];
};

export function applyPatchToScene(
  scene: ExcalidrawScene,
  doc: PatchDoc,
  mdContent: string,
): { scene: ExcalidrawScene; mdContent: string } {
  let md = mdContent;
  const newTextLines: { label: string; id: string }[] = [];

  const onText: TextLineCallback = (label, id) => newTextLines.push({ label, id });

  const addList = doc.add ?? [];
  for (const op of addList) {
    const type = String(op.type ?? "").toLowerCase();
    switch (type) {
      case "rectangle":
        addRectangle(scene, op, onText);
        break;
      case "ellipse":
        addEllipse(scene, op, onText);
        break;
      case "arrow":
        addArrow(scene, op);
        break;
      case "text":
        addText(scene, op, onText);
        break;
      default:
        throw new Error(`Unsupported add.type: ${type}`);
    }
  }

  for (const { label, id } of newTextLines) {
    md = appendTextElementLine(md, label, id);
  }

  return { scene, mdContent: md };
}

export function parsePatchFile(content: string, path: string): PatchDoc {
  const lower = path.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return parseYaml(content) as PatchDoc;
  }
  return JSON.parse(content) as PatchDoc;
}

export function applyPatchFile(
  mdContent: string,
  scene: ExcalidrawScene,
  patchContent: string,
  patchPath: string,
): string {
  const doc = parsePatchFile(patchContent, patchPath);
  const { scene: next, mdContent: md2 } = applyPatchToScene(scene, doc, mdContent);
  const json = JSON.stringify(next);
  return replaceDrawingBlock(md2, json, isCompressedMd(mdContent));
}

export function setTextOnScene(
  scene: ExcalidrawScene,
  elementId: string,
  newText: string,
): void {
  const el = scene.elements.find((e) => e.id === elementId);
  if (!el) throw new Error(`Element not found: ${elementId}`);
  if (el.type !== "text") throw new Error(`Element ${elementId} is not type text`);
  el.text = newText;
  el.originalText = newText;
  bump(el);
}
