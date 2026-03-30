import { describe, expect, it } from "vitest";
import { applyPatchToScene } from "../src/patch.js";
import type { ExcalidrawElement, ExcalidrawScene } from "../src/scene.js";

describe("applyPatchToScene", () => {
  it("adds rectangle relative to anchor", () => {
    const anchor: ExcalidrawElement = {
      id: "anchor01",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      isDeleted: false,
      groupIds: [],
    };
    const scene: ExcalidrawScene = { elements: [anchor] };
    const md = "## Text Elements\n\n## Drawing\n```compressed-json\nx\n```\n";
    const { scene: next } = applyPatchToScene(scene, {
      add: [
        {
          type: "rectangle",
          ref: "anchor01",
          place: "below",
          gap: 10,
          width: 30,
          height: 20,
          id: "newrect1",
        },
      ],
    }, md);
    const added = next.elements.find((e) => e.id === "newrect1");
    expect(added).toBeDefined();
    expect(added!.type).toBe("rectangle");
    expect(added!.y).toBe(100 + 50 + 10);
    expect(added!.x).toBe(100);
  });
});
