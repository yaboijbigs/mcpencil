import { z } from "zod";

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 700;
export const ROUND_DURATION_MS = 90_000;
export const ROUND_PREP_DURATION_MS = 8_000;
export const ROUND_RESULT_MIN_MS = 8_000;
export const ROUND_RESULT_MAX_MS = 15_000;
export const TEAM_ROUND_COUNT = 6;
export const MAX_BATCH_PRIMITIVES = 12;
export const FREE_FOR_ALL_MIN_PLAYERS = 3;
export const FREE_FOR_ALL_MAX_PLAYERS = 8;

export const PRACTICE_ROUND_OPTIONS = [2, 4, 6] as const;
export const ARENA_ROUND_OPTIONS = [4, 6, 8] as const;
export const ROUND_DURATION_OPTIONS_MS = [45_000, 60_000, 90_000] as const;

export const TEAM_IDS = ["cobalt", "coral"] as const;
export const CONTROLLER_TYPES = ["human", "agent"] as const;
export const ORIGINS = ["human-ui", "webmcp"] as const;
export const PALETTE = ["ink", "cobalt", "coral", "sun", "leaf", "paper"] as const;
export const STROKE_WIDTHS = [3, 5, 7, 12, 20] as const;

export type TeamId = (typeof TEAM_IDS)[number];
export type ControllerType = (typeof CONTROLLER_TYPES)[number];
export type ActionOrigin = (typeof ORIGINS)[number];
export type PaletteColor = (typeof PALETTE)[number];
export type StrokeWidth = (typeof STROKE_WIDTHS)[number];
export type RoomMode = "practice" | "arena" | "free-for-all";
export type MatchPhase = "lobby" | "round-prep" | "drawing" | "round-end" | "match-end";

const XCoordinate = z.number().finite().min(0).max(CANVAS_WIDTH);
const YCoordinate = z.number().finite().min(0).max(CANVAS_HEIGHT);
const HorizontalExtent = z.number().finite().min(1).max(CANVAS_WIDTH);
const VerticalExtent = z.number().finite().min(1).max(CANVAS_HEIGHT);
const ArcRadius = z.number().finite().min(1).max(Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) / 2);
const PaletteSchema = z.enum(PALETTE);
const StrokeWidthSchema = z.union([
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(12),
  z.literal(20),
]);
const PointSchema = z.object({ x: XCoordinate, y: YCoordinate }).strict();
const PrimitiveStyleSchema = z.object({
  color: PaletteSchema,
  width: StrokeWidthSchema,
  fill: PaletteSchema.optional(),
});

export const LinePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("line"),
  x1: XCoordinate,
  y1: YCoordinate,
  x2: XCoordinate,
  y2: YCoordinate,
}).strict().superRefine((primitive, context) => {
  if (primitive.x1 === primitive.x2 && primitive.y1 === primitive.y2) {
    context.addIssue({
      code: "custom",
      path: ["x2"],
      message: "A line must have two different endpoints.",
    });
  }
});

export const PolylinePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("polyline"),
  points: z.array(PointSchema).min(2).max(48),
}).strict().superRefine((primitive, context) => {
  if (!hasDistinctPoints(primitive.points)) {
    context.addIssue({
      code: "custom",
      path: ["points"],
      message: "A polyline must contain at least two different points.",
    });
  }
});

export const EllipsePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("ellipse"),
  cx: XCoordinate,
  cy: YCoordinate,
  rx: HorizontalExtent,
  ry: VerticalExtent,
}).strict().superRefine((primitive, context) => {
  if (primitive.cx - primitive.rx < 0 || primitive.cx + primitive.rx > CANVAS_WIDTH) {
    context.addIssue({
      code: "custom",
      path: ["rx"],
      message: `Ellipse horizontal extent must stay within 0-${CANVAS_WIDTH}.`,
    });
  }
  if (primitive.cy - primitive.ry < 0 || primitive.cy + primitive.ry > CANVAS_HEIGHT) {
    context.addIssue({
      code: "custom",
      path: ["ry"],
      message: `Ellipse vertical extent must stay within 0-${CANVAS_HEIGHT}.`,
    });
  }
});

export const RectanglePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("rectangle"),
  x: XCoordinate,
  y: YCoordinate,
  rectWidth: HorizontalExtent,
  rectHeight: VerticalExtent,
  radius: z.number().finite().min(0).max(100).optional(),
}).strict().superRefine((primitive, context) => {
  if (primitive.x + primitive.rectWidth > CANVAS_WIDTH) {
    context.addIssue({
      code: "custom",
      path: ["rectWidth"],
      message: `Rectangle horizontal extent must stay within 0-${CANVAS_WIDTH}.`,
    });
  }
  if (primitive.y + primitive.rectHeight > CANVAS_HEIGHT) {
    context.addIssue({
      code: "custom",
      path: ["rectHeight"],
      message: `Rectangle vertical extent must stay within 0-${CANVAS_HEIGHT}.`,
    });
  }
});

export const ArcPrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("arc"),
  cx: XCoordinate,
  cy: YCoordinate,
  radius: ArcRadius,
  startAngle: z.number().finite().min(-360).max(360),
  endAngle: z.number().finite().min(-360).max(720),
}).strict().superRefine((primitive, context) => {
  if (primitive.cx - primitive.radius < 0 || primitive.cx + primitive.radius > CANVAS_WIDTH) {
    context.addIssue({
      code: "custom",
      path: ["radius"],
      message: `Arc horizontal extent must stay within 0-${CANVAS_WIDTH}.`,
    });
  }
  if (primitive.cy - primitive.radius < 0 || primitive.cy + primitive.radius > CANVAS_HEIGHT) {
    context.addIssue({
      code: "custom",
      path: ["radius"],
      message: `Arc vertical extent must stay within 0-${CANVAS_HEIGHT}.`,
    });
  }
  if (Math.abs(primitive.endAngle - primitive.startAngle) % 360 === 0) {
    context.addIssue({
      code: "custom",
      path: ["endAngle"],
      message: "An arc must have distinct endpoints; use an ellipse for a full circle.",
    });
  }
});

export const PolygonPrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("polygon"),
  points: z.array(PointSchema).min(3).max(24),
}).strict().superRefine((primitive, context) => {
  if (distinctPointCount(primitive.points) < 3) {
    context.addIssue({
      code: "custom",
      path: ["points"],
      message: "A polygon must contain at least three different points.",
    });
  } else if (!hasNonZeroPolygonArea(primitive.points)) {
    context.addIssue({
      code: "custom",
      path: ["points"],
      message: "A polygon's points must not all be collinear.",
    });
  }
});

function hasDistinctPoints(points: ReadonlyArray<{ x: number; y: number }>): boolean {
  const first = points[0];
  return first !== undefined && points.some((point) => point.x !== first.x || point.y !== first.y);
}

function distinctPointCount(points: ReadonlyArray<{ x: number; y: number }>): number {
  return new Set(points.map((point) => `${point.x},${point.y}`)).size;
}

function hasNonZeroPolygonArea(points: ReadonlyArray<{ x: number; y: number }>): boolean {
  let twiceSignedArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) return false;
    twiceSignedArea += current.x * next.y - next.x * current.y;
  }
  return twiceSignedArea !== 0;
}

export const PrimitiveSchema = z.discriminatedUnion("type", [
  LinePrimitiveSchema,
  PolylinePrimitiveSchema,
  EllipsePrimitiveSchema,
  RectanglePrimitiveSchema,
  ArcPrimitiveSchema,
  PolygonPrimitiveSchema,
]);

export type Point = z.infer<typeof PointSchema>;
export type VectorPrimitive = z.infer<typeof PrimitiveSchema>;

export interface Seat {
  id: string;
  name: string;
  team: TeamId;
  controller: ControllerType;
  isHost: boolean;
  isReady: boolean;
  isConnected: boolean;
  score: number;
}

export interface PlayerStanding {
  seatId: string;
  name: string;
  controller: ControllerType;
  score: number;
  placement: number;
  successfulDrawings: number;
  correctGuesses: number;
  fastestSolveMs: number | null;
  averageSolveMs: number | null;
}

export interface CanvasEvent {
  id: string;
  batchId: string;
  canvasVersion: number;
  roundIndex: number;
  seatId: string;
  origin: ActionOrigin;
  createdAt: number;
  primitive: VectorPrimitive;
}

export interface GuessEvent {
  id: string;
  roundIndex: number;
  seatId: string;
  displayName: string;
  guess: string;
  origin: ActionOrigin;
  isCorrect: boolean;
  createdAt: number;
}

export interface ActivityEvent {
  id: string;
  kind: "human-action" | "tool-call" | "role-change" | "system";
  label: string;
  detail: string;
  seatId?: string;
  origin?: ActionOrigin;
  canvasVersion: number;
  createdAt: number;
}

export interface RoundResult {
  roundIndex: number;
  prompt: string;
  artistSeatId: string;
  team: TeamId;
  guessedBySeatId?: string;
  pointsAwarded: number;
  artistPointsAwarded?: number;
  guesserPointsAwarded?: number;
  elapsedMs: number;
  strokeCount: number;
  toolCallCount: number;
}

export interface MatchAnalytics {
  totalStrokes: number;
  totalToolCalls: number;
  correctGuesses: number;
  averageGuessMs: number | null;
  byOrigin: Record<ActionOrigin, number>;
}

export interface RoomSnapshot {
  roomCode: string;
  mode: RoomMode;
  phase: MatchPhase;
  revision: number;
  roundIndex: number;
  totalRounds: number;
  roundDurationMs: number;
  activeTeam: TeamId;
  artistSeatId: string | null;
  endsAt: number | null;
  canvasVersion: number;
  scores: Record<TeamId, number>;
  leaderboard?: PlayerStanding[];
  seats: Seat[];
  canvas: CanvasEvent[];
  guesses: GuessEvent[];
  activity: ActivityEvent[];
  roundResult: RoundResult | null;
  analytics: MatchAnalytics;
}

export interface PrivatePrompt {
  prompt: string;
  category: string;
  roundIndex: number;
}

export const PlayerNameSchema = z.string().trim().min(1).max(24);
export const RoomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{5}$/);
export const SeatTokenSchema = z.string().min(32).max(256);
export const TeamSchema = z.enum(TEAM_IDS);
export const ControllerSchema = z.enum(CONTROLLER_TYPES);
export const OriginSchema = z.enum(ORIGINS);
export const ModeSchema = z.enum(["practice", "arena", "free-for-all"]);

export const CreateRoomRequestSchema = z.object({
  name: PlayerNameSchema,
  mode: ModeSchema.default("arena"),
  controller: ControllerSchema.default("human"),
}).strict();

export const JoinRoomRequestSchema = z.object({
  name: PlayerNameSchema,
  team: TeamSchema.optional(),
  controller: ControllerSchema.default("human"),
}).strict();

const ReadyCommandSchema = z.object({
  type: z.literal("ready_up"),
  ready: z.boolean(),
  origin: OriginSchema,
}).strict();

const ConfigureSeatCommandSchema = z.object({
  type: z.literal("configure_seat"),
  team: TeamSchema,
  controller: ControllerSchema,
}).strict();

const ConfigureMatchCommandSchema = z.object({
  type: z.literal("configure_match"),
  totalRounds: z.number().int(),
  roundDurationMs: z.number().int().refine(
    (value) => (ROUND_DURATION_OPTIONS_MS as readonly number[]).includes(value),
    { message: "Round duration must be 45, 60, or 90 seconds." },
  ),
  origin: OriginSchema,
}).strict();

const StartMatchCommandSchema = z.object({
  type: z.literal("start_match"),
  origin: OriginSchema,
}).strict();

export const DrawBatchCommandSchema = z.object({
  type: z.literal("draw_batch"),
  expectedVersion: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(80),
  primitives: z.array(PrimitiveSchema).min(1).max(MAX_BATCH_PRIMITIVES),
  origin: OriginSchema,
}).strict();

const UndoDrawBatchCommandSchema = z.object({
  type: z.literal("undo_draw_batch"),
  expectedVersion: z.number().int().min(0),
  origin: OriginSchema,
}).strict();

const SubmitGuessCommandSchema = z.object({
  type: z.literal("submit_guess"),
  guess: z.string().trim().min(1).max(80),
  origin: OriginSchema,
}).strict();

const ReadyNextCommandSchema = z.object({
  type: z.literal("ready_next"),
  expectedRoundIndex: z.number().int().min(0),
  origin: OriginSchema,
}).strict();

export const RoomCommandSchema = z.discriminatedUnion("type", [
  ReadyCommandSchema,
  ConfigureSeatCommandSchema,
  ConfigureMatchCommandSchema,
  StartMatchCommandSchema,
  DrawBatchCommandSchema,
  UndoDrawBatchCommandSchema,
  SubmitGuessCommandSchema,
  ReadyNextCommandSchema,
]);

export type RoomCommand = z.infer<typeof RoomCommandSchema>;

export const CommandEnvelopeSchema = z.object({
  token: SeatTokenSchema,
  command: RoomCommandSchema,
}).strict();

export interface SeatCredentials {
  roomCode: string;
  seatId: string;
  token: string;
}

export interface JoinRoomResponse extends SeatCredentials {
  snapshot: RoomSnapshot;
}

export interface CommandResult {
  accepted: true;
  revision: number;
  canvasVersion: number;
  remainingMs: number | null;
  batchId?: string;
  correct?: boolean;
  close?: boolean;
  pointsAwarded?: number;
  duplicate?: boolean;
}

export interface ApiFailure {
  error: string;
  code: string;
  issues?: Array<{ path: string; message: string }>;
}

export type ServerEvent =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "presence"; seatId: string; connected: boolean }
  | { type: "error"; code: string; message: string };

export function isArtist(snapshot: RoomSnapshot, seatId: string | null): boolean {
  return seatId !== null
    && snapshot.artistSeatId === seatId
    && (snapshot.phase === "round-prep" || snapshot.phase === "drawing");
}

export function canGuess(snapshot: RoomSnapshot, seatId: string | null): boolean {
  if (seatId === null || snapshot.phase !== "drawing") return false;
  return isEligibleGuesser(snapshot, seatId);
}

export function isEligibleGuesser(snapshot: RoomSnapshot, seatId: string | null): boolean {
  if (seatId === null || seatId === snapshot.artistSeatId) return false;
  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  if (seat === undefined) return false;
  return snapshot.mode === "free-for-all" || seat.team === snapshot.activeTeam;
}
