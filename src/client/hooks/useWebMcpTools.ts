import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  DrawBatchCommandSchema,
  PrimitiveSchema,
  canGuess,
  isArtist,
  type CommandResult,
  type ControllerType,
  type PrivatePrompt,
  type RoomCommand,
  type RoomSnapshot,
  type TeamId,
} from "../../shared/game";
import { webMcpToolNames } from "../webMcpAvailability";

export interface LensInvocation {
  id: string;
  tool: string;
  status: "running" | "ok" | "error";
  inputSummary: string;
  outputSummary?: string;
  startedAt: number;
  durationMs?: number;
  canvasVersion: number;
}

interface UseWebMcpToolsOptions {
  snapshot: RoomSnapshot | null;
  seatId: string | null;
  guessesEnabled?: boolean;
  command(command: RoomCommand, signal?: AbortSignal): Promise<CommandResult>;
  privatePrompt(signal?: AbortSignal): Promise<PrivatePrompt>;
  startPractice(name: string): Promise<void>;
  joinMatch(input: {
    roomCode: string;
    name: string;
    team?: TeamId;
    controller: ControllerType;
  }): Promise<void>;
}

const EmptySchema = { type: "object", properties: {}, additionalProperties: false };
const PrimitiveInputSchema = {
  oneOf: [
    shape("line", { x1: coordinate("Start x."), y1: coordinate("Start y."), x2: coordinate("End x."), y2: coordinate("End y.") }),
    shape("polyline", {
      points: { type: "array", minItems: 2, maxItems: 48, items: pointSchema(), description: "Ordered points for one stroke." },
    }),
    shape("ellipse", { cx: coordinate("Center x."), cy: coordinate("Center y."), rx: radius("Horizontal radius."), ry: radius("Vertical radius.") }),
    shape("rectangle", {
      x: coordinate("Left x."), y: coordinate("Top y."), rectWidth: radius("Rectangle width."), rectHeight: radius("Rectangle height."),
      radius: { type: "number", minimum: 0, maximum: 100, description: "Optional corner radius." },
    }, ["radius"]),
    shape("arc", {
      cx: coordinate("Center x."), cy: coordinate("Center y."), radius: radius("Arc radius."),
      startAngle: { type: "number", minimum: -360, maximum: 360 }, endAngle: { type: "number", minimum: -360, maximum: 720 },
    }),
    shape("polygon", {
      points: { type: "array", minItems: 3, maxItems: 24, items: pointSchema(), description: "Vertices; the final edge closes." },
    }),
  ],
};

const DrawInput = z.object({
  expectedCanvasVersion: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(80),
  primitives: z.array(PrimitiveSchema).min(1).max(12),
}).strict();

export function useWebMcpTools({ snapshot, seatId, guessesEnabled = true, command, privatePrompt, startPractice, joinMatch }: UseWebMcpToolsOptions) {
  const supported = Boolean(document.modelContext);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [invocations, setInvocations] = useState<LensInvocation[]>([]);
  const generationRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const versionRef = useRef(snapshot?.canvasVersion ?? 0);
  versionRef.current = snapshot?.canvasVersion ?? 0;

  const roleKey = useMemo(() => {
    const names = webMcpToolNames(snapshot, seatId, guessesEnabled);
    return `${names.join(":")}:${snapshot?.roundIndex ?? "landing"}`;
  }, [guessesEnabled, seatId, snapshot]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context) {
      setToolNames([]);
      return;
    }

    const controller = new AbortController();
    const generation = ++generationRef.current;
    const activeSnapshot = snapshotRef.current;
    const currentSeat = activeSnapshot?.seats.find((seat) => seat.id === seatId);
    const availableTools = new Set(webMcpToolNames(activeSnapshot, seatId, guessesEnabled));

    const run = async <T,>(
      name: string,
      input: Record<string, unknown>,
      executionSignal: AbortSignal,
      operation: (signal: AbortSignal) => Promise<T> | T,
      summarizeOutput: (output: T) => string = () => "Accepted",
    ) => {
      if (generation !== generationRef.current) throw new Error("Your role changed; inspect match state and try again.");
      const startedAt = Date.now();
      const id = crypto.randomUUID();
      const inputSummary = summarizeInput(name, input);
      const pending: LensInvocation = {
        id,
        tool: name,
        status: "running",
        inputSummary,
        startedAt,
        canvasVersion: versionRef.current,
      };
      setInvocations((items) =>
        [pending, ...items].slice(0, 18),
      );
      try {
        // The registration signal removes stale tools. Keep an invocation that caused a
        // phase transition alive long enough to receive its authoritative acknowledgement;
        // the execution signal still forwards caller cancellation to fetch.
        const output = await operation(executionSignal);
        const outputSummary = summarizeOutput(output);
        setInvocations((items) => items.map((item) => item.id === id
          ? { ...item, status: "ok", outputSummary, durationMs: Date.now() - startedAt, canvasVersion: versionRef.current }
          : item));
        return output;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Tool call failed";
        setInvocations((items) => items.map((item) => item.id === id
          ? { ...item, status: "error", outputSummary: message, durationMs: Date.now() - startedAt }
          : item));
        throw reason;
      }
    };

    const tool = (definition: WebMCP.ModelContextTool): WebMCP.ModelContextTool => definition;
    const definitions: WebMCP.ModelContextTool[] = [
      tool({
        name: "get_match_state",
        title: "Inspect MCPencil match",
        description: "Read the current room, phase, role, scores, timer, seats, and canvas version. Call before taking a turn.",
        inputSchema: EmptySchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, { signal }) =>
          run("get_match_state", input, signal, () => compactState(snapshotRef.current, seatId), () => `State read at canvas v${versionRef.current}`),
      }),
    ];

    if (availableTools.has("start_practice")) {
      definitions.push(
        tool({
          name: "start_practice",
          title: "Start agent practice",
          description: "Open a two-round practice room with this browser agent seated as the first player.",
          inputSchema: {
            type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 24, description: "Your display name." } },
            required: ["name"], additionalProperties: false,
          },
          execute: (input, { signal }) => run("start_practice", input, signal, async () => {
            const name = z.string().trim().min(1).max(24).parse(input.name);
            await startPractice(name);
            return { accepted: true, next: "Call get_match_state." };
          }),
        }),
        tool({
          name: "join_match",
          title: "Join MCPencil room",
          description: "Join an existing room as a human-controlled or agent-controlled player on a chosen team.",
          inputSchema: {
            type: "object",
            properties: {
              roomCode: { type: "string", pattern: "^[A-Z2-9]{5}$", description: "Five-character room code." },
              name: { type: "string", minLength: 1, maxLength: 24 }, team: { type: "string", enum: ["cobalt", "coral"] },
              controller: { type: "string", enum: ["human", "agent"] },
            },
            required: ["roomCode", "name", "controller"], additionalProperties: false,
          },
          annotations: { untrustedContentHint: true },
          execute: (input, { signal }) => run("join_match", input, signal, async () => {
            const parsed = z.object({
              roomCode: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{5}$/), name: z.string().trim().min(1).max(24),
              team: z.enum(["cobalt", "coral"]).optional(), controller: z.enum(["human", "agent"]),
            }).strict().parse(input);
            await joinMatch(parsed);
            return { accepted: true, roomCode: parsed.roomCode, next: "Call get_match_state." };
          }),
        }),
      );
    }

    if (availableTools.has("ready_up")) {
      definitions.push(tool({
        name: "ready_up", title: "Set ready status", description: "Mark your MCPencil seat ready or not ready in the lobby.",
        inputSchema: { type: "object", properties: { ready: { type: "boolean", description: "Whether your seat is ready." } }, required: ["ready"], additionalProperties: false },
        execute: (input, { signal }) => run("ready_up", input, signal, () => command({ type: "ready_up", ready: z.boolean().parse(input.ready), origin: "webmcp" }, signal), compactCommand),
      }));
      if (availableTools.has("start_match")) definitions.push(tool({
        name: "start_match", title: "Start MCPencil match", description: "Start the match once the lobby has enough ready players.",
        inputSchema: EmptySchema,
        execute: (input, { signal }) => run("start_match", input, signal, () => command({ type: "start_match", origin: "webmcp" }, signal), compactCommand),
      }));
    }

    if (activeSnapshot && availableTools.has("get_draw_prompt")) {
      definitions.push(
        tool({
          name: "get_draw_prompt", title: "Read private drawing prompt",
          description: "Read your secret prompt for this round. Never disclose it; communicate only through drawing tools.",
          inputSchema: EmptySchema, annotations: { readOnlyHint: true },
          execute: (input, { signal }) => run("get_draw_prompt", input, signal, () => privatePrompt(signal), () => "Private prompt delivered (masked in Lens)"),
        }),
        tool({
          name: "draw_batch", title: "Draw vector primitives",
          description: "Add up to 12 low-level shapes to the shared 1000 by 700 canvas. Use several calls so teammates can guess while you draw.",
          inputSchema: {
            type: "object",
            properties: {
              expectedCanvasVersion: { type: "integer", minimum: 0, description: "Canvas version from get_match_state." },
              idempotencyKey: { type: "string", minLength: 8, maxLength: 80, description: "Unique key for this batch." },
              primitives: { type: "array", minItems: 1, maxItems: 12, items: PrimitiveInputSchema },
            },
            required: ["expectedCanvasVersion", "idempotencyKey", "primitives"], additionalProperties: false,
          },
          execute: (input, { signal }) => run("draw_batch", input, signal, async () => {
            const parsed = DrawInput.parse(input);
            const payload = DrawBatchCommandSchema.parse({ type: "draw_batch", expectedVersion: parsed.expectedCanvasVersion, idempotencyKey: parsed.idempotencyKey, primitives: parsed.primitives, origin: "webmcp" });
            return command(payload, signal);
          }, compactCommand),
        }),
        tool({
          name: "undo_draw_batch", title: "Undo last drawing batch",
          description: "Remove your most recent drawing batch from this round when it needs correction.",
          inputSchema: { type: "object", properties: { expectedCanvasVersion: { type: "integer", minimum: 0 } }, required: ["expectedCanvasVersion"], additionalProperties: false },
          execute: (input, { signal }) => run("undo_draw_batch", input, signal, () => command({ type: "undo_draw_batch", expectedVersion: z.number().int().min(0).parse(input.expectedCanvasVersion), origin: "webmcp" }, signal), compactCommand),
        }),
      );
    }

    if (activeSnapshot && availableTools.has("submit_guess")) definitions.push(tool({
      name: "submit_guess", title: "Submit a drawing guess",
      description: "Submit one concise guess for the active drawing. Inspect the visible canvas first; wrong guesses are rate-limited.",
      inputSchema: { type: "object", properties: { guess: { type: "string", minLength: 1, maxLength: 80, description: "Your best answer." } }, required: ["guess"], additionalProperties: false },
      annotations: { untrustedContentHint: true },
      execute: (input, { signal }) => run("submit_guess", input, signal,
        () => command({ type: "submit_guess", guess: z.string().trim().min(1).max(80).parse(input.guess), origin: "webmcp" }, signal),
        (output) => `${output.correct ? "Correct" : "Not correct"}; canvas v${output.canvasVersion}`),
    }));

    if (activeSnapshot && availableTools.has("get_round_result")) {
      definitions.push(tool({
        name: "get_round_result", title: "Read round result",
        description: "Read the revealed prompt, winner, points, timing, strokes, and tool usage for the completed round.",
        inputSchema: EmptySchema, annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, { signal }) => run("get_round_result", input, signal, () => activeSnapshot.roundResult ?? { status: "No result" }, () => "Round result read"),
      }));
      if (availableTools.has("ready_next")) definitions.push(tool({
        name: "ready_next", title: "Ready for next round", description: "Confirm that your seat is ready for the next round.",
        inputSchema: EmptySchema,
        execute: (input, { signal }) => run("ready_next", input, signal, () => command({ type: "ready_next", origin: "webmcp" }, signal), compactCommand),
      }));
    }

    setToolNames(definitions.map(({ name }) => name));
    void Promise.allSettled(definitions.map((definition) => context.registerTool(definition, { signal: controller.signal })));
    return () => { generationRef.current += 1; controller.abort(); };
  }, [command, joinMatch, privatePrompt, roleKey, seatId, startPractice]);

  return { supported, toolNames, invocations };
}

function compactState(snapshot: RoomSnapshot | null, seatId: string | null) {
  if (!snapshot) return { phase: "landing", availableActions: ["start_practice", "join_match"] };
  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  return {
    roomCode: snapshot.roomCode, mode: snapshot.mode, phase: snapshot.phase, round: snapshot.roundIndex + 1,
    totalRounds: snapshot.totalRounds, yourSeatId: seatId,
    yourRole: snapshot.artistSeatId === seatId ? "artist" : canGuess(snapshot, seatId) ? "guesser" : "spectator",
    yourTeam: seat?.team, activeTeam: snapshot.activeTeam,
    artist: snapshot.seats.find((candidate) => candidate.id === snapshot.artistSeatId)?.name ?? null,
    remainingMs: snapshot.endsAt ? Math.max(0, snapshot.endsAt - Date.now()) : null,
    canvasVersion: snapshot.canvasVersion, strokeCount: snapshot.canvas.length, scores: snapshot.scores,
    seats: snapshot.seats.map(({ id, name, team, controller, isReady, isConnected }) => ({ id, name, team, controller, isReady, isConnected })),
  };
}

function compactCommand(result: CommandResult) {
  return `${result.accepted ? "Accepted" : "Rejected"}; canvas v${result.canvasVersion}${result.remainingMs === null ? "" : `; ${result.remainingMs}ms left`}`;
}

function summarizeInput(name: string, input: Record<string, unknown>) {
  if (name === "get_draw_prompt") return "Private prompt request · content masked";
  if (name === "draw_batch") {
    const count = Array.isArray(input.primitives) ? input.primitives.length : 0;
    return `${count} primitive${count === 1 ? "" : "s"} · key ${String(input.idempotencyKey ?? "").slice(0, 10)}…`;
  }
  if (name === "submit_guess") return `Guess: “${String(input.guess ?? "").slice(0, 36)}”`;
  const keys = Object.keys(input);
  return keys.length ? keys.map((key) => `${key}: ${String(input[key]).slice(0, 24)}`).join(" · ") : "No input";
}

function coordinate(description: string) { return { type: "number", minimum: 0, maximum: 1000, description }; }
function radius(description: string) { return { type: "number", minimum: 1, maximum: 1000, description }; }
function pointSchema() {
  return { type: "object", properties: { x: coordinate("Point x."), y: coordinate("Point y.") }, required: ["x", "y"], additionalProperties: false };
}
function shape(type: string, properties: Record<string, object>, optional: string[] = []) {
  return {
    type: "object",
    properties: {
      type: { const: type }, ...properties,
      color: { type: "string", enum: ["ink", "cobalt", "coral", "sun", "leaf", "paper"] },
      width: { type: "number", enum: [3, 7, 12, 20] },
      fill: { type: "string", enum: ["ink", "cobalt", "coral", "sun", "leaf", "paper"] },
    },
    required: ["type", ...Object.keys(properties).filter((key) => !optional.includes(key)), "color", "width"], additionalProperties: false,
  };
}
