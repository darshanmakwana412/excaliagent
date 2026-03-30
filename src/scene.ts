export type ExcalidrawElement = Record<string, unknown> & {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  isDeleted?: boolean;
  groupIds?: string[];
  containerId?: string | null;
  text?: string;
  originalText?: string;
  points?: readonly [number, number][];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  frameId?: string | null;
};

export type ExcalidrawScene = {
  type?: string;
  version?: number;
  source?: string;
  elements: ExcalidrawElement[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export function parseScene(json: string): ExcalidrawScene {
  const data = JSON.parse(json) as ExcalidrawScene;
  if (!Array.isArray(data.elements)) throw new Error("Scene JSON missing elements[]");
  return data;
}

export function stringifyScene(scene: ExcalidrawScene, pretty: boolean): string {
  return pretty ? JSON.stringify(scene, null, 2) : JSON.stringify(scene);
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** Axis-aligned bbox; rotation ignored (v1 limitation). */
export function elementBBox(el: ExcalidrawElement): BBox | null {
  if (el.isDeleted) return null;
  const t = el.type;
  if (t === "line" || t === "arrow") {
    const pts = el.points;
    if (!pts?.length) {
      const x = el.x ?? 0;
      const y = el.y ?? 0;
      const w = el.width ?? 0;
      const h = el.height ?? 0;
      return { minX: x, minY: y, maxX: x + w, maxY: y + h };
    }
    const ox = el.x ?? 0;
    const oy = el.y ?? 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of pts) {
      const x = ox + px;
      const y = oy + py;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
  }
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

export function bboxCenter(b: BBox): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function elementMap(elements: ExcalidrawElement[]): Map<string, ExcalidrawElement> {
  const m = new Map<string, ExcalidrawElement>();
  for (const e of elements) m.set(e.id, e);
  return m;
}

export type Edge = "top" | "bottom" | "left" | "right";

/** Midpoint of a specific bbox edge. */
export function edgeMidpoint(b: BBox, edge: Edge): { x: number; y: number } {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  switch (edge) {
    case "top": return { x: cx, y: b.minY };
    case "bottom": return { x: cx, y: b.maxY };
    case "left": return { x: b.minX, y: cy };
    case "right": return { x: b.maxX, y: cy };
  }
}

/** Auto-detect best edges for an arrow between two bboxes. */
export function autoEdges(from: BBox, to: BBox): { fromEdge: Edge; toEdge: Edge } {
  const fcx = (from.minX + from.maxX) / 2;
  const fcy = (from.minY + from.maxY) / 2;
  const tcx = (to.minX + to.maxX) / 2;
  const tcy = (to.minY + to.maxY) / 2;
  const dx = tcx - fcx;
  const dy = tcy - fcy;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy > 0
      ? { fromEdge: "bottom", toEdge: "top" }
      : { fromEdge: "top", toEdge: "bottom" };
  }
  return dx > 0
    ? { fromEdge: "right", toEdge: "left" }
    : { fromEdge: "left", toEdge: "right" };
}
