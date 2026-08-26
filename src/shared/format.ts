import type { VectorPrimitive } from "./game";

export const COLOR_VALUES = {
  ink: "#17191d",
  cobalt: "#3157d5",
  coral: "#ef654f",
  sun: "#f2bd35",
  leaf: "#3c9a67",
  paper: "#fffdf7",
} as const;

export function arcPath(primitive: Extract<VectorPrimitive, { type: "arc" }>): string {
  const start = polarPoint(primitive.cx, primitive.cy, primitive.radius, primitive.startAngle);
  const end = polarPoint(primitive.cx, primitive.cy, primitive.radius, primitive.endAngle);
  const span = Math.abs(primitive.endAngle - primitive.startAngle);
  const largeArc = span % 360 > 180 ? 1 : 0;
  const sweep = primitive.endAngle >= primitive.startAngle ? 1 : 0;
  return `M ${start.x} ${start.y} A ${primitive.radius} ${primitive.radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
}

function polarPoint(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

export function pointsAttribute(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function remainingSeconds(endsAt: number | null, now = Date.now()): number | null {
  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}
