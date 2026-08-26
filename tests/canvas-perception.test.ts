import { describe, expect, it } from "vitest";
import { buildCanvasPerception } from "../src/client/canvasPerception";
import type { CanvasEvent, VectorPrimitive } from "../src/shared/game";

function event(primitive: VectorPrimitive, canvasVersion: number, roundIndex = 0): CanvasEvent {
  return {
    id: `event-${canvasVersion}`,
    batchId: `batch-${canvasVersion}`,
    canvasVersion,
    roundIndex,
    seatId: "artist",
    origin: "webmcp",
    createdAt: canvasVersion,
    primitive,
  };
}

describe("portable canvas perception", () => {
  it("renders a deterministic, bounded 32 by 22 text raster", () => {
    const perception = buildCanvasPerception([
      event({ type: "line", x1: 50, y1: 50, x2: 950, y2: 650, color: "ink", width: 7 }, 1),
      event({ type: "ellipse", cx: 500, cy: 350, rx: 150, ry: 100, color: "cobalt", width: 12, fill: "sun" }, 2),
    ], 0);

    expect(perception).toMatchObject({ format: "ascii-raster-v1", width: 32, height: 22 });
    expect(perception.rows).toHaveLength(22);
    expect(perception.rows.every((row) => row.length === 32)).toBe(true);
    expect(perception.rows.join("")).toMatch(/#/);
    expect(perception.rows.join("")).toMatch(/B/);
    expect(perception.rows.join("")).toMatch(/Y/);
    expect(perception.coverage).toBeGreaterThan(0);
    expect(JSON.stringify(perception).length).toBeLessThan(1_500);
    expect(buildCanvasPerception([
      event({ type: "ellipse", cx: 500, cy: 350, rx: 150, ry: 100, color: "cobalt", width: 12, fill: "sun" }, 2),
      event({ type: "line", x1: 50, y1: 50, x2: 950, y2: 650, color: "ink", width: 7 }, 1),
    ], 0)).toEqual(perception);
  });

  it("represents every supported primitive and respects the current round", () => {
    const primitives: VectorPrimitive[] = [
      { type: "polyline", points: [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 100 }], color: "coral", width: 5 },
      { type: "rectangle", x: 350, y: 100, rectWidth: 180, rectHeight: 140, color: "leaf", width: 7, fill: "sun" },
      { type: "arc", cx: 700, cy: 200, radius: 100, startAngle: -90, endAngle: 180, color: "cobalt", width: 12 },
      { type: "polygon", points: [{ x: 150, y: 450 }, { x: 300, y: 600 }, { x: 50, y: 600 }], color: "ink", width: 7, fill: "coral" },
    ];
    const wrongRound = event({ type: "line", x1: 0, y1: 350, x2: 1000, y2: 350, color: "leaf", width: 20 }, 99, 1);
    const perception = buildCanvasPerception([
      wrongRound,
      ...primitives.map((primitive, index) => event(primitive, index + 1)),
    ], 0);
    const rendered = perception.rows.join("");

    expect(rendered).toMatch(/C/);
    expect(rendered).toMatch(/G/);
    expect(rendered).toMatch(/Y/);
    expect(rendered).toMatch(/B/);
    expect(rendered).toMatch(/#/);
    expect(perception.bounds).not.toBeNull();
  });

  it("applies later paper strokes as erasure", () => {
    const filled = event({
      type: "rectangle",
      x: 200,
      y: 150,
      rectWidth: 600,
      rectHeight: 400,
      color: "cobalt",
      width: 20,
      fill: "cobalt",
    }, 1);
    const erased = event({ type: "line", x1: 500, y1: 100, x2: 500, y2: 600, color: "paper", width: 20 }, 2);
    const before = buildCanvasPerception([filled], 0);
    const after = buildCanvasPerception([filled, erased], 0);

    expect(after.occupiedCells).toBeLessThan(before.occupiedCells);
    expect(after.rows.some((row) => row.includes("."))).toBe(true);
  });

  it("returns an empty paper raster without leaking other-round marks", () => {
    const perception = buildCanvasPerception([
      event({ type: "line", x1: 0, y1: 0, x2: 1000, y2: 700, color: "ink", width: 20 }, 1, 2),
    ], 3);

    expect(perception.occupiedCells).toBe(0);
    expect(perception.coverage).toBe(0);
    expect(perception.bounds).toBeNull();
    expect(perception.rows.every((row) => row === ".".repeat(32))).toBe(true);
  });
});
