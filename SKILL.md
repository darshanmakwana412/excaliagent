---
name: excaliagent
description: Read and edit Obsidian Excalidraw drawings in .md via excaliagent CLI (compressed-json scenes, Text Elements sync).
---

# excaliagent

CLI for working with **Obsidian Excalidraw** markdown files: list structure without dumping full JSON, fetch per-element metadata, and apply edits using **relative placement** (below / above / left-of / right-of) instead of raw coordinates.

## Installation

From the package directory (or after `npm link`):

```bash
cd /path/to/excaliagent
npm install && npm run build
```

The binary is `excaliagent` if linked, otherwise:

```bash
node /path/to/excaliagent/dist/cli.js <command> ...
```

Requires **Node.js 18+**.

## Quick start

```bash
# High-level view (types, groups, text ids, arrows, relations)
excaliagent summary ./notes/diagram.md

# YAML instead of JSON
excaliagent summary ./notes/diagram.md --yaml

# Full JSON for one element (default one line; --json to pretty-print)
excaliagent element ./notes/diagram.md qHt0AfEn --json

# Full scene (escape hatch)
excaliagent scene ./notes/diagram.md --no-pretty > scene.json

# Rename / change a text label (updates markdown + JSON)
excaliagent text set ./notes/diagram.md qHt0AfEn "Pretrained Audio Encoder"

# Add shapes with a patch file
excaliagent apply-patch ./notes/diagram.md ./patch.yaml
```

## Commands

### Read

```bash
excaliagent summary <file.md> [--yaml]
```

Outputs JSON (default) or YAML: element counts by type, **groups** (shared `groupIds`), **frames**, **texts** with `markdownLabel` from `## Text Elements`, **arrows** with `start`/`end` bindings, and **relations** (heuristic above/below/left-of/right-of/inside). Raw coordinates are omitted here on purpose; use `element` or `scene` when needed.

```bash
excaliagent element <file.md> <element-id> [--json]
```

Prints all stored fields for the element, plus `markdownLabel` (if any) and `derivedBBox` (axis-aligned; **rotation ignored**).

```bash
excaliagent scene <file.md> [--no-pretty]
```

Prints the full decompressed Excalidraw scene JSON. Default is pretty-printed; `--no-pretty` for a single line.

### Write

```bash
excaliagent text set <file.md> <element-id> "new text"
```

Updates **both** the `## Text Elements` line (`label ^id`) and the JSON `text` / `originalText` for that id. **Required** for Obsidian: on load, markdown text overrides JSON.

```bash
excaliagent apply-patch <file.md> <patch.yaml|.json>
```

Applies an `add:` list. Supported `type` values: `rectangle`, `ellipse`, `arrow`, `text`.

### Positioning (all shape types)

Three modes — use whichever fits:

| Mode | Fields | Behavior |
|------|--------|----------|
| **Relative** | `ref` + `place` + `gap` | Centered relative to anchor element |
| **Absolute** | `x` + `y` | Pixel coordinates in canvas space |
| **Origin** | _(none)_ | Places at (0, 0) |

`place` values: `below` | `above` | `left-of` | `right-of`. New elements are **centered** on the relevant axis relative to the anchor.

### Rectangle / Ellipse

Optional: `width`, `height`, `id`, `label`, `fontSize`.

- **`label`**: creates a **bound text element** auto-centered inside the shape. This is the correct way to put text inside a box — never create a separate text element manually for this.
- **Style overrides**: `backgroundColor`, `strokeColor`, `strokeWidth`, `strokeStyle`, `fillStyle`, `roughness`, `opacity`, `roundness`.

### Arrow

`from` and `to` element ids (aliases: `start` / `end`).

- **`fromEdge` / `toEdge`**: `top` | `bottom` | `left` | `right` — specify which edge of the element to connect to. If omitted, auto-detected based on relative positions.
- **`endArrowhead`**: defaults to `"arrow"`. Set to `null` for no arrowhead.
- `startArrowhead` defaults to `null` (one-way arrow).

### Text

`text` or `label`, optional positioning, `fontSize`, `textAlign`. Also appends a line under `## Text Elements`.

### Example `patch.yaml`

```yaml
add:
  # Absolute positioned rectangle with label
  - type: rectangle
    id: boxA0000
    x: 100
    y: 200
    width: 180
    height: 60
    backgroundColor: "#d5e8d4"
    label: "Scale"

  # Relative positioned rectangle
  - type: rectangle
    id: boxB0000
    ref: boxA0000
    place: below
    gap: 30
    width: 180
    height: 60
    label: "MatMul"

  # Arrow with auto edge detection
  - type: arrow
    from: boxA0000
    to: boxB0000

  # Arrow with explicit edges
  - type: arrow
    from: boxA0000
    to: boxC0000
    fromEdge: right
    toEdge: left

  # Standalone text
  - type: text
    text: "Q"
    ref: boxB0000
    place: below
    gap: 20
    fontSize: 22
```

```bash
excaliagent help
```

## Agent workflow

1. Run **`summary`** on the vault note path to get ids, types, and rough layout relations.
2. For geometry, styling, or bindings, run **`element <id>`** (or **`scene`** for the full graph).
3. Apply changes with **`text set`** for labels or **`apply-patch`** for new shapes/arrows/text.
4. Run **`summary`** again to confirm structure.

### Critical Obsidian behavior

- **`## Text Elements` overrides JSON text** when the note is opened in Obsidian. Never change only the JSON for a text element if that section exists; use `text set` or ensure patch-added text rows exist in `## Text Elements` (automatic for `add` → `text`).

### Limitations

- **Relations** in `summary` are heuristics (axis-aligned boxes; rotated elements are approximate).
- **Freedraw**, complex **images/embeddables**, and **collaboration version** conflicts are not handled specially.
- New elements use sensible defaults; opening once in Excalidraw may normalize ordering or bindings.

## Copy as Cursor skill

Place this file (or a symlink) under your Cursor skills path, e.g. `~/.cursor/skills-cursor/excaliagent/SKILL.md`, so the agent loads it when editing Excalidraw-backed notes.
