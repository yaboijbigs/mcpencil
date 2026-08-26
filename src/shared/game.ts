import { z } from "zod";

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 700;
export const ROUND_DURATION_MS = 90_000;
export const TEAM_ROUND_COUNT = 6;
export const MAX_BATCH_PRIMITIVES = 12;

export const TEAM_IDS = ["cobalt", "coral"] as const;
export const CONTROLLER_TYPES = ["human", "agent"] as const;
export const ORIGINS = ["human-ui", "webmcp"] as const;
export const PALETTE = ["ink", "cobalt", "coral", "sun", "leaf", "paper"] as const;
export const STROKE_WIDTHS = [3, 7, 12, 20] as const;

export type TeamId = (typeof TEAM_IDS)[number];
export type ControllerType = (typeof CONTROLLER_TYPES)[number];
export type ActionOrigin = (typeof ORIGINS)[number];
export type PaletteColor = (typeof PALETTE)[number];
export type StrokeWidth = (typeof STROKE_WIDTHS)[number];
export type RoomMode = "practice" | "arena" | "exhibition";
export type MatchPhase = "lobby" | "drawing" | "round-end" | "match-end";

const Coordinate = z.number().finite().min(0).max(1000);
const Radius = z.number().finite().min(1).max(1000);
const PaletteSchema = z.enum(PALETTE);
const StrokeWidthSchema = z.union([
  z.literal(3),
  z.literal(7),
  z.literal(12),
  z.literal(20),
]);
const PointSchema = z.object({ x: Coordinate, y: Coordinate }).strict();
const PrimitiveStyleSchema = z.object({
  color: PaletteSchema,
  width: StrokeWidthSchema,
  fill: PaletteSchema.optional(),
});

export const LinePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("line"),
  x1: Coordinate,
  y1: Coordinate,
  x2: Coordinate,
  y2: Coordinate,
}).strict();

export const PolylinePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("polyline"),
  points: z.array(PointSchema).min(2).max(48),
}).strict();

export const EllipsePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("ellipse"),
  cx: Coordinate,
  cy: Coordinate,
  rx: Radius,
  ry: Radius,
}).strict();

export const RectanglePrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("rectangle"),
  x: Coordinate,
  y: Coordinate,
  rectWidth: Radius,
  rectHeight: Radius,
  radius: z.number().finite().min(0).max(100).optional(),
}).strict();

export const ArcPrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("arc"),
  cx: Coordinate,
  cy: Coordinate,
  radius: Radius,
  startAngle: z.number().finite().min(-360).max(360),
  endAngle: z.number().finite().min(-360).max(720),
}).strict();

export const PolygonPrimitiveSchema = PrimitiveStyleSchema.extend({
  type: z.literal("polygon"),
  points: z.array(PointSchema).min(3).max(24),
}).strict();

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
  activeTeam: TeamId;
  artistSeatId: string | null;
  endsAt: number | null;
  canvasVersion: number;
  scores: Record<TeamId, number>;
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
export const ModeSchema = z.enum(["practice", "arena", "exhibition"]);

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
}).strict();

const ConfigureSeatCommandSchema = z.object({
  type: z.literal("configure_seat"),
  team: TeamSchema,
  controller: ControllerSchema,
}).strict();

const StartMatchCommandSchema = z.object({ type: z.literal("start_match") }).strict();

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

const ReadyNextCommandSchema = z.object({ type: z.literal("ready_next") }).strict();

export const RoomCommandSchema = z.discriminatedUnion("type", [
  ReadyCommandSchema,
  ConfigureSeatCommandSchema,
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
  return seatId !== null && snapshot.artistSeatId === seatId && snapshot.phase === "drawing";
}

export function canGuess(snapshot: RoomSnapshot, seatId: string | null): boolean {
  if (seatId === null || snapshot.phase !== "drawing") return false;
  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  return seat !== undefined && seat.team === snapshot.activeTeam && seat.id !== snapshot.artistSeatId;
}
