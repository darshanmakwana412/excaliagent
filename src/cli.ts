#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  extractSceneString,
  parseTextElements,
  updateTextElementLine,
  replaceDrawingBlock,
  isCompressedMd,
} from "./mdParse.js";
import { parseScene, stringifyScene } from "./scene.js";
import { formatSummary, getElementDetail } from "./summary.js";
import {
  applyPatchFile,
  setTextOnScene,
} from "./patch.js";

function usage(): string {
  return `excaliagent — read/edit Obsidian Excalidraw .md files

Usage:
  excaliagent summary <file.md> [--yaml]
  excaliagent element <file.md> <id> [--json]
  excaliagent scene <file.md> [--no-pretty]
  excaliagent text set <file.md> <id> <text>
  excaliagent apply-patch <file.md> <patch.yaml|.json>
  excaliagent help

Notes:
  Obsidian loads text from ## Text Elements over JSON; use "text set" to keep both in sync.
`;
}

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

async function readMd(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    die(`Cannot read file: ${path}: ${e}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
    console.log(usage());
    process.exit(0);
  }

  const cmd = argv[0];

  if (cmd === "summary") {
    const file = argv[1];
    if (!file) die("summary: missing file.md");
    const yaml = argv.includes("--yaml");
    const md = await readMd(file);
    const { sceneJson } = extractSceneString(md);
    const scene = parseScene(sceneJson);
    const textMap = parseTextElements(md);
    console.log(formatSummary(scene, textMap, yaml));
    return;
  }

  if (cmd === "element") {
    const file = argv[1];
    const id = argv[2];
    if (!file || !id) die("element: usage: element <file.md> <id> [--json]");
    const pretty = argv.includes("--json");
    const md = await readMd(file);
    const { sceneJson } = extractSceneString(md);
    const scene = parseScene(sceneJson);
    const textMap = parseTextElements(md);
    const detail = getElementDetail(scene, id, textMap);
    if (!detail) die(`No element with id: ${id}`);
    console.log(JSON.stringify(detail, null, pretty ? 2 : undefined));
    return;
  }

  if (cmd === "scene") {
    const file = argv[1];
    if (!file) die("scene: missing file.md");
    const pretty = !argv.includes("--no-pretty");
    const md = await readMd(file);
    const { sceneJson } = extractSceneString(md);
    if (pretty) {
      const scene = parseScene(sceneJson);
      console.log(stringifyScene(scene, true));
    } else {
      console.log(sceneJson);
    }
    return;
  }

  if (cmd === "text") {
    const sub = argv[1];
    if (sub !== "set") die('text: only "text set" is supported');
    const file = argv[2];
    const id = argv[3];
    const text = argv.slice(4).join(" ");
    if (!file || !id || !text) die('usage: text set <file.md> <id> "new label"');
    let md = await readMd(file);
    const { sceneJson } = extractSceneString(md);
    const scene = parseScene(sceneJson);
    setTextOnScene(scene, id, text);
    md = updateTextElementLine(md, id, text);
    const out = replaceDrawingBlock(
      md,
      JSON.stringify(scene),
      isCompressedMd(md),
    );
    await writeFile(resolve(file), out, "utf8");
    console.error(`Updated ${file} (text element ${id})`);
    return;
  }

  if (cmd === "apply-patch") {
    const file = argv[1];
    const patchPath = argv[2];
    if (!file || !patchPath) die("usage: apply-patch <file.md> <patch.yaml|.json>");
    const md = await readMd(file);
    let patchContent: string;
    try {
      patchContent = await readFile(resolve(patchPath), "utf8");
    } catch (e) {
      die(`Cannot read patch: ${patchPath}: ${e}`);
    }
    const { sceneJson } = extractSceneString(md);
    const scene = parseScene(sceneJson);
    const out = applyPatchFile(md, scene, patchContent, patchPath);
    await writeFile(resolve(file), out, "utf8");
    console.error(`Patched ${file}`);
    return;
  }

  die(`Unknown command: ${cmd}\n${usage()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
