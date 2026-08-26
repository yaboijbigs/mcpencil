import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  ARENA_ROUND_OPTIONS,
  DrawBatchCommandSchema,
  PRACTICE_ROUND_OPTIONS,
  PrimitiveSchema,
  ROUND_DURATION_OPTIONS_MS,
  canGuess,
  isArtist,
  type ActionOrigin,
  type CommandResult,
  type ControllerType,
  type JoinRoomResponse,
  type MatchPhase,
  type PrivatePrompt,
  type RoomCommand,
  type RoomSnapshot,
  type TeamId,
} from "../../shared/game";
import { roomCodeFromUrl, separateAgentViewInstruction } from "../invite";
import {
  WEBMCP_REGISTERED_TOOL_NAMES,
  compactWebMcpRoundResult,
  compactWebMcpState,
  webMcpToolNames,
} from "../webMcpAvailability";

export interface LensInvocation {
  id: string;
  tool: string;
  status: "running" | "ok" | "error";
  inputSummary: string;
  outputSummary?: string;
  startedAt: number;
  durationMs?: number;
  canvasVersion: number;
  batchId?: string;
  provenance: Extract<ActionOrigin, "webmcp">;
  annotations?: WebMCP.ToolAnnotations;
  result?: LensResultEvidence;
}

export interface LensResultEvidence {
  accepted?: boolean;
  revision?: number;
  canvasVersion?: number;
  batchId?: string;
  correct?: boolean;
  attemptCount?: number;
  phase?: string;
  role?: string;
  promptMasked?: boolean;
}

export interface WebMcpToolDescriptorEvidence {
  name: string;
  title: string;
  description: string;
  annotations?: WebMCP.ToolAnnotations;
}

export interface WebMcpProofContext {
  phase: MatchPhase | "landing";
  role: "artist" | "guesser" | "spectator" | "visitor";
  controller: ControllerType | null;
  seatName: string | null;
  roomCode: string | null;
  round: number | null;
  totalRounds: number | null;
}

export interface ToolAuthorizationEvent {
  id: string;
  tool: string;
  change: "granted" | "revoked";
  createdAt: number;
  phase: WebMcpProofContext["phase"];
  role: WebMcpProofContext["role"];
}

interface UseWebMcpToolsOptions {
  snapshot: RoomSnapshot | null;
  seatId: string | null;
  enabled?: boolean;
  guessesEnabled?: boolean;
  humanHostDocument?: boolean;
  command(command: RoomCommand, signal?: AbortSignal): Promise<CommandResult>;
  privatePrompt(signal?: AbortSignal): Promise<PrivatePrompt>;
  startPractice(name: string): Promise<void>;
  joinMatch(input: {
    roomCode: string;
    name: string;
    team?: TeamId;
    controller: ControllerType;
  }): Promise<JoinRoomResponse | void>;
}

const EmptySchema = { type: "object", properties: {}, additionalProperties: false };
const { $schema: _primitiveSchemaDialect, ...GeneratedPrimitiveInputSchema } = z.toJSONSchema(PrimitiveSchema);
const PrimitiveInputSchema = {
  ...GeneratedPrimitiveInputSchema,
  description: "Exactly one discriminated vector primitive. X coordinates must be 0-1000 and Y coordinates 0-700. The full ellipse, rectangle, or arc extent must remain inside the visible canvas. Lines and polylines need at least two distinct points; polygons need at least three distinct, non-collinear vertices with nonzero area; arcs cannot be zero- or full-turn circles.",
};

const DrawStrokeInput = z.object({
  expectedCanvasVersion: z.number().int().min(0).optional(),
  primitive: PrimitiveSchema,
}).strict();

const SubmitGuessesInput = z.object({
  guesses: z.array(z.string().trim().min(1).max(80)).min(1).max(3),
}).strict().superRefine(({ guesses }, context) => {
  const normalized = guesses.map((guess) => guess.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: "custom", path: ["guesses"], message: "Candidates must be distinct." });
  }
});

const MatchStateInput = z.object({
  afterRevision: z.number().int().min(0).optional(),
  waitMs: z.number().int().min(0).max(25_000).optional(),
}).strict();

const ConfigureMatchInput = z.object({
  totalRounds: z.number().int(),
  roundDurationMs: z.number().int(),
}).strict();

interface ToolRegistration {
  controller: AbortController;
  status: "registering" | "registered" | "retiring";
}

interface StateWaiter {
  afterRevision: number;
  timeoutId: number;
  signal?: AbortSignal;
  onAbort: () => void;
  resolve: (snapshot: RoomSnapshot | null) => void;
  reject: (reason: unknown) => void;
}

export function useWebMcpTools({ snapshot, seatId, enabled = true, guessesEnabled = true, humanHostDocument = false, command, privatePrompt, startPractice, joinMatch }: UseWebMcpToolsOptions) {
  const supported = Boolean(document.modelContext);
  const [invocations, setInvocations] = useState<LensInvocation[]>([]);
  const [registeredToolNames, setRegisteredToolNames] = useState<Set<string>>(() => new Set());
  const [authorizationEvents, setAuthorizationEvents] = useState<ToolAuthorizationEvent[]>([]);
  const [consumedReadyNextKey, setConsumedReadyNextKey] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const seatIdRef = useRef(seatId);
  seatIdRef.current = seatId;
  const actionsRef = useRef({ command, privatePrompt, startPractice, joinMatch, humanHostDocument });
  actionsRef.current = { command, privatePrompt, startPractice, joinMatch, humanHostDocument };
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
  const descriptorEvidenceRef = useRef(new Map<string, WebMcpToolDescriptorEvidence>());
  const previousAuthorizedToolsRef = useRef<Set<string> | null>(null);
  const stateWaitersRef = useRef(new Set<StateWaiter>());
  const privatePromptCacheRef = useRef(new Map<string, Promise<PrivatePrompt>>());
  const drawStrokeChainRef = useRef<Promise<void>>(Promise.resolve());
  const roomInviteCode = roomCodeFromUrl(new URL(window.location.href));

  const settleStateWaiter = (waiter: StateWaiter, value: RoomSnapshot | null, reason?: unknown) => {
    if (!stateWaitersRef.current.delete(waiter)) return;
    window.clearTimeout(waiter.timeoutId);
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    if (reason === undefined) waiter.resolve(value);
    else waiter.reject(reason);
  };

  const waitForRevision = (afterRevision: number, waitMs: number, signal?: AbortSignal) => {
    const current = snapshotRef.current;
    if (current === null || current.revision > afterRevision || waitMs === 0) return Promise.resolve(current);
    return new Promise<RoomSnapshot | null>((resolve, reject) => {
      const waiter: StateWaiter = {
        afterRevision,
        timeoutId: 0,
        signal,
        onAbort: () => {},
        resolve,
        reject,
      };
      waiter.onAbort = () => settleStateWaiter(
        waiter,
        snapshotRef.current,
        new DOMException("The state wait was cancelled.", "AbortError"),
      );
      waiter.timeoutId = window.setTimeout(
        () => settleStateWaiter(waiter, snapshotRef.current),
        waitMs,
      );
      stateWaitersRef.current.add(waiter);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal?.aborted) {
        waiter.onAbort();
        return;
      }
      const latest = snapshotRef.current;
      if (latest !== null && latest.revision > afterRevision) settleStateWaiter(waiter, latest);
    });
  };

  const cachedPrivatePrompt = (
    activeSnapshot: RoomSnapshot,
    activeSeatId: string,
    signal?: AbortSignal,
  ) => {
    const key = `${activeSnapshot.roomCode}:${activeSnapshot.roundIndex}:${activeSeatId}`;
    const cached = privatePromptCacheRef.current.get(key);
    if (cached) return cached;
    let request: Promise<PrivatePrompt>;
    request = actionsRef.current.privatePrompt(signal).catch((reason) => {
      if (privatePromptCacheRef.current.get(key) === request) privatePromptCacheRef.current.delete(key);
      throw reason;
    });
    privatePromptCacheRef.current.set(key, request);
    return request;
  };

  useEffect(() => {
    if (!snapshot) return;
    for (const waiter of Array.from(stateWaitersRef.current)) {
      if (snapshot.revision > waiter.afterRevision) settleStateWaiter(waiter, snapshot);
    }
  }, [snapshot?.revision]);

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
    if (!supported || !enabled) return [];
    const names = webMcpToolNames(snapshot, seatId, guessesEnabled, roomInviteCode);
    const readyNextKey = snapshot ? `${snapshot.roomCode}:${snapshot.roundIndex}` : null;
    return readyNextKey === consumedReadyNextKey
      ? names.filter((name) => name !== "ready_next")
      : names;
  }, [consumedReadyNextKey, enabled, guessesEnabled, roomInviteCode, seatId, snapshot, supported]);
  const availableToolsRef = useRef(new Set<string>());
  availableToolsRef.current = new Set(toolNames);

  const run = async <T,>(
    name: string,
    input: Record<string, unknown>,
    executionSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T> | T,
    summarizeOutput: (output: T) => string = () => "Accepted",
  ) => {
    const registration = registrationsRef.current.get(name);
    if (!availableToolsRef.current.has(name) || !registration || registration.controller.signal.aborted) {
      throw new Error("This action is not available for your current role or phase. Call get_match_state and follow its exact nextAction.");
    }
    const signal = executionSignal ?? registration.controller.signal;
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
      provenance: "webmcp",
      annotations: descriptorEvidenceRef.current.get(name)?.annotations,
    };
    setInvocations((items) => [pending, ...items].slice(0, 18));
    try {
      // Authorization is checked above at invocation start. Once accepted, an in-flight
      // mutation is allowed to finish even if its authoritative snapshot changes the role.
      const output = await operation(signal);
      const outputVersion = canvasVersionFrom(output);
      if (outputVersion !== null) versionRef.current = Math.max(versionRef.current, outputVersion);
      const outputSummary = summarizeOutput(output);
      const result = lensResultEvidence(output);
      setInvocations((items) => items.map((item) => item.id === id
        ? {
            ...item,
            status: "ok",
            outputSummary,
            durationMs: Date.now() - startedAt,
            canvasVersion: versionRef.current,
            ...(result?.batchId ? { batchId: result.batchId } : {}),
            ...(result ? { result } : {}),
          }
        : item));
      return output;
    } catch (reason) {
      const message = safeErrorSummary(reason);
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
      description: "Canonical page-exposed WebMCP continuation state. Before joining, it identifies play_mcpencil as the entry action. After joining, read role, mustContinue, completionCondition, exact nextAction, urgency, deadline, and the privatePrompt when you are the agent artist. Between turns, pass afterRevision and waitMs 25000. Guessers should visually inspect the rendered page/canvas as the primary picture; canvasPerception is a fast 32x22 text raster fallback and compact canvasGeometry is only a final cross-check.",
      inputSchema: {
        type: "object",
        properties: {
          afterRevision: { type: "integer", minimum: 0, description: "Optional last revision; wait for something newer." },
          waitMs: { type: "integer", minimum: 0, maximum: 25000, description: "Optional wait for a newer revision. Use 25000 between turns." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input, options) =>
        run("get_match_state", input, options?.signal, async (signal) => {
          const parsed = MatchStateInput.parse(input);
          const currentSnapshot = parsed.afterRevision === undefined
            ? snapshotRef.current
            : await waitForRevision(parsed.afterRevision, parsed.waitMs ?? 0, signal);
          const currentSeatId = seatIdRef.current;
          const state = {
            ...compactWebMcpState(currentSnapshot, currentSeatId, roomInviteCode),
            ...(parsed.afterRevision !== undefined && currentSnapshot?.revision === parsed.afterRevision
              ? { waitTimedOut: true }
              : {}),
          };
          if (!isActiveAgentArtist(currentSnapshot, currentSeatId)) return state;
          const prompt = await cachedPrivatePrompt(currentSnapshot, currentSeatId!, signal);
          return {
            ...state,
            privatePrompt: prompt.prompt,
            promptCategory: prompt.category,
            nextAction: {
              tool: "draw_stroke",
              instruction: "Send ONE high-information stroke now: X 0-1000, Y 0-700, with every ellipse/rectangle/arc extent fully visible. Do not narrate or plan the whole drawing; after acknowledgement, immediately send the next stroke.",
            },
            urgency: "immediate",
            deadline: currentSnapshot.endsAt,
          };
        }, () => isActiveAgentArtist(snapshotRef.current, seatIdRef.current)
          ? `State and private prompt delivered at canvas v${versionRef.current} · prompt masked`
          : `State read at canvas v${versionRef.current}`),
    }),
  ];

  {
    definitions.push(
      tool({
        name: "start_practice",
        title: "Start agent practice",
        description: "Open a balanced Practice Pair room with this browser agent seated as the first player. The host can configure rounds and drawing time in the lobby.",
        inputSchema: {
          type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 24, description: "Your display name." } },
          required: ["name"], additionalProperties: false,
        },
        execute: (input, options) => run("start_practice", input, options?.signal, async () => {
          const name = z.string().trim().min(1).max(24).parse(input.name);
          await actionsRef.current.startPractice(name);
          return {
            accepted: true,
            mustContinue: true,
            nextAction: { tool: "get_match_state", arguments: {}, instruction: "Read the new room state and continue until match-end." },
          };
        }),
      }),
    );
  }

  {
    definitions.push(
      tool({
        name: "play_mcpencil",
        title: "Join this room and play via WebMCP",
        description: "The complete page-exposed WebMCP entry point when a user asks you to play or opens an MCPencil room URL. Call with {} immediately after the page loads. It joins the current room as an AI player, readies the seat, and returns nextAction. Continue through MCPencil's page WebMCP tools until phase is match-end. The agent must use a separate agent tab or view; invoking this from an already seated human player's document returns the exact isolated agent invite instead of creating a same-page companion.",
        inputSchema: {
          type: "object",
          properties: {
            roomCode: { type: "string", pattern: "^[A-Z2-9]{5}$", description: "Optional when the current page identifies a room." },
            name: { type: "string", minLength: 1, maxLength: 24, description: "Optional display name. A unique agent name is generated when omitted." },
            team: { type: "string", enum: ["cobalt", "coral"] },
          },
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: (input, options) => run("play_mcpencil", input, options?.signal, async (signal) => {
          const parsed = z.object({
            roomCode: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{5}$/).optional(),
            name: z.string().trim().min(1).max(24).optional(),
            team: z.enum(["cobalt", "coral"]).optional(),
          }).strict().parse(input);
          const currentLobbyCode = snapshotRef.current?.phase === "lobby"
            ? snapshotRef.current.roomCode
            : null;
          const roomCode = parsed.roomCode ?? currentLobbyCode ?? roomCodeFromUrl(new URL(window.location.href));
          if (!roomCode) throw new Error("roomCode is required when the page URL does not identify a valid room.");
          if (actionsRef.current.humanHostDocument) {
            throw new Error(separateAgentViewInstruction(roomCode, window.location.origin));
          }
          const name = parsed.name ?? defaultAgentName();
          const controller = "agent";
          const response = await actionsRef.current.joinMatch({ ...parsed, roomCode, name, controller });
          const joinedSnapshot = response?.snapshot
            ?? (snapshotRef.current?.roomCode === roomCode ? snapshotRef.current : null);
          const joinedSeatId = response?.seatId ?? seatIdRef.current;
          let state: Record<string, unknown> = compactWebMcpState(joinedSnapshot, joinedSeatId, roomCode);
          if (response && isActiveAgentArtist(response.snapshot, response.seatId)) {
            const prompt = await cachedPrivatePrompt(response.snapshot, response.seatId, signal);
            state = {
              ...state,
              privatePrompt: prompt.prompt,
              promptCategory: prompt.category,
            };
          }
          return {
            accepted: true,
            status: "joined_and_ready",
            displayName: name,
            controller,
            ...state,
          };
        }),
      }),
    );
  }

  definitions.push(tool({
    name: "configure_match",
    title: "Configure MCPencil match",
    description: "Set the lobby's total rounds and drawing time. Use only when the user asks to change game settings. Practice supports 2, 4, or 6 rounds; team modes support 4, 6, or 8. Drawing time supports 45, 60, or 90 seconds. Only the agent host can call this before play begins.",
    inputSchema: {
      type: "object",
      properties: {
        totalRounds: { type: "integer", enum: [2, 4, 6, 8], description: "Even total rounds; allowed values depend on the room mode." },
        roundDurationMs: { type: "integer", enum: [...ROUND_DURATION_OPTIONS_MS], description: "Drawing time per round in milliseconds." },
      },
      required: ["totalRounds", "roundDurationMs"],
      additionalProperties: false,
    },
    execute: (input, options) => run("configure_match", input, options?.signal, async (signal) => {
      const parsed = ConfigureMatchInput.parse(input);
      const activeSnapshot = snapshotRef.current;
      if (activeSnapshot === null || activeSnapshot.phase !== "lobby") {
        throw new Error("Match settings are available only in the lobby.");
      }
      const roundOptions: readonly number[] = activeSnapshot.mode === "practice"
        ? PRACTICE_ROUND_OPTIONS
        : ARENA_ROUND_OPTIONS;
      if (!roundOptions.includes(parsed.totalRounds)) {
        throw new Error(`${activeSnapshot.mode === "practice" ? "Practice" : "Team modes"} allow ${roundOptions.join(", ")} rounds.`);
      }
      if (!(ROUND_DURATION_OPTIONS_MS as readonly number[]).includes(parsed.roundDurationMs)) {
        throw new Error("Round time must be 45, 60, or 90 seconds.");
      }
      const result = await actionsRef.current.command({
        type: "configure_match",
        totalRounds: parsed.totalRounds,
        roundDurationMs: parsed.roundDurationMs,
        origin: "webmcp",
      }, signal);
      return {
        ...result,
        matchSettings: parsed,
        mustContinue: true,
        nextAction: { tool: "get_match_state", arguments: {}, instruction: "Confirm the synchronized lobby settings and continue preparing the match." },
      };
    }, compactCommand),
  }));

  definitions.push(tool({
    name: "start_match", title: "Start MCPencil match", description: "Start once both teams have two live, ready players. Agent seats are ready automatically.",
    inputSchema: EmptySchema,
    execute: (input, options) => run("start_match", input, options?.signal, async (signal) => {
      const result = await actionsRef.current.command({ type: "start_match", origin: "webmcp" }, signal);
      return {
        ...result,
        mustContinue: true,
        nextAction: { tool: "get_match_state", arguments: {}, instruction: "Read your opening role immediately and continue until match-end." },
      };
    }, compactCommand),
  }));

  {
    definitions.push(
      tool({
        name: "draw_stroke", title: "Draw one stroke now",
        description: "Draw exactly ONE primitive on the 1000x700 canvas. X coordinates must be 0-1000 and Y coordinates 0-700; keep the full ellipse, rectangle, or arc extent inside the visible canvas. Do not narrate, inspect the blank canvas, prepare multiple commands, or plan the full picture. Immediately send one high-information silhouette stroke. When it is acknowledged as persisted and broadcast, immediately call draw_stroke again with the next stroke and the returned canvasVersion. Receiving clients render each broadcast asynchronously.",
        inputSchema: {
          type: "object",
          properties: {
            expectedCanvasVersion: { type: "integer", minimum: 0, description: "Optional. Omit on the first stroke; afterward use the prior draw_stroke response.canvasVersion." },
            primitive: PrimitiveInputSchema,
          },
          required: ["primitive"], additionalProperties: false,
        },
        execute: (input, options) => run("draw_stroke", input, options?.signal, (signal) => {
          const parsed = DrawStrokeInput.parse(input);
          const draw = async () => {
            if (signal.aborted) throw new DOMException("The stroke was cancelled.", "AbortError");
            const expectedVersion = Math.max(parsed.expectedCanvasVersion ?? 0, versionRef.current);
            const payload = DrawBatchCommandSchema.parse({
              type: "draw_batch",
              expectedVersion,
              idempotencyKey: `webmcp-stroke-${crypto.randomUUID()}`,
              primitives: [parsed.primitive],
              origin: "webmcp",
            });
            const result = await actionsRef.current.command(payload, signal);
            return {
              ...result,
              mustContinue: true,
              nextAction: {
                tool: "draw_stroke",
                instruction: `Construct and send exactly one next primitive immediately with expectedCanvasVersion ${result.canvasVersion}; use X 0-1000 and Y 0-700 and keep shape extents visible. Do not narrate or pause to plan.`,
              },
              guidance: `Stroke accepted and broadcast. Immediately call draw_stroke again with ONE next stroke and expectedCanvasVersion ${result.canvasVersion}; do not narrate or pause to plan.`,
            };
          };
          const queued = drawStrokeChainRef.current.then(draw, draw);
          drawStrokeChainRef.current = queued.then(() => undefined, () => undefined);
          return queued;
        }, compactCommand),
      }),
      tool({
        name: "undo_last_stroke", title: "Undo your last stroke",
        description: "Remove your most recently accepted WebMCP stroke from this round, then resume drawing one stroke at a time.",
        inputSchema: { type: "object", properties: { expectedCanvasVersion: { type: "integer", minimum: 0, description: "Optional; defaults to the latest acknowledged canvasVersion." } }, additionalProperties: false },
        execute: (input, options) => run("undo_last_stroke", input, options?.signal, async (signal) => {
          const result = await actionsRef.current.command({
            type: "undo_draw_batch",
            expectedVersion: z.number().int().min(0).optional().parse(input.expectedCanvasVersion) ?? versionRef.current,
            origin: "webmcp",
          }, signal);
          return {
            ...result,
            mustContinue: true,
            nextAction: {
              tool: "draw_stroke",
              instruction: `Construct and send exactly one replacement primitive now with expectedCanvasVersion ${result.canvasVersion}; use X 0-1000 and Y 0-700 and keep shape extents visible.`,
            },
          };
        }, compactCommand),
      }),
    );
  }

  definitions.push(tool({
    name: "submit_guesses", title: "Submit up to three visible guesses",
    description: "Use browser/page visual viewing or screenshot perception to inspect the rendered canvas as the primary picture, then immediately submit 1-3 concise, ordered, distinct candidates. Inspect at the first meaningful drawing and again only when a newer canvasVersion materially changes the scene; do not take a screenshot after every stroke. If page vision is unavailable, use the 32x22 canvasPerception text raster before bounded canvasGeometry. Every candidate is sent to the room and displayed to players, 350ms apart; submission stops on the first correct answer.",
    inputSchema: {
      type: "object",
      properties: {
        guesses: {
          type: "array", minItems: 1, maxItems: 3, uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 80 },
          description: "Best candidate first, followed by at most two genuinely different alternatives.",
        },
      },
      required: ["guesses"], additionalProperties: false,
    },
    annotations: { untrustedContentHint: true },
    execute: (input, options) => run("submit_guesses", input, options?.signal, async (signal) => {
      const { guesses } = SubmitGuessesInput.parse(input);
      const attempts: Array<{
        guess: string;
        correct: boolean;
        close: boolean;
        revision: number;
        canvasVersion: number;
      }> = [];
      let lastResult: CommandResult | null = null;
      for (const [index, guess] of guesses.entries()) {
        if (index > 0) await waitAtLeast(350, signal);
        const result = await actionsRef.current.command({ type: "submit_guess", guess, origin: "webmcp" }, signal);
        lastResult = result;
        attempts.push({
          guess,
          correct: result.correct === true,
          close: result.close === true,
          revision: result.revision,
          canvasVersion: result.canvasVersion,
        });
        if (result.correct) break;
      }
      const correct = attempts.some((attempt) => attempt.correct);
      return {
        accepted: true,
        attempts,
        correct,
        revision: lastResult?.revision ?? snapshotRef.current?.revision ?? 0,
        canvasVersion: lastResult?.canvasVersion ?? versionRef.current,
        remainingMs: lastResult?.remainingMs ?? remainingMs(snapshotRef.current),
        mustContinue: true,
        nextAction: correct
          ? { tool: "get_match_state", arguments: {}, instruction: "The round ended; read the authoritative result and continue to the next round." }
          : {
              tool: "get_match_state",
              arguments: { afterRevision: lastResult?.revision ?? snapshotRef.current?.revision ?? 0, waitMs: 25_000 },
              instruction: "Wait for a newer canvasVersion that materially changes the scene, visually inspect the whole rendered canvas again, and continue guessing. If page vision is unavailable, use canvasPerception before raw canvasGeometry.",
            },
        guidance: correct
          ? "Correct. The round is over, but the match is not complete; continue with nextAction."
          : `All ${attempts.length} guesses were displayed. Wait until a newer canvasVersion materially changes the scene, visually inspect the full rendered canvas again, then submit new candidates. Do not take a screenshot after every stroke; if page vision is unavailable, use canvasPerception before raw canvasGeometry.`,
      };
    }, (output) => `${output.correct ? "Correct" : `${output.attempts.length} guesses displayed`}; canvas v${output.canvasVersion}`),
  }));

  {
    definitions.push(tool({
      name: "get_round_result", title: "Read round result",
      description: "Read the most recently completed round's revealed prompt, outcome, timing, strokes, and tool usage. Practice results are explicitly collaborative and never report a team winner or competitive score. This remains available during the following round.",
      inputSchema: EmptySchema, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input, options) => run("get_round_result", input, options?.signal, () => {
        const currentSnapshot = snapshotRef.current;
        const state = compactWebMcpState(currentSnapshot, seatIdRef.current, roomInviteCode);
        return {
          result: currentSnapshot === null ? null : compactWebMcpRoundResult(currentSnapshot),
          phase: state.phase,
          mustContinue: state.mustContinue,
          completionCondition: state.completionCondition,
          nextAction: state.nextAction,
          ...("competitive" in state ? { competitive: state.competitive } : {}),
          ...("outcome" in state ? { matchOutcome: state.outcome } : {}),
        };
      }, () => "Round result read"),
    }));
  }
  definitions.push(tool({
    name: "ready_next", title: "Ready for next round", description: "Confirm that your seat is ready for the next round. This tool is only available during the results intermission while your seat is unready.",
    inputSchema: EmptySchema,
    execute: (input, options) => run("ready_next", input, options?.signal, async (signal) => {
      const activeSnapshot = snapshotRef.current;
      const readyKey = activeSnapshot ? `${activeSnapshot.roomCode}:${activeSnapshot.roundIndex}` : null;
      if (readyKey) setConsumedReadyNextKey(readyKey);
      try {
        const result = await actionsRef.current.command({
          type: "ready_next",
          expectedRoundIndex: activeSnapshot?.roundIndex ?? 0,
          origin: "webmcp",
        }, signal);
        return {
          ...result,
          mustContinue: true,
          nextAction: {
            tool: "get_match_state",
            arguments: { afterRevision: result.revision, waitMs: 25_000 },
            instruction: "Wait for round prep. The response includes privatePrompt when you become the artist.",
          },
        };
      } catch (reason) {
        if (readyKey) setConsumedReadyNextKey((current) => current === readyKey ? null : current);
        throw reason;
      }
    }, compactCommand),
  }));

  const descriptorEvidence = definitions.map(toolDescriptorEvidence);
  descriptorEvidenceRef.current = new Map(
    descriptorEvidence.map((descriptor) => [descriptor.name, descriptor]),
  );
  const registeredTools = descriptorEvidence.filter((descriptor) => registeredToolNames.has(descriptor.name));
  const actionableTools = toolNames.filter((name) => registeredToolNames.has(name));
  const proofContext = webMcpProofContext(snapshot, seatId);
  const authorizedToolFingerprint = toolNames.join("\u0000");

  useEffect(() => {
    const next = new Set(toolNames);
    const previous = previousAuthorizedToolsRef.current;
    previousAuthorizedToolsRef.current = next;
    if (previous === null) return;

    const createdAt = Date.now();
    const changes: ToolAuthorizationEvent[] = [];
    for (const name of next) {
      if (!previous.has(name)) {
        changes.push({
          id: crypto.randomUUID(),
          tool: name,
          change: "granted",
          createdAt,
          phase: proofContext.phase,
          role: proofContext.role,
        });
      }
    }
    for (const name of previous) {
      if (!next.has(name)) {
        changes.push({
          id: crypto.randomUUID(),
          tool: name,
          change: "revoked",
          createdAt,
          phase: proofContext.phase,
          role: proofContext.role,
        });
      }
    }
    if (changes.length > 0) {
      setAuthorizationEvents((events) => [...changes.reverse(), ...events].slice(0, 18));
    }
  }, [authorizedToolFingerprint, proofContext.phase, proofContext.role]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context) return;

    // Keep the document-facing descriptor set fixed. Role and phase changes only
    // update availableToolsRef, which remains the invocation authorization gate.
    // React StrictMode replays effects in development. Deferring registration by
    // one task lets its synthetic cleanup cancel the first setup before it can
    // mutate the document's WebMCP descriptors.
    let disposed = false;
    const registrationTimer = window.setTimeout(() => {
      if (disposed) return;
      const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));
      for (const name of WEBMCP_REGISTERED_TOOL_NAMES) {
        const definition = definitionsByName.get(name);
        if (!definition || registrationsRef.current.has(name)) continue;
        const registration: ToolRegistration = {
          controller: new AbortController(),
          status: "registering",
        };
        registrationsRef.current.set(name, registration);
        void context.registerTool(definition, { signal: registration.controller.signal }).then(() => {
          if (registrationsRef.current.get(name) !== registration || registration.status === "retiring") return;
          registration.status = "registered";
          markRegistered(name, true);
        }).catch((reason) => {
          if (registrationsRef.current.get(name) !== registration || registration.status === "retiring") return;
          registrationsRef.current.delete(name);
          markRegistered(name, false);
          console.error(`Could not register WebMCP tool ${name}.`, reason);
        });
      }
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(registrationTimer);
      for (const registration of registrationsRef.current.values()) {
        registration.status = "retiring";
        registration.controller.abort();
      }
      registrationsRef.current.clear();
    };
  }, [supported]);

  useEffect(() => () => {
    for (const waiter of Array.from(stateWaitersRef.current)) {
      settleStateWaiter(waiter, snapshotRef.current, new DOMException("The page was closed.", "AbortError"));
    }
  }, []);

  return {
    supported,
    // `toolNames` remains as a compatibility alias for existing App consumers.
    toolNames: actionableTools,
    actionableTools,
    registeredTools,
    proofContext,
    authorizationEvents,
    invocations,
  };
}

function isActiveAgentArtist(snapshot: RoomSnapshot | null, seatId: string | null): snapshot is RoomSnapshot {
  if (!snapshot || !isArtist(snapshot, seatId)) return false;
  return snapshot.seats.find((seat) => seat.id === seatId)?.controller === "agent";
}

function toolDescriptorEvidence(definition: WebMCP.ModelContextTool): WebMcpToolDescriptorEvidence {
  return {
    name: definition.name,
    title: definition.title ?? definition.name,
    description: definition.description,
    ...(definition.annotations ? { annotations: { ...definition.annotations } } : {}),
  };
}

function webMcpProofContext(snapshot: RoomSnapshot | null, seatId: string | null): WebMcpProofContext {
  const seat = snapshot?.seats.find((candidate) => candidate.id === seatId) ?? null;
  const role: WebMcpProofContext["role"] = seat === null
    ? "visitor"
    : snapshot !== null && isArtist(snapshot, seatId)
      ? "artist"
      : snapshot !== null && canGuess(snapshot, seatId) ? "guesser" : "spectator";
  return {
    phase: snapshot?.phase ?? "landing",
    role,
    controller: seat?.controller ?? null,
    seatName: seat?.name ?? null,
    roomCode: snapshot?.roomCode ?? null,
    round: snapshot === null || snapshot.phase === "lobby" ? null : snapshot.roundIndex + 1,
    totalRounds: snapshot?.totalRounds ?? null,
  };
}

function lensResultEvidence(output: unknown): LensResultEvidence | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const record = output as Record<string, unknown>;
  const result: LensResultEvidence = {};
  if (typeof record.accepted === "boolean") result.accepted = record.accepted;
  if (typeof record.revision === "number" && Number.isInteger(record.revision)) result.revision = record.revision;
  if (typeof record.canvasVersion === "number" && Number.isInteger(record.canvasVersion)) {
    result.canvasVersion = record.canvasVersion;
  }
  if (typeof record.batchId === "string" && record.batchId.length > 0) result.batchId = record.batchId;
  if (typeof record.correct === "boolean") result.correct = record.correct;
  if (Array.isArray(record.attempts)) result.attemptCount = record.attempts.length;
  if (typeof record.phase === "string") result.phase = record.phase;
  if (typeof record.yourRole === "string") result.role = record.yourRole;
  if (Object.hasOwn(record, "privatePrompt")) result.promptMasked = true;
  return Object.keys(result).length > 0 ? result : undefined;
}

function safeErrorSummary(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Tool call failed";
  if (/\bprompt\b/i.test(message)) return "Tool call failed while handling a private prompt · content masked";
  return message.slice(0, 180);
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

function defaultAgentName() {
  return `MCP Agent ${crypto.randomUUID().replaceAll("-", "").slice(0, 4).toUpperCase()}`;
}

function waitAtLeast(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException("The guess sequence was cancelled.", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = window.setTimeout(finish, delayMs);
    const cancel = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("The guess sequence was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function summarizeInput(name: string, input: Record<string, unknown>) {
  if (name === "draw_stroke") {
    const primitive = typeof input.primitive === "object" && input.primitive !== null
      ? input.primitive as Record<string, unknown>
      : null;
    const expectedVersion = typeof input.expectedCanvasVersion === "number"
      ? ` · expected canvas v${input.expectedCanvasVersion}`
      : "";
    return `One ${String(primitive?.type ?? "stroke")} primitive${expectedVersion}`;
  }
  if (name === "submit_guesses") {
    const guesses = Array.isArray(input.guesses) ? input.guesses : [];
    return `${guesses.length} visible guess candidate${guesses.length === 1 ? "" : "s"} submitted`;
  }
  if (name === "get_match_state") {
    const afterRevision = typeof input.afterRevision === "number" ? `after revision ${input.afterRevision}` : "current revision";
    const wait = typeof input.waitMs === "number" ? ` · wait up to ${input.waitMs}ms` : "";
    return `${afterRevision}${wait}`;
  }
  if (name === "configure_match") {
    return `${String(input.totalRounds)} rounds · ${String(input.roundDurationMs)}ms drawing time`;
  }
  if (name === "play_mcpencil") {
    const fields = [
      typeof input.roomCode === "string" ? "room code supplied" : null,
      typeof input.name === "string" ? "display name supplied" : null,
      typeof input.team === "string" ? `team ${input.team}` : null,
    ].filter((value): value is string => value !== null);
    return fields.length > 0 ? fields.join(" · ") : "Use the room identified by this page";
  }
  if (name === "start_practice") return "Display name supplied";
  const keys = Object.keys(input);
  return keys.length
    ? keys.map((key) => /prompt|token|secret|password/i.test(key) ? `${key}: masked` : key).join(" · ")
    : "No input";
}
