import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  PALETTE,
  STROKE_WIDTHS,
  type CanvasEvent,
  type PaletteColor,
  type Point,
  type StrokeWidth,
  type VectorPrimitive,
} from "../../shared/game";
import { arcPath, COLOR_VALUES, pointsAttribute } from "../../shared/format";
import {
  EllipseIcon,
  EraserIcon,
  LineIcon,
  PenToolIcon,
  RectangleIcon,
  UndoIcon,
} from "./Icons";

export type DrawTool = "pen" | "line" | "ellipse" | "rectangle" | "eraser";

interface CanvasBoardProps {
  events: CanvasEvent[];
  canvasVersion: number;
  canDraw: boolean;
  busy?: boolean;
  artistLabel?: string;
  onDraw(primitives: VectorPrimitive[]): Promise<void>;
  onUndo(): Promise<void>;
}

interface Gesture {
  pointerId: number;
  start: Point;
  points: Point[];
}

const toolOptions: Array<{
  id: DrawTool;
  label: string;
  icon: typeof PenToolIcon;
  shortcut: string;
}> = [
  { id: "pen", label: "Pen", icon: PenToolIcon, shortcut: "P" },
  { id: "line", label: "Line", icon: LineIcon, shortcut: "L" },
  { id: "ellipse", label: "Ellipse", icon: EllipseIcon, shortcut: "O" },
  { id: "rectangle", label: "Rectangle", icon: RectangleIcon, shortcut: "R" },
  { id: "eraser", label: "Eraser", icon: EraserIcon, shortcut: "E" },
];

export function CanvasBoard({
  events,
  canvasVersion,
  canDraw,
  busy = false,
  artistLabel,
  onDraw,
  onUndo,
}: CanvasBoardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [color, setColor] = useState<PaletteColor>("ink");
  const [strokeWidth, setStrokeWidth] = useState<StrokeWidth>(7);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const animatedEvents = useMemo(() => {
    const batchPositions = new Map<string, number>();
    return events.map((event) => {
      const position = batchPositions.get(event.batchId) ?? 0;
      batchPositions.set(event.batchId, position + 1);
      return { event, delayMs: event.origin === "webmcp" ? Math.min(position, 11) * 115 : 0 };
    });
  }, [events]);
  const draft = useMemo(
    () =>
      gesture
        ? makePrimitive(tool, gesture.start, gesture.points.at(-1) ?? gesture.start, gesture.points, color, strokeWidth)
        : null,
    [color, gesture, strokeWidth, tool],
  );

  useEffect(() => {
    if (!canDraw) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (!busy && !localBusy && events.length) void onUndo();
        return;
      }
      const shortcut: Partial<Record<string, DrawTool>> = { p: "pen", l: "line", o: "ellipse", r: "rectangle", e: "eraser" };
      const selected = shortcut[event.key.toLowerCase()];
      if (selected) setTool(selected);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, canDraw, events.length, localBusy, onUndo]);

  const pointFromPointer = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clampAxis(((event.clientX - bounds.left) / bounds.width) * CANVAS_WIDTH, CANVAS_WIDTH),
      y: clampAxis(((event.clientY - bounds.top) / bounds.height) * CANVAS_HEIGHT, CANVAS_HEIGHT),
    };
  };

  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!canDraw || busy || localBusy || event.button !== 0) return;
    const point = pointFromPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ pointerId: event.pointerId, start: point, points: [point] });
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const next = pointFromPointer(event);
    const previous = gesture.points.at(-1);
    if (previous && distance(previous, next) < 2.2) return;
    setGesture((current) =>
      current ? { ...current, points: [...current.points, next].slice(-240) } : current,
    );
  };

  const finish = async (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const end = pointFromPointer(event);
    const primitive = makePrimitive(
      tool,
      gesture.start,
      end,
      [...gesture.points, end],
      color,
      strokeWidth,
    );
    setGesture(null);
    if (!primitive) return;
    setLocalBusy(true);
    try {
      await onDraw([primitive]);
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <section className="canvas-shell" aria-label="Drawing canvas">
      <div className="canvas-toolbar" aria-label="Drawing tools">
        <div className="tool-cluster" role="group" aria-label="Tool">
          {toolOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                className={`icon-button ${tool === option.id ? "is-active" : ""}`}
                type="button"
                onClick={() => setTool(option.id)}
                disabled={!canDraw || busy}
                title={`${option.label} (${option.shortcut})`}
                aria-label={option.label}
                aria-pressed={tool === option.id}
              >
                <Icon />
              </button>
            );
          })}
        </div>
        <div className="toolbar-separator" />
        <div className="palette" role="group" aria-label="Ink color">
          {PALETTE.filter((entry) => entry !== "paper").map((entry) => (
            <button
              key={entry}
              type="button"
              className={`swatch ${color === entry && tool !== "eraser" ? "is-active" : ""}`}
              style={{ "--swatch": COLOR_VALUES[entry] } as React.CSSProperties}
              onClick={() => {
                setColor(entry);
                if (tool === "eraser") setTool("pen");
              }}
              disabled={!canDraw || busy}
              aria-label={`${entry} ink`}
              aria-pressed={color === entry && tool !== "eraser"}
            />
          ))}
        </div>
        <div className="toolbar-separator" />
        <label className="width-control">
          <span className="sr-only">Stroke width</span>
          <select
            value={strokeWidth}
            onChange={(event) => setStrokeWidth(Number(event.target.value) as StrokeWidth)}
            disabled={!canDraw || busy}
            aria-label="Stroke width"
          >
            {STROKE_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {width === 3 ? "Fine" : width === 7 ? "Regular" : width === 12 ? "Bold" : "Chunky"}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button undo-button"
          type="button"
          onClick={() => void onUndo()}
          disabled={!canDraw || busy || events.length === 0}
          title="Undo last batch"
          aria-label="Undo last batch"
        >
          <UndoIcon />
        </button>
        <div className="canvas-version" title="Authoritative canvas version">
          v{canvasVersion}
        </div>
      </div>

      <div className={`paper-frame ${canDraw ? "can-draw" : ""}`}>
        <svg
          ref={svgRef}
          className="drawing-canvas"
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          role="img"
          aria-label={canDraw ? "Draw here" : `Watching ${artistLabel ?? "the artist"} draw`}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={(event) => void finish(event)}
          onPointerCancel={() => setGesture(null)}
        >
          <defs>
            <pattern id="dot-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.4" fill="#1d2230" opacity=".055" />
            </pattern>
            <filter id="ink-soften" x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale=".45" />
            </filter>
          </defs>
          <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#fffdf7" rx="18" />
          <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#dot-grid)" rx="18" />
          <g className="canonical-ink" filter="url(#ink-soften)">
            {animatedEvents.map(({ event, delayMs }) => (
              <PrimitiveMark key={event.id} primitive={event.primitive} origin={event.origin} delayMs={delayMs} />
            ))}
            {draft ? <PrimitiveMark primitive={draft} origin="human-ui" draft /> : null}
          </g>
        </svg>
        {!canDraw && events.length === 0 ? (
          <div className="empty-canvas-note" aria-hidden="true">
            <span className="pencil-scribble">✎</span>
            <strong>{artistLabel ? `${artistLabel} is thinking…` : "Waiting for the first stroke…"}</strong>
            <small>Agent geometry animates here as it arrives.</small>
          </div>
        ) : null}
        {(busy || localBusy) && <div className="ink-saving">inking…</div>}
      </div>
    </section>
  );
}

export function PrimitiveMark({
  primitive,
  origin,
  draft = false,
  delayMs = 0,
}: {
  primitive: VectorPrimitive;
  origin: CanvasEvent["origin"];
  draft?: boolean;
  delayMs?: number;
}) {
  const shared = {
    stroke: COLOR_VALUES[primitive.color],
    strokeWidth: primitive.width,
    fill: primitive.fill ? COLOR_VALUES[primitive.fill] : "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
    className: `${draft ? "draft-mark" : "ink-mark"} origin-${origin}`,
    style: delayMs ? { animationDelay: `${delayMs}ms` } : undefined,
  };

  switch (primitive.type) {
    case "line":
      return <line {...shared} x1={primitive.x1} y1={primitive.y1} x2={primitive.x2} y2={primitive.y2} />;
    case "polyline":
      return <polyline {...shared} points={pointsAttribute(primitive.points)} />;
    case "ellipse":
      return <ellipse {...shared} cx={primitive.cx} cy={primitive.cy} rx={primitive.rx} ry={primitive.ry} />;
    case "rectangle":
      return (
        <rect
          {...shared}
          x={primitive.x}
          y={primitive.y}
          width={primitive.rectWidth}
          height={primitive.rectHeight}
          rx={primitive.radius ?? 0}
        />
      );
    case "arc":
      return <path {...shared} d={arcPath(primitive)} />;
    case "polygon":
      return <polygon {...shared} points={pointsAttribute(primitive.points)} />;
  }
}

function makePrimitive(
  tool: DrawTool,
  start: Point,
  end: Point,
  rawPoints: Point[],
  color: PaletteColor,
  width: StrokeWidth,
): VectorPrimitive | null {
  const activeColor = tool === "eraser" ? "paper" : color;
  const activeWidth: StrokeWidth = tool === "eraser" ? 20 : width;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const movement = Math.hypot(dx, dy);
  if (movement < 2) return null;

  if (tool === "pen" || tool === "eraser") {
    const points = simplify(rawPoints, tool === "eraser" ? 2 : 1.7).slice(0, 48);
    if (points.length < 2) return null;
    return { type: "polyline", points, color: activeColor, width: activeWidth };
  }
  if (tool === "line") {
    return { type: "line", x1: start.x, y1: start.y, x2: end.x, y2: end.y, color, width };
  }
  if (tool === "ellipse") {
    return {
      type: "ellipse",
      cx: (start.x + end.x) / 2,
      cy: (start.y + end.y) / 2,
      rx: Math.max(1, Math.abs(dx) / 2),
      ry: Math.max(1, Math.abs(dy) / 2),
      color,
      width,
    };
  }
  return {
    type: "rectangle",
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    rectWidth: Math.max(1, Math.abs(dx)),
    rectHeight: Math.max(1, Math.abs(dy)),
    radius: 8,
    color,
    width,
  };
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return points;
  let maxDistance = 0;
  let index = 0;
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const candidate = points[cursor];
    if (!candidate) continue;
    const candidateDistance = perpendicularDistance(candidate, first, last);
    if (candidateDistance > maxDistance) {
      index = cursor;
      maxDistance = candidateDistance;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampAxis(value: number, maximum: number) {
  return Math.round(Math.max(0, Math.min(maximum, value)) * 10) / 10;
}
