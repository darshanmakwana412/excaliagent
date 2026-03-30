import LZString from "lz-string";

/** Matches plugin-style drawing blocks (first occurrence). */
const DRAWING_COMPRESSED_REG =
  /(\n##? Drawing\n[^`]*?```compressed-json\n)([\s\S]*?)(```\n)/;

const DRAWING_JSON_REG =
  /(\n##? Drawing\n[^`]*?```json\n)([\s\S]*?)(```\n)/;

export function decompressPayload(data: string): string {
  let cleaned = "";
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c !== "\n" && c !== "\r") cleaned += c;
  }
  const out = LZString.decompressFromBase64(cleaned);
  if (out == null) throw new Error("Failed to decompress drawing (invalid LZ-String payload)");
  return out;
}

export function compressPayload(jsonString: string, chunkSize = 256): string {
  const compressed = LZString.compressToBase64(jsonString);
  let result = "";
  for (let i = 0; i < compressed.length; i += chunkSize) {
    result += compressed.slice(i, i + chunkSize) + "\n\n";
  }
  return result.trim();
}

export type DrawingBlockInfo =
  | { kind: "compressed"; prefix: string; body: string; suffix: string; fullMatch: string }
  | { kind: "json"; prefix: string; body: string; suffix: string; fullMatch: string };

export function isCompressedMd(content: string): boolean {
  return content.includes("```compressed-json\n");
}

function findDrawingBlock(content: string): DrawingBlockInfo | null {
  if (isCompressedMd(content)) {
    const m = content.match(DRAWING_COMPRESSED_REG);
    if (m && m[1] != null && m[2] != null && m[3] != null) {
      return {
        kind: "compressed",
        prefix: m[1],
        body: m[2],
        suffix: m[3],
        fullMatch: m[0],
      };
    }
    return null;
  }
  const m = content.match(DRAWING_JSON_REG);
  if (m && m[1] != null && m[2] != null && m[3] != null) {
    return {
      kind: "json",
      prefix: m[1],
      body: m[2],
      suffix: m[3],
      fullMatch: m[0],
    };
  }
  return null;
}

/** Trim scene JSON to balanced outer object (plugin workaround). */
export function trimSceneJson(decompressed: string): string {
  const end = decompressed.lastIndexOf("}");
  if (end === -1) return decompressed;
  return decompressed.substring(0, end + 1);
}

export function extractSceneString(mdContent: string): { sceneJson: string; block: DrawingBlockInfo } {
  const block = findDrawingBlock(mdContent);
  if (!block) throw new Error("No ## Drawing block with compressed-json or json found");
  const raw =
    block.kind === "compressed" ? decompressPayload(block.body) : block.body;
  return { sceneJson: trimSceneJson(raw), block };
}

export function replaceDrawingBlock(mdContent: string, newBody: string, asCompressed: boolean): string {
  const block = findDrawingBlock(mdContent);
  if (!block) throw new Error("No ## Drawing block found");
  if (asCompressed) {
    const compressed = compressPayload(newBody);
    const prefix =
      block.kind === "compressed"
        ? block.prefix
        : "\n## Drawing\n```compressed-json\n";
    return mdContent.replace(block.fullMatch, `${prefix}${compressed}\n${block.suffix}`);
  }
  const prefix = block.kind === "json" ? block.prefix : "\n## Drawing\n```json\n";
  return mdContent.replace(block.fullMatch, `${prefix}${newBody}\n${block.suffix}`);
}

const TEXT_ELEMENTS_HEADER = /^(##? Text Elements)\s*$/m;

/** Parse id -> label from ## Text Elements section (markdown wins over JSON in Obsidian). */
export function parseTextElements(mdContent: string): Map<string, string> {
  const map = new Map<string, string>();
  const headerMatch = mdContent.match(TEXT_ELEMENTS_HEADER);
  if (!headerMatch || headerMatch.index === undefined) return map;

  let start = headerMatch.index + headerMatch[0].length;
  const rest = mdContent.slice(start);
  const nextSection = rest.search(/\n## /);
  const section =
    nextSection === -1 ? rest : rest.slice(0, nextSection);

  const idPattern = /\s\^([a-zA-Z0-9_-]{8})\s*\n/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = idPattern.exec(section)) !== null) {
    const id = m[1];
    const label = section.slice(pos, m.index).replace(/\n+$/, "").trim();
    if (label) map.set(id, label);
    pos = m.index + m[0].length;
  }
  return map;
}

export function updateTextElementLine(
  mdContent: string,
  elementId: string,
  newLabel: string,
): string {
  const headerMatch = mdContent.match(TEXT_ELEMENTS_HEADER);
  if (!headerMatch || headerMatch.index === undefined) {
    throw new Error("## Text Elements section not found");
  }
  const afterHeader = headerMatch.index + headerMatch[0].length;
  const tail = mdContent.slice(afterHeader);
  const nextSection = tail.search(/\n## /);
  const sectionEnd = nextSection === -1 ? tail.length : nextSection;
  const before = mdContent.slice(0, afterHeader);
  const section = tail.slice(0, sectionEnd);
  const after = tail.slice(sectionEnd);

  const lineRe = new RegExp(
    `^([\\s\\S]*?)(\\s\\^${escapeRegExp(elementId)})(\\s*\\n)`,
    "m",
  );
  const lm = section.match(lineRe);
  if (!lm) throw new Error(`Text element ^${elementId} not found in ## Text Elements`);
  const updatedSection = section.replace(
    lineRe,
    `${newLabel}$2$3`,
  );
  return before + updatedSection + after;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Insert `label ^id` before the next `##` section after ## Text Elements. */
export function appendTextElementLine(
  mdContent: string,
  label: string,
  id: string,
): string {
  const headerMatch = mdContent.match(TEXT_ELEMENTS_HEADER);
  if (!headerMatch || headerMatch.index === undefined) {
    throw new Error("## Text Elements section not found; cannot add text label");
  }
  const start = headerMatch.index + headerMatch[0].length;
  const tail = mdContent.slice(start);
  const nextSection = tail.search(/\n## /);
  const insertAt = nextSection === -1 ? mdContent.length : start + nextSection;
  const prefix = mdContent.slice(insertAt - 1, insertAt) === "\n" ? "" : "\n";
  const line = `${prefix}${label} ^${id}\n\n`;
  return mdContent.slice(0, insertAt) + line + mdContent.slice(insertAt);
}
