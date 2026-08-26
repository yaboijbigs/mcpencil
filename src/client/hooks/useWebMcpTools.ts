import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  DrawBatchCommandSchema,
  PrimitiveSchema,
  canGuess,
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
const NumberInput = { type: "number" };
const PrimitiveInputSchema = {
  type: "object",
  description: "One shape. Geometry by type: line=x1,y1,x2,y2; polyline=points (2+); ellipse=cx,cy,rx,ry; rectangle=x,y,rectWidth,rectHeight,radius?; arc=cx,cy,radius,startAngle,endAngle; polygon=points (3+). points are {x,y}. Coordinates are 0-1000 (visible canvas height 700). fill is optional. Runtime validation is authoritative.",
  properties: {
    type: { type: "string", enum: ["line", "polyline", "ellipse", "rectangle", "arc", "polygon"] },
    x1: NumberInput, y1: NumberInput, x2: NumberInput, y2: NumberInput,
    points: {
      type: "array",
      items: {
        type: "object",
        properties: { x: NumberInput, y: NumberInput },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
    cx: NumberInput, cy: NumberInput, rx: NumberInput, ry: NumberInput,
    x: NumberInput, y: NumberInput, rectWidth: NumberInput, rectHeight: NumberInput,
    radius: NumberInput, startAngle: NumberInput, endAngle: NumberInput,
    color: { type: "string", enum: ["ink", "cobalt", "coral", "sun", "leaf", "paper"] },
    width: { type: "number", enum: [3, 5, 7, 12, 20] },
    fill: { type: "string", enum: ["ink", "cobalt", "coral", "sun", "leaf", "paper"] },
  },
  required: ["type", "color", "width"],
  additionalProperties: false,
};

const DrawInput = z.object({
  expectedCanvasVersion: z.number().int().min(0).optional(),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
  primitives: z.array(PrimitiveSchema).min(1).max(12),
}).strict();

const TOOL_ACK_GRACE_MS = 400;

interface ToolRegistration {
  controller: AbortController;
  inFlight: number;
  lastSettledAt: number;
  removalTimer: number | null;
}

export function useWebMcpTools({ snapshot, seatId, guessesEnabled = true, command, privatePrompt, startPractice, joinMatch }: UseWebMcpToolsOptions) {
  const supported = Boolean(document.modelContext);
  const [invocations, setInvocations] = useState<LensInvocation[]>([]);
  const [registeredToolNames, setRegisteredToolNames] = useState<Set<string>>(() => new Set());
  const [registryEpoch, setRegistryEpoch] = useState(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const seatIdRef = useRef(seatId);
  seatIdRef.current = seatId;
  const actionsRef = useRef({ command, privatePrompt, startPractice, joinMatch });
  actionsRef.current = { command, privatePrompt, startPractice, joinMatch };
  const versionRoomRef = useRef<string | null>(snapshot?.roomCode ?? null);
  const versionRef = useRef(snapshot?.canvasVersion ?? 0);
  const snapshotRoomCode = snapshot?.roomCode ?? null;
  if (versionRoomRef.current !== snapshotRoomCode) {
    versionRoomRef.current = snapshotRoomCode;
    versionRef.current = snapshot?.canvasVersion ?? 0;
  } else {
    versionRef.current = Math.max(versionRef.current, snapshot?.canvasVersion ?? 0);
  }
  const registrationsRef = useRef(new Map<string, ToolRegistration>());
  const registrationRetriesRef = useRef(new Map<string, number>());
  const retryTimersRef = useRef(new Map<string, number>());

  const markRegistered = (name: string, registered: boolean) => {
    setRegisteredToolNames((current) => {
      if (current.has(name) === registered) return current;
      const next = new Set(current);
      if (registered) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const toolNames = useMemo(() => {
    return supported ? webMcpToolNames(snapshot, seatId, guessesEnabled) : [];
  }, [guessesEnabled, seatId, snapshot, supported]);
  const availabilityKey = toolNames.join(":");
  const availableToolsRef = useRef(new Set<string>());
  availableToolsRef.current = new Set(toolNames);

  const cancelRemoval = (registration: ToolRegistration) => {
    if (registration.removalTimer !== null) window.clearTimeout(registration.removalTimer);
    registration.removalTimer = null;
  };

  const scheduleRemoval = (name: string, registration: ToolRegistration) => {
    if (registration.removalTimer !== null) window.clearTimeout(registration.removalTimer);
    if (availableToolsRef.current.has(name)) {
      cancelRemoval(registration);
      return;
    }
    const now = Date.now();
    const acknowledgementAt = registration.lastSettledAt + TOOL_ACK_GRACE_MS;
    if (registration.inFlight === 0 && (registration.lastSettledAt === 0 || now >= acknowledgementAt)) {
      registration.controller.abort();
      if (registrationsRef.current.get(name) === registration) registrationsRef.current.delete(name);
      markRegistered(name, false);
      return;
    }
    const retryAt = registration.inFlight > 0 ? now + 50 : acknowledgementAt;
    registration.removalTimer = window.setTimeout(() => {
      registration.removalTimer = null;
      if (availableToolsRef.current.has(name)) {
        return;
      }
      if (registration.inFlight > 0 || Date.now() < registration.lastSettledAt + TOOL_ACK_GRACE_MS) {
        scheduleRemoval(name, registration);
        return;
      }
      registration.controller.abort();
      if (registrationsRef.current.get(name) === registration) registrationsRef.current.delete(name);
      markRegistered(name, false);
    }, Math.max(0, retryAt - now));
  };

  const run = async <T,>(
    name: string,
    input: Record<string, unknown>,
    executionSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T> | T,
    summarizeOutput: (output: T) => string = () => "Accepted",
  ) => {
    const registration = registrationsRef.current.get(name);
    if (!availableToolsRef.current.has(name) || !registration || registration.controller.signal.aborted) {
      throw new Error("This tool is no longer available for your current role. Inspect match state and use the newly listed tools.");
    }
    registration.inFlight += 1;
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
    setInvocations((items) => [pending, ...items].slice(0, 18));
    try {
      // Authorization is checked above at invocation start. Once accepted, an in-flight
      // mutation is allowed to finish even if its authoritative snapshot changes the role.
      const output = await operation(executionSignal);
      const outputVersion = canvasVersionFrom(output);
      if (outputVersion !== null) versionRef.current = Math.max(versionRef.current, outputVersion);
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
    } finally {
      registration.inFlight = Math.max(0, registration.inFlight - 1);
      registration.lastSettledAt = Date.now();
      if (!availableToolsRef.current.has(name)) scheduleRemoval(name, registration);
    }
  };

  const availableTools = availableToolsRef.current;
  const tool = (definition: WebMCP.ModelContextTool): WebMCP.ModelContextTool => definition;
  const definitions: WebMCP.ModelContextTool[] = [
    tool({
      name: "get_match_state",
      title: "Inspect MCPencil match",
      description: "Read the current room, phase, role, scores, timer, seats, and canvas version.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input, { signal }) =>
        run("get_match_state", input, signal, () => compactState(snapshotRef.current, seatIdRef.current), () => `State read at canvas v${versionRef.current}`),
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
          await actionsRef.current.startPractice(name);
          return { accepted: true, next: "Call get_match_state." };
        }),
      }),
    );
  }

  if (availableTools.has("join_match")) {
    definitions.push(
      tool({
        name: "join_match",
        title: "Join MCPencil room",
        description: "Join the current invite or waiting Practice Pair. Only name is required when the page already identifies a room; controller defaults to agent. Otherwise provide a five-character roomCode.",
        inputSchema: {
          type: "object",
          properties: {
            roomCode: { type: "string", pattern: "^[A-Z2-9]{5}$", description: "Optional when the current page identifies a room." },
            name: { type: "string", minLength: 1, maxLength: 24 },
            team: { type: "string", enum: ["cobalt", "coral"] },
            controller: { type: "string", enum: ["human", "agent"], description: "Optional; defaults to agent." },
          },
          required: ["name"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: (input, { signal }) => run("join_match", input, signal, async () => {
          const parsed = z.object({
            roomCode: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{5}$/).optional(),
            name: z.string().trim().min(1).max(24),
            team: z.enum(["cobalt", "coral"]).optional(),
            controller: z.enum(["human", "agent"]).optional(),
          }).strict().parse(input);
          const currentLobbyCode = snapshotRef.current?.phase === "lobby"
            ? snapshotRef.current.roomCode
            : null;
          const roomCode = parsed.roomCode ?? currentLobbyCode ?? roomCodeFromUrl();
          if (!roomCode) throw new Error("roomCode is required when the page URL has no valid ?room= code.");
          const controller = parsed.controller ?? "agent";
          await actionsRef.current.joinMatch({ ...parsed, roomCode, controller });
          return { accepted: true, roomCode, controller, next: "Your agent seat is ready automatically. Practice starts when both sockets connect; arena hosts can start once four live seats are ready." };
        }),
      }),
    );
  }

  if (availableTools.has("start_match")) definitions.push(tool({
    name: "start_match", title: "Start MCPencil match", description: "Start once both teams have two live, ready players. Agent seats are ready automatically.",
    inputSchema: EmptySchema,
    execute: (input, { signal }) => run("start_match", input, signal, () => actionsRef.current.command({ type: "start_match", origin: "webmcp" }, signal), compactCommand),
  }));

  if (availableTools.has("get_draw_prompt")) {
    definitions.push(
      tool({
        name: "get_draw_prompt", title: "Read private drawing prompt",
        description: "Read your secret prompt plus the live canvas version and timer. Never disclose the prompt; communicate only through drawing tools.",
        inputSchema: EmptySchema, annotations: { readOnlyHint: true },
        execute: (input, { signal }) => run("get_draw_prompt", input, signal, async () => {
          const prompt = await actionsRef.current.privatePrompt(signal);
          return {
            ...prompt,
            canvasVersion: versionRef.current,
            remainingMs: remainingMs(snapshotRef.current),
            guidance: "Immediately send a recognizable 3-6 primitive draw_batch. Then chain each returned canvasVersion into the next batch without another state read.",
          };
        }, () => "Private prompt delivered with fast-turn state (masked in Lens)"),
      }),
      tool({
        name: "draw_batch", title: "Draw vector primitives",
        description: "Draw on the 1000x700 canvas. Immediately add a recognizable 3-6 primitive silhouette, then refine in more small batches. expectedCanvasVersion and idempotencyKey are optional. Chain each response.canvasVersion into the next batch without calling get_match_state.",
        inputSchema: {
          type: "object",
          properties: {
            expectedCanvasVersion: { type: "integer", minimum: 0, description: "Optional; defaults to the latest client version. Prefer the prior draw_batch response.canvasVersion." },
            idempotencyKey: { type: "string", minLength: 8, maxLength: 80, description: "Optional; a UUID-based key is generated when omitted." },
            primitives: { type: "array", minItems: 1, maxItems: 12, items: PrimitiveInputSchema },
          },
          required: ["primitives"], additionalProperties: false,
        },
        execute: (input, { signal }) => run("draw_batch", input, signal, async () => {
          const parsed = DrawInput.parse(input);
          const expectedVersion = parsed.expectedCanvasVersion ?? versionRef.current;
          const idempotencyKey = parsed.idempotencyKey ?? `webmcp-${crypto.randomUUID()}`;
          const payload = DrawBatchCommandSchema.parse({
            type: "draw_batch", expectedVersion, idempotencyKey, primitives: parsed.primitives, origin: "webmcp",
          });
          const result = await actionsRef.current.command(payload, signal);
          return {
            ...result,
            guidance: `Continue immediately; use canvasVersion ${result.canvasVersion} as the next expectedCanvasVersion without another state read.`,
          };
        }, compactCommand),
      }),
      tool({
        name: "undo_draw_batch", title: "Undo last drawing batch",
        description: "Remove your most recent drawing batch from this round when it needs correction.",
        inputSchema: { type: "object", properties: { expectedCanvasVersion: { type: "integer", minimum: 0 } }, required: ["expectedCanvasVersion"], additionalProperties: false },
        execute: (input, { signal }) => run("undo_draw_batch", input, signal, () => actionsRef.current.command({ type: "undo_draw_batch", expectedVersion: z.number().int().min(0).parse(input.expectedCanvasVersion), origin: "webmcp" }, signal), compactCommand),
      }),
    );
  }

  if (availableTools.has("submit_guess")) definitions.push(tool({
    name: "submit_guess", title: "Submit a drawing guess",
    description: "Guess the broad object or action as soon as recognizable strokes appear. If wrong, wait for canvasVersion to change, inspect the canvas again, and refine; wrong guesses are rate-limited.",
    inputSchema: { type: "object", properties: { guess: { type: "string", minLength: 1, maxLength: 80, description: "Your concise best answer." } }, required: ["guess"], additionalProperties: false },
    annotations: { untrustedContentHint: true },
    execute: (input, { signal }) => run("submit_guess", input, signal, async () => {
      const result = await actionsRef.current.command({ type: "submit_guess", guess: z.string().trim().min(1).max(80).parse(input.guess), origin: "webmcp" }, signal);
      return {
        ...result,
        guidance: result.correct
          ? "Correct."
          : result.close
            ? `Close—refine after the canvasVersion advances beyond ${result.canvasVersion} and new strokes appear.`
            : `Not correct. Wait for the canvasVersion to advance beyond ${result.canvasVersion}, inspect the new strokes, then retry with a refined guess.`,
      };
    }, (output) => `${output.correct ? "Correct" : output.close ? "Close—refine after new strokes" : "Not correct"}; canvas v${output.canvasVersion}`),
  }));

  if (availableTools.has("get_round_result")) {
    definitions.push(tool({
      name: "get_round_result", title: "Read round result",
      description: "Read the revealed prompt, winner, points, timing, strokes, and tool usage for the completed round.",
      inputSchema: EmptySchema, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input, { signal }) => run("get_round_result", input, signal, () => snapshotRef.current?.roundResult ?? { status: "No result" }, () => "Round result read"),
    }));
    if (availableTools.has("ready_next")) definitions.push(tool({
      name: "ready_next", title: "Ready for next round", description: "Confirm that your seat is ready for the next round.",
      inputSchema: EmptySchema,
      execute: (input, { signal }) => run("ready_next", input, signal, () => actionsRef.current.command({
        type: "ready_next",
        expectedRoundIndex: snapshotRef.current?.roundIndex ?? 0,
        origin: "webmcp",
      }, signal), compactCommand),
    }));
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!context) {
      for (const registration of registrationsRef.current.values()) {
        if (registration.removalTimer !== null) window.clearTimeout(registration.removalTimer);
        registration.controller.abort();
      }
      registrationsRef.current.clear();
      return;
    }

    const desiredNames = availableToolsRef.current;
    for (const [name, timer] of retryTimersRef.current) {
      if (desiredNames.has(name)) continue;
      window.clearTimeout(timer);
      retryTimersRef.current.delete(name);
      registrationRetriesRef.current.delete(name);
    }
    for (const [name, registration] of registrationsRef.current) {
      if (desiredNames.has(name)) cancelRemoval(registration);
      else scheduleRemoval(name, registration);
    }
    for (const definition of definitions) {
      const existing = registrationsRef.current.get(definition.name);
      if (existing) {
        cancelRemoval(existing);
        continue;
      }
      const registration: ToolRegistration = {
        controller: new AbortController(),
        inFlight: 0,
        lastSettledAt: 0,
        removalTimer: null,
      };
      registrationsRef.current.set(definition.name, registration);
      markRegistered(definition.name, true);
      void context.registerTool(definition, { signal: registration.controller.signal }).then(() => {
        registrationRetriesRef.current.delete(definition.name);
      }).catch(() => {
        if (registrationsRef.current.get(definition.name) !== registration) return;
        cancelRemoval(registration);
        registration.controller.abort();
        registrationsRef.current.delete(definition.name);
        markRegistered(definition.name, false);
        const retries = (registrationRetriesRef.current.get(definition.name) ?? 0) + 1;
        registrationRetriesRef.current.set(definition.name, retries);
        if (availableToolsRef.current.has(definition.name) && retries <= 3) {
          const timer = window.setTimeout(() => {
            retryTimersRef.current.delete(definition.name);
            setRegistryEpoch((epoch) => epoch + 1);
          }, 250 * 2 ** (retries - 1));
          retryTimersRef.current.set(definition.name, timer);
        }
      });
    }
  }, [availabilityKey, registryEpoch, supported]);

  useEffect(() => () => {
    for (const registration of registrationsRef.current.values()) {
      if (registration.removalTimer !== null) window.clearTimeout(registration.removalTimer);
      registration.controller.abort();
    }
    registrationsRef.current.clear();
    for (const timer of retryTimersRef.current.values()) window.clearTimeout(timer);
    retryTimersRef.current.clear();
  }, []);

  return {
    supported,
    toolNames: toolNames.filter((name) => registeredToolNames.has(name)),
    invocations,
  };
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

function canvasVersionFrom(output: unknown): number | null {
  if (typeof output !== "object" || output === null || !("canvasVersion" in output)) return null;
  const canvasVersion = output.canvasVersion;
  return typeof canvasVersion === "number" && Number.isInteger(canvasVersion) && canvasVersion >= 0 ? canvasVersion : null;
}

function remainingMs(snapshot: RoomSnapshot | null): number | null {
  return snapshot?.endsAt ? Math.max(0, snapshot.endsAt - Date.now()) : null;
}

function roomCodeFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase() ?? "";
  return /^[A-Z2-9]{5}$/.test(value) ? value : null;
}

function summarizeInput(name: string, input: Record<string, unknown>) {
  if (name === "get_draw_prompt") return "Private prompt request · content masked";
  if (name === "draw_batch") {
    const count = Array.isArray(input.primitives) ? input.primitives.length : 0;
    const key = input.idempotencyKey ? `${String(input.idempotencyKey).slice(0, 10)}…` : "auto-generated";
    return `${count} primitive${count === 1 ? "" : "s"} · key ${key}`;
  }
  if (name === "submit_guess") return `Guess: “${String(input.guess ?? "").slice(0, 36)}”`;
  const keys = Object.keys(input);
  return keys.length ? keys.map((key) => `${key}: ${String(input[key]).slice(0, 24)}`).join(" · ") : "No input";
}
