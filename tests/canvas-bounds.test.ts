import { describe, expect, it } from "vitest";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  PrimitiveSchema,
  type VectorPrimitive,
} from "../src/shared/game";

const style = { color: "ink" as const, width: 7 as const };

function expectIssue(primitive: unknown, path: string): void {
  const result = PrimitiveSchema.safeParse(primitive);
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.some((issue) => issue.path.join(".") === path)).toBe(true);
}

describe("visible canvas bounds", () => {
  it("uses the full width for x and the shorter visible height for y", () => {
    const edgeLine: VectorPrimitive = {
      type: "line",
      x1: 0,
      y1: 0,
      x2: CANVAS_WIDTH,
      y2: CANVAS_HEIGHT,
      ...style,
    };
    expect(PrimitiveSchema.safeParse(edgeLine).success).toBe(true);
    expectIssue({ ...edgeLine, x2: CANVAS_WIDTH + 0.01 }, "x2");
    expectIssue({ ...edgeLine, y2: CANVAS_HEIGHT + 0.01 }, "y2");

    for (const type of ["polyline", "polygon"] as const) {
      const minimumPoints = type === "polyline"
        ? [{ x: 0, y: 0 }, { x: CANVAS_WIDTH, y: CANVAS_HEIGHT }]
        : [{ x: 0, y: 0 }, { x: CANVAS_WIDTH, y: 0 }, { x: 500, y: CANVAS_HEIGHT }];
      expect(PrimitiveSchema.safeParse({ type, points: minimumPoints, ...style }).success).toBe(true);
      expectIssue({
        type,
        points: minimumPoints.map((point, index) => index === 1
          ? { ...point, y: CANVAS_HEIGHT + 1 }
          : point),
        ...style,
      }, "points.1.y");
    }
  });

  it("accepts geometric centerlines exactly on the boundary", () => {
    const boundaryShapes: VectorPrimitive[] = [
      {
        type: "ellipse",
        cx: CANVAS_WIDTH / 2,
        cy: CANVAS_HEIGHT / 2,
        rx: CANVAS_WIDTH / 2,
        ry: CANVAS_HEIGHT / 2,
        ...style,
      },
      {
        type: "rectangle",
        x: 0,
        y: 0,
        rectWidth: CANVAS_WIDTH,
        rectHeight: CANVAS_HEIGHT,
        ...style,
      },
      {
        type: "arc",
        cx: CANVAS_WIDTH / 2,
        cy: CANVAS_HEIGHT / 2,
        radius: CANVAS_HEIGHT / 2,
        startAngle: -90,
        endAngle: 170,
        ...style,
      },
    ];

    for (const primitive of boundaryShapes) {
      expect(PrimitiveSchema.safeParse(primitive).success).toBe(true);
    }

    // Bounds apply to SVG geometry, not the painted stroke envelope. The canvas clips
    // half of a round stroke at an edge, so pointer input may still use x=0/y=700.
  });

  it("rejects ellipses whose radii cross any visible edge", () => {
    const ellipse = {
      type: "ellipse",
      cx: 500,
      cy: 350,
      rx: 100,
      ry: 80,
      ...style,
    };
    expectIssue({ ...ellipse, cx: 99, rx: 100 }, "rx");
    expectIssue({ ...ellipse, cx: 901, rx: 100 }, "rx");
    expectIssue({ ...ellipse, cy: 79, ry: 80 }, "ry");
    expectIssue({ ...ellipse, cy: 621, ry: 80 }, "ry");
  });

  it("rejects rectangles whose width or height crosses the visible edge", () => {
    const rectangle = {
      type: "rectangle",
      x: 800,
      y: 600,
      rectWidth: 200,
      rectHeight: 100,
      ...style,
    };
    expect(PrimitiveSchema.safeParse(rectangle).success).toBe(true);
    expectIssue({ ...rectangle, rectWidth: 201 }, "rectWidth");
    expectIssue({ ...rectangle, rectHeight: 101 }, "rectHeight");
  });

  it("keeps an arc's complete radius envelope on-canvas and rejects invisible sweeps", () => {
    const arc = {
      type: "arc",
      cx: 500,
      cy: 350,
      radius: 100,
      startAngle: 0,
      endAngle: 180,
      ...style,
    };
    expect(PrimitiveSchema.safeParse(arc).success).toBe(true);
    expectIssue({ ...arc, cx: 99 }, "radius");
    expectIssue({ ...arc, cy: 99 }, "radius");
    expectIssue({ ...arc, cx: 901 }, "radius");
    expectIssue({ ...arc, cy: 601 }, "radius");
    expectIssue({ ...arc, endAngle: 0 }, "endAngle");
    expectIssue({ ...arc, endAngle: 360 }, "endAngle");
  });

  it("rejects zero-length line, polyline, and polygon geometry", () => {
    expectIssue({ type: "line", x1: 20, y1: 20, x2: 20, y2: 20, ...style }, "x2");
    expectIssue({
      type: "polyline",
      points: [{ x: 20, y: 20 }, { x: 20, y: 20 }],
      ...style,
    }, "points");
    expectIssue({
      type: "polygon",
      points: [{ x: 20, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 20 }],
      ...style,
    }, "points");
    expectIssue({
      type: "polygon",
      points: [{ x: 20, y: 20 }, { x: 40, y: 40 }, { x: 20, y: 20 }],
      ...style,
    }, "points");
    expectIssue({
      type: "polygon",
      points: [{ x: 0, y: 0 }, { x: 500, y: 350 }, { x: 1000, y: 700 }],
      ...style,
    }, "points");
  });
});
