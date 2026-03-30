import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractSceneString,
  replaceDrawingBlock,
  parseTextElements,
  decompressPayload,
  compressPayload,
} from "../src/mdParse.js";
import { parseScene } from "../src/scene.js";
import { buildSummary } from "../src/summary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const qwenPath = join(repoRoot, "qwen.md");

describe("qwen.md", () => {
  it("decompresses and parses scene", async () => {
    const md = await readFile(qwenPath, "utf8");
    const { sceneJson, block } = extractSceneString(md);
    expect(block.kind).toBe("compressed");
    const scene = parseScene(sceneJson);
    expect(scene.elements.length).toBeGreaterThan(100);
    expect(scene.elements.some((e) => e.type === "text")).toBe(true);
  });

  it("round-trips compress/decompress without losing elements", async () => {
    const md = await readFile(qwenPath, "utf8");
    const { sceneJson } = extractSceneString(md);
    const scene1 = parseScene(sceneJson);
    const compressed = compressPayload(sceneJson);
    const again = decompressPayload(compressed);
    const trimmed = again.substring(0, again.lastIndexOf("}") + 1);
    const scene2 = parseScene(trimmed);
    expect(scene2.elements.length).toBe(scene1.elements.length);
  });

  it("replaceDrawingBlock preserves parseability", async () => {
    const md = await readFile(qwenPath, "utf8");
    const { sceneJson } = extractSceneString(md);
    const scene = parseScene(sceneJson);
    const out = replaceDrawingBlock(md, JSON.stringify(scene), true);
    const { sceneJson: j2 } = extractSceneString(out);
    const scene2 = parseScene(j2);
    expect(scene2.elements.length).toBe(scene.elements.length);
  });

  it("parses Text Elements and matches summary shape", async () => {
    const md = await readFile(qwenPath, "utf8");
    const { sceneJson } = extractSceneString(md);
    const scene = parseScene(sceneJson);
    const map = parseTextElements(md);
    expect(map.get("qHt0AfEn")).toBe("Pretrained AuT Encoder");
    const summary = buildSummary(scene, map) as {
      elementCount: number;
      types: Record<string, number>;
      texts: { id: string }[];
    };
    expect(summary.elementCount).toBeGreaterThan(100);
    expect(summary.types.text).toBeGreaterThan(0);
    expect(summary.texts.some((t) => t.id === "qHt0AfEn")).toBe(true);
  });
});
