import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type CanvasEvent,
  type PaletteColor,
  type Point,
  type VectorPrimitive,
} from "../shared/game";

export const PERCEPTION_GRID_WIDTH = 32;
export const PERCEPTION_GRID_HEIGHT = 22;

const CELL_WIDTH = CANVAS_WIDTH / PERCEPTION_GRID_WIDTH;
const CELL_HEIGHT = CANVAS_HEIGHT / PERCEPTION_GRID_HEIGHT;
const CELL_TOLERANCE = Math.hypot(CELL_WIDTH, CELL_HEIGHT) / 2;

const COLOR_SYMBOLS: Record<PaletteColor, string> = {
  ink: "#",
  cobalt: "B",
  coral: "C",
  sun: "Y",
  leaf: "G",
  paper: ".",
};

export interface CanvasPerception {
  format: "ascii-raster-v1";
  width: typeof PERCEPTION_GRID_WIDTH;
  height: typeof PERCEPTION_GRID_HEIGHT;
  orientation: "rows top-to-bottom; columns left-to-right";
  legend: ".=paper #=ink B=cobalt C=coral Y=sun G=leaf";
  rows: string[];
  occupiedCells: number;
  coverage: number;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}

/** A small deterministic rendering aid for WebMCP clients without reliable page vision. */
export function buildCanvasPerception(
  events: readonly CanvasEvent[],
  roundIndex: number,
): CanvasPerception {
  const cells = Array.from(
    { length: PERCEPTION_GRID_HEIGHT },
    () => Array.from({ length: PERCEPTION_GRID_WIDTH }, () => "."),
  );
  const currentRound = events
    .filter((event) => event.roundIndex === roundIndex)
    .toSorted((left, right) => left.canvasVersion - right.canvasVersion || left.createdAt - right.createdAt);

  for (const event of currentRound) {
    paintPrimitive(cells, event.primitive);
  }

  const rows = cells.map((row) => row.join(""));
  const occupied: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < PERCEPTION_GRID_HEIGHT; y += 1) {
    for (let x = 0; x < PERCEPTION_GRID_WIDTH; x += 1) {
      if (cells[y]?.[x] !== ".") occupied.push({ x, y });
    }
  }

  const bounds = occupied.length === 0
    ? null
    : {
        left: Math.min(...occupied.map(({ x }) => x)),
        top: Math.min(...occupied.map(({ y }) => y)),
        right: Math.max(...occupied.map(({ x }) => x)),
        bottom: Math.max(...occupied.map(({ y }) => y)),
      };

  return {
    format: "ascii-raster-v1",
    width: PERCEPTION_GRID_WIDTH,
    height: PERCEPTION_GRID_HEIGHT,
    orientation: "rows top-to-bottom; columns left-to-right",
    legend: ".=paper #=ink B=cobalt C=coral Y=sun G=leaf",
    rows,
    occupiedCells: occupied.length,
    coverage: Math.round((occupied.length / (PERCEPTION_GRID_WIDTH * PERCEPTION_GRID_HEIGHT)) * 1000) / 1000,
    bounds,
  };
}

function paintPrimitive(cells: string[][], primitive: VectorPrimitive) {
  const strokeSymbol = COLOR_SYMBOLS[primitive.color];
  const fillSymbol = primitive.fill === undefined ? null : COLOR_SYMBOLS[primitive.fill];
  const strokeTolerance = CELL_TOLERANCE + primitive.width / 2;

  for (let row = 0; row < PERCEPTION_GRID_HEIGHT; row += 1) {
    for (let column = 0; column < PERCEPTION_GRID_WIDTH; column += 1) {
      const point = {
        x: (column + 0.5) * CELL_WIDTH,
        y: (row + 0.5) * CELL_HEIGHT,
      };
      if (fillSymbol !== null && isInsideFill(point, primitive)) {
        cells[row]![column] = fillSymbol;
      }
      if (isOnStroke(point, primitive, strokeTolerance)) {
        cells[row]![column] = strokeSymbol;
      }
    }
  }
}

function isInsideFill(point: Point, primitive: VectorPrimitive): boolean {
  switch (primitive.type) {
    case "line":
    case "arc":
      return false;
    case "polyline":
    case "polygon":
      return pointInPolygon(point, primitive.points);
    case "ellipse": {
      const dx = (point.x - primitive.cx) / primitive.rx;
      const dy = (point.y - primitive.cy) / primitive.ry;
      return dx * dx + dy * dy <= 1;
    }
    case "rectangle":
      return point.x >= primitive.x
        && point.x <= primitive.x + primitive.rectWidth
        && point.y >= primitive.y
        && point.y <= primitive.y + primitive.rectHeight;
  }
}

function isOnStroke(point: Point, primitive: VectorPrimitive, tolerance: number): boolean {
  switch (primitive.type) {
    case "line":
      return distanceToSegment(point, { x: primitive.x1, y: primitive.y1 }, { x: primitive.x2, y: primitive.y2 }) <= tolerance;
    case "polyline":
      return pathSegments(primitive.points, false).some(([start, end]) => distanceToSegment(point, start, end) <= tolerance);
    case "polygon":
      return pathSegments(primitive.points, true).some(([start, end]) => distanceToSegment(point, start, end) <= tolerance);
    case "ellipse": {
      const dx = (point.x - primitive.cx) / primitive.rx;
      const dy = (point.y - primitive.cy) / primitive.ry;
      const normalizedDistance = Math.hypot(dx, dy);
      return Math.abs(normalizedDistance - 1) * Math.min(primitive.rx, primitive.ry) <= tolerance;
    }
    case "rectangle": {
      const corners: Point[] = [
        { x: primitive.x, y: primitive.y },
        { x: primitive.x + primitive.rectWidth, y: primitive.y },
        { x: primitive.x + primitive.rectWidth, y: primitive.y + primitive.rectHeight },
        { x: primitive.x, y: primitive.y + primitive.rectHeight },
      ];
      return pathSegments(corners, true).some(([start, end]) => distanceToSegment(point, start, end) <= tolerance);
    }
    case "arc": {
      const radialDistance = Math.hypot(point.x - primitive.cx, point.y - primitive.cy);
      if (Math.abs(radialDistance - primitive.radius) > tolerance) return false;
      const angle = normalizeDegrees(Math.atan2(point.x - primitive.cx, primitive.cy - point.y) * 180 / Math.PI);
      const start = normalizeDegrees(primitive.startAngle);
      const rawSpan = primitive.endAngle - primitive.startAngle;
      const span = Math.abs(rawSpan) % 360;
      const traveled = rawSpan >= 0
        ? normalizeDegrees(angle - start)
        : normalizeDegrees(start - angle);
      const angularTolerance = Math.min(30, (tolerance / primitive.radius) * 180 / Math.PI);
      return traveled <= span + angularTolerance;
    }
  }
}

function pathSegments(points: readonly Point[], closed: boolean): Array<[Point, Point]> {
  const segments: Array<[Point, Point]> = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start && end) segments.push([start, end]);
  }
  if (closed && points.length > 2 && points[0] && points.at(-1)) {
    segments.push([points.at(-1)!, points[0]]);
  }
  return segments;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    if (!a || !b) continue;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
