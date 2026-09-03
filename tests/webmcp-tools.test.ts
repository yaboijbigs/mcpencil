// @vitest-environment node

import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebMcpTools } from "../src/client/hooks/useWebMcpTools";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type CommandResult,
  type JoinRoomResponse,
  type RoomCommand,
  type RoomSnapshot,
} from "../src/shared/game";

type HookProps = Parameters<typeof useWebMcpTools>[0];
type HookResult = ReturnType<typeof useWebMcpTools>;
type RegisteredDefinition = WebMCP.ModelContextTool;

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

class RecordingModelContext {
  readonly registrations: Array<{
    definition: RegisteredDefinition;
    signal?: AbortSignal;
  }> = [];
  readonly tools = new Map<string, RegisteredDefinition>();

  async registerTool(
    definition: RegisteredDefinition,
    options?: WebMCP.ModelContextRegisterToolOptions,
  ) {
    this.registrations.push({ definition, signal: options?.signal });
    this.tools.set(definition.name, definition);
    const unregister = () => this.tools.delete(definition.name);
    options?.signal?.addEventListener("abort", unregister, { once: true });
    if (options?.signal?.aborted) unregister();
  }

  tool(name: string) {
    const definition = this.tools.get(name);
    if (!definition) throw new Error(`Expected ${name} to be registered.`);
    return definition;
  }
}

const human = {
  id: "practice-human",
  name: "Human",
  team: "cobalt" as const,
  controller: "human" as const,
  isHost: true,
  isReady: true,
  isConnected: true,
  score: 0,
};

const agent = {
  id: "practice-agent",
  name: "Ink",
  team: "cobalt" as const,
  controller: "agent" as const,
  isHost: false,
  isReady: true,
  isConnected: true,
  score: 0,
};

function practiceSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomCode: "AB2DE",
    mode: "practice",
    phase: "drawing",
    revision: 1,
    roundIndex: 0,
    totalRounds: 2,
    roundDurationMs: 90_000,
    activeTeam: "cobalt",
    artistSeatId: agent.id,
    endsAt: Date.now() + 90_000,
    canvasVersion: 0,
    scores: { cobalt: 0, coral: 0 },
    seats: [human, agent],
    canvas: [],
    guesses: [],
    activity: [],
    roundResult: null,
    analytics: {
      totalStrokes: 0,
      totalToolCalls: 0,
      correctGuesses: 0,
      averageGuessMs: null,
      byOrigin: { "human-ui": 0, webmcp: 0 },
    },
    ...overrides,
  };
}

function commandResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    accepted: true,
    revision: 1,
    canvasVersion: 0,
    remainingMs: 60_000,
    ...overrides,
  };
}

function Harness(props: HookProps) {
  latestHookResult = useWebMcpTools(props);
  return null;
}

let latestHookResult: HookResult | null = null;

async function settleRegistration() {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await Promise.resolve();
}

async function mountHook(props: HookProps) {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(null);
    renderer.unstable_flushSync(() => renderer!.update(createElement(Harness, props)));
    await settleRegistration();
  });
  if (!renderer) throw new Error("Hook renderer did not mount.");
  return renderer;
}

async function updateHook(renderer: ReactTestRenderer, props: HookProps) {
  await act(async () => {
    renderer.unstable_flushSync(() => renderer.update(createElement(Harness, props)));
    await Promise.resolve();
  });
}

function toolSignal() {
  return { signal: new AbortController().signal };
}

function propsForSnapshot(snapshot: RoomSnapshot): HookProps {
  return {
    snapshot,
    seatId: agent.id,
    command: vi.fn(async () => commandResult()),
    privatePrompt: vi.fn(async () => ({ prompt: "camera", category: "objects", roundIndex: 0 })),
    startPractice: vi.fn(async () => undefined),
    joinMatch: vi.fn(async () => undefined),
  };
}

function useFakeWindowTimers() {
  // Mount first: tool registration intentionally waits for a real browser task.
  vi.useFakeTimers();
  Object.assign(window, {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
}

function primitiveCases(schema: object) {
  const root = schema as {
    properties?: { primitive?: { oneOf?: Array<Record<string, unknown>> } };
  };
  return root.properties?.primitive?.oneOf ?? [];
}

function primitiveCase(schema: object, type: string) {
  const match = primitiveCases(schema).find((candidate) => {
    const properties = candidate.properties as Record<string, { const?: string }> | undefined;
    return properties?.type?.const === type;
  });
  if (!match) throw new Error(`Missing advertised ${type} primitive schema.`);
  return match as {
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, Record<string, unknown>>;
  };
}

describe("registered WebMCP tool contracts", () => {
  let modelContext: RecordingModelContext;

  beforeEach(() => {
    modelContext = new RecordingModelContext();
    latestHookResult = null;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { modelContext },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "https://mcpencil.com/?room=AB2DE&invite=agent",
          origin: "https://mcpencil.com",
        },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      },
    });
    expect(globalThis.document).toMatchObject({ modelContext });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("advertises and enforces the 90, 120, and 150-second lobby settings", async () => {
    const command = vi.fn(async () => commandResult());
    const props: HookProps = {
      snapshot: practiceSnapshot({
        phase: "lobby",
        totalRounds: 4,
        artistSeatId: null,
        endsAt: null,
        seats: [{ ...agent, isHost: true }],
      }),
      seatId: agent.id,
      command,
      privatePrompt: vi.fn(async () => ({ prompt: "camera", category: "objects", roundIndex: 0 })),
      startPractice: vi.fn(async () => undefined),
      joinMatch: vi.fn(async () => undefined),
    };
    const renderer = await mountHook(props);
    const configure = modelContext.tool("configure_match");

    expect(configure.inputSchema).toMatchObject({
      properties: {
        roundDurationMs: { type: "integer", enum: [90_000, 120_000, 150_000] },
      },
      required: ["totalRounds", "roundDurationMs"],
    });
    expect(configure.description).toContain("90, 120, or 150 seconds");

    for (const roundDurationMs of [90_000, 120_000, 150_000]) {
      await act(async () => {
        await expect(configure.execute({ totalRounds: 4, roundDurationMs }, toolSignal()))
          .resolves.toMatchObject({
            accepted: true,
            matchSettings: { totalRounds: 4, roundDurationMs },
          });
      });
      expect(command).toHaveBeenLastCalledWith({
        type: "configure_match",
        totalRounds: 4,
        roundDurationMs,
        origin: "webmcp",
      }, expect.any(AbortSignal));
    }

    for (const roundDurationMs of [45_000, 60_000]) {
      await act(async () => {
        await expect(configure.execute({ totalRounds: 4, roundDurationMs }, toolSignal()))
          .rejects.toThrow("Round time must be 90, 120, or 150 seconds.");
      });
    }
    expect(command).toHaveBeenCalledTimes(3);

    await act(async () => renderer.unmount());
  });

  it("registers a stable page-lifetime descriptor set with exact annotations and primitive schemas", async () => {
    const props: HookProps = {
      snapshot: null,
      seatId: null,
      command: vi.fn(async () => commandResult()),
      privatePrompt: vi.fn(async () => ({ prompt: "sleepy turtle", category: "characters", roundIndex: 0 })),
      startPractice: vi.fn(async () => undefined),
      joinMatch: vi.fn(async () => undefined),
    };
    const renderer = await mountHook(props);

    expect(modelContext.registrations.map(({ definition }) => definition.name)).toEqual([
      "get_match_state",
      "start_practice",
      "play_mcpencil",
      "configure_match",
      "start_match",
      "draw_stroke",
      "undo_last_stroke",
      "submit_guesses",
      "get_round_result",
      "ready_next",
    ]);
    expect(modelContext.tool("get_match_state").annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(modelContext.tool("get_round_result").annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(modelContext.tool("submit_guesses").annotations).toEqual({
      untrustedContentHint: true,
    });
    expect(modelContext.tool("get_match_state").description).toContain(
      "rendered page/canvas as the primary picture",
    );
    expect(modelContext.tool("get_match_state").description).toContain(
      "canvasPerception is a fast 32x22 text raster fallback",
    );
    expect(modelContext.tool("submit_guesses").description).toMatch(
      /rendered canvas as the primary picture.*immediately submit/i,
    );
    expect(modelContext.tool("submit_guesses").description).toContain(
      "first meaningful drawing",
    );
    expect(modelContext.tool("submit_guesses").description).toContain(
      "canvasVersion differs from your last observed picture and materially changes the scene",
    );
    expect(modelContext.tool("submit_guesses").description).toContain(
      "do not take a screenshot after every stroke",
    );
    expect(modelContext.tool("submit_guesses").description).toContain(
      "canvasPerception text raster before bounded canvasGeometry",
    );
    expect(latestHookResult?.registeredTools).toHaveLength(10);
    expect(latestHookResult?.registeredTools.find(({ name }) => name === "get_match_state")).toMatchObject({
      name: "get_match_state",
      title: "Inspect MCPencil match",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    });
    expect(latestHookResult?.actionableTools).toEqual(latestHookResult?.toolNames);
    expect(latestHookResult?.proofContext).toMatchObject({
      phase: "landing",
      role: "visitor",
      controller: null,
    });

    const drawSchema = modelContext.tool("draw_stroke").inputSchema!;
    expect(primitiveCases(drawSchema)).toHaveLength(6);
    expect(primitiveCase(drawSchema, "line")).toMatchObject({
      required: ["color", "width", "type", "x1", "y1", "x2", "y2"],
      additionalProperties: false,
    });
    expect(primitiveCase(drawSchema, "polyline")).toMatchObject({
      required: ["color", "width", "type", "points"],
      additionalProperties: false,
      properties: { points: { minItems: 2, maxItems: 48 } },
    });
    expect(primitiveCase(drawSchema, "ellipse")).toMatchObject({
      required: ["color", "width", "type", "cx", "cy", "rx", "ry"],
      additionalProperties: false,
    });
    expect(primitiveCase(drawSchema, "rectangle")).toMatchObject({
      required: ["color", "width", "type", "x", "y", "rectWidth", "rectHeight"],
      additionalProperties: false,
    });
    expect(primitiveCase(drawSchema, "arc")).toMatchObject({
      required: ["color", "width", "type", "cx", "cy", "radius", "startAngle", "endAngle"],
      additionalProperties: false,
      properties: {
        startAngle: { minimum: -360, maximum: 360 },
        endAngle: { minimum: -360, maximum: 720 },
      },
    });
    expect(primitiveCase(drawSchema, "polygon")).toMatchObject({
      required: ["color", "width", "type", "points"],
      additionalProperties: false,
      properties: { points: { minItems: 3, maxItems: 24 } },
    });

    const line = primitiveCase(drawSchema, "line").properties;
    expect(line.x1).toMatchObject({ minimum: 0, maximum: CANVAS_WIDTH });
    expect(line.y1).toMatchObject({ minimum: 0, maximum: CANVAS_HEIGHT });
    const point = (primitiveCase(drawSchema, "polyline").properties.points.items as {
      properties: Record<string, unknown>;
    }).properties;
    expect(point.x).toMatchObject({ minimum: 0, maximum: CANVAS_WIDTH });
    expect(point.y).toMatchObject({ minimum: 0, maximum: CANVAS_HEIGHT });

    await act(async () => renderer.unmount());
    expect(modelContext.registrations.every(({ signal }) => signal?.aborted)).toBe(true);
    expect(modelContext.tools.size).toBe(0);
  });

  it("executes a complete two-round Sketch Duet through the registered handlers", async () => {
    let revision = 1;
    let canvasVersion = 0;
    const commands: RoomCommand[] = [];
    const command = vi.fn(async (roomCommand: RoomCommand, signal?: AbortSignal) => {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      commands.push(roomCommand);
      revision += 1;
      if (roomCommand.type === "draw_batch" || roomCommand.type === "undo_draw_batch") canvasVersion += 1;
      return commandResult({
        revision,
        canvasVersion,
        ...(roomCommand.type === "draw_batch" ? { batchId: `batch-${canvasVersion}` } : {}),
        ...(roomCommand.type === "submit_guess"
          ? { correct: roomCommand.guess === "camera", close: false }
          : {}),
      });
    });
    const firstDrawing = practiceSnapshot();
    const joinResponse: JoinRoomResponse = {
      roomCode: firstDrawing.roomCode,
      seatId: agent.id,
      token: "t".repeat(32),
      snapshot: firstDrawing,
    };
    const privatePrompt = vi.fn(async () => ({
      prompt: "sleepy turtle",
      category: "characters",
      roundIndex: 0,
    }));
    const baseProps: HookProps = {
      snapshot: null,
      seatId: null,
      command,
      privatePrompt,
      startPractice: vi.fn(async () => undefined),
      joinMatch: vi.fn(async () => joinResponse),
    };
    const renderer = await mountHook(baseProps);

    const playResult = await modelContext.tool("play_mcpencil").execute({}, toolSignal()) as Record<string, unknown>;
    expect(playResult).toMatchObject({
      accepted: true,
      status: "joined_and_ready",
      phase: "drawing",
      yourRole: "artist",
      privatePrompt: "sleepy turtle",
      nextAction: { tool: "draw_stroke" },
    });

    await updateHook(renderer, { ...baseProps, snapshot: firstDrawing, seatId: agent.id });
    expect(latestHookResult?.toolNames).toEqual([
      "get_match_state",
      "draw_stroke",
      "undo_last_stroke",
    ]);
    expect(latestHookResult?.actionableTools).toEqual(latestHookResult?.toolNames);
    expect(latestHookResult?.proofContext).toMatchObject({
      phase: "drawing",
      role: "artist",
      controller: "agent",
      round: 1,
      totalRounds: 2,
    });
    expect(latestHookResult?.authorizationEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "draw_stroke", change: "granted", role: "artist" }),
      expect.objectContaining({ tool: "play_mcpencil", change: "revoked", role: "artist" }),
    ]));
    await expect(modelContext.tool("submit_guesses").execute({ guesses: ["turtle"] }, toolSignal()))
      .rejects.toThrow("not available");

    let stateResult: Record<string, unknown> = {};
    await act(async () => {
      stateResult = await modelContext.tool("get_match_state").execute({}, toolSignal()) as Record<string, unknown>;
    });
    expect(stateResult).toMatchObject({
      yourRole: "artist",
      privatePrompt: "sleepy turtle",
      nextAction: { tool: "draw_stroke" },
    });

    let strokeResult: Record<string, unknown> = {};
    await act(async () => {
      strokeResult = await modelContext.tool("draw_stroke").execute({
        primitive: {
          type: "ellipse",
          cx: 500,
          cy: 350,
          rx: 120,
          ry: 70,
          color: "leaf",
          width: 7,
        },
      }, toolSignal()) as Record<string, unknown>;
    });
    expect(strokeResult).toMatchObject({
      accepted: true,
      canvasVersion: 1,
      batchId: "batch-1",
      nextAction: {
        tool: "draw_stroke",
        instruction: expect.stringContaining("expectedCanvasVersion 1"),
      },
    });
    expect(JSON.stringify(strokeResult)).not.toContain("ONE_NEXT_PRIMITIVE");
    expect((strokeResult.nextAction as Record<string, unknown>)).not.toHaveProperty("arguments");
    expect(latestHookResult?.invocations.find(({ tool }) => tool === "draw_stroke")).toMatchObject({
      status: "ok",
      provenance: "webmcp",
      batchId: "batch-1",
      result: {
        accepted: true,
        canvasVersion: 1,
        batchId: "batch-1",
      },
    });
    expect(latestHookResult?.invocations.find(({ tool }) => tool === "get_match_state")).toMatchObject({
      outputSummary: expect.stringContaining("prompt masked"),
      result: { role: "artist", promptMasked: true },
    });
    expect(JSON.stringify(latestHookResult?.invocations)).not.toContain("sleepy turtle");

    const undoResult = await modelContext.tool("undo_last_stroke").execute({
      expectedCanvasVersion: 1,
    }, toolSignal()) as Record<string, unknown>;
    expect(undoResult).toMatchObject({
      canvasVersion: 2,
      nextAction: {
        tool: "draw_stroke",
        instruction: expect.stringContaining("expectedCanvasVersion 2"),
      },
    });
    expect(JSON.stringify(undoResult)).not.toContain("ONE_REPLACEMENT_PRIMITIVE");
    expect((undoResult.nextAction as Record<string, unknown>)).not.toHaveProperty("arguments");

    const firstRoundResult = {
      roundIndex: 0,
      prompt: "sleepy turtle",
      artistSeatId: agent.id,
      team: "cobalt" as const,
      guessedBySeatId: human.id,
      pointsAwarded: 150,
      elapsedMs: 40_000,
      strokeCount: 1,
      toolCallCount: 2,
    };
    const roundEnd = practiceSnapshot({
      phase: "round-end",
      revision,
      canvasVersion,
      roundResult: firstRoundResult,
      guesses: [{
        id: "first-round-guess",
        roundIndex: 0,
        seatId: human.id,
        displayName: human.name,
        guess: "sleepy turtle",
        origin: "human-ui",
        isCorrect: true,
        createdAt: Date.now(),
      }],
      seats: [human, { ...agent, isReady: false }],
    });
    await updateHook(renderer, { ...baseProps, snapshot: roundEnd, seatId: agent.id });
    expect(latestHookResult?.toolNames).toEqual([
      "get_match_state",
      "get_round_result",
      "ready_next",
    ]);
    await expect(modelContext.tool("draw_stroke").execute({
      primitive: {
        type: "line", x1: 1, y1: 1, x2: 2, y2: 2, color: "ink", width: 3,
      },
    }, toolSignal())).rejects.toThrow("not available");

    const firstResult = await modelContext.tool("get_round_result").execute({}, toolSignal()) as Record<string, unknown>;
    expect(firstResult).toMatchObject({
      result: {
        prompt: "sleepy turtle",
        competitive: false,
        guessTranscript: [{
          player: "Human",
          guess: "sleepy turtle",
          provenance: "human-ui",
          correct: true,
        }],
      },
      mustContinue: true,
    });
    await act(async () => {
      await modelContext.tool("ready_next").execute({}, toolSignal());
    });
    expect(commands.at(-1)).toMatchObject({ type: "ready_next", expectedRoundIndex: 0, origin: "webmcp" });

    const secondDrawing = practiceSnapshot({
      phase: "drawing",
      revision,
      roundIndex: 1,
      artistSeatId: human.id,
      canvasVersion: 1,
      roundResult: firstRoundResult,
      canvas: [{
        id: "human-stroke",
        batchId: "human-batch",
        canvasVersion: 1,
        roundIndex: 1,
        seatId: human.id,
        origin: "human-ui",
        createdAt: Date.now(),
        primitive: {
          type: "rectangle",
          x: 400,
          y: 200,
          rectWidth: 200,
          rectHeight: 160,
          color: "ink",
          width: 7,
        },
      }],
      seats: [human, agent],
    });
    await updateHook(renderer, { ...baseProps, snapshot: secondDrawing, seatId: agent.id });
    expect(latestHookResult?.toolNames).toEqual([
      "get_match_state",
      "submit_guesses",
      "get_round_result",
    ]);
    const secondState = await modelContext.tool("get_match_state").execute({}, toolSignal()) as Record<string, unknown>;
    expect(secondState).toMatchObject({
      round: 2,
      yourRole: "guesser",
      canvasVersion: 1,
      nextAction: { tool: "submit_guesses" },
    });
    expect(secondState.guidance).toEqual(expect.stringContaining(
      "rendered page/canvas visual as the primary picture",
    ));
    expect(secondState.guidance).toEqual(expect.stringContaining(
      "canvasPerception is a fast 32x22",
    ));
    expect(secondState.guidance).toEqual(expect.stringContaining(
      "use canvasGeometry only as a final cross-check",
    ));
    expect(secondState).toMatchObject({
      canvasPerception: { format: "ascii-raster-v1", width: 32, height: 22 },
    });
    expect((secondState.nextAction as Record<string, unknown>).instruction).toMatch(
      /current picture and guidance.*submit 1-3 ordered, distinct candidates immediately/i,
    );

    const guessResult = await modelContext.tool("submit_guesses").execute({
      guesses: ["camera"],
    }, toolSignal()) as Record<string, unknown>;
    expect(guessResult).toMatchObject({
      accepted: true,
      correct: true,
      attempts: [{ guess: "camera", correct: true }],
      nextAction: { tool: "get_match_state", arguments: {} },
    });

    const finalResult = {
      roundIndex: 1,
      prompt: "camera",
      artistSeatId: human.id,
      team: "cobalt" as const,
      guessedBySeatId: agent.id,
      pointsAwarded: 160,
      elapsedMs: 30_000,
      strokeCount: 1,
      toolCallCount: 1,
    };
    const matchEnd = practiceSnapshot({
      phase: "match-end",
      revision,
      roundIndex: 1,
      artistSeatId: human.id,
      canvasVersion: 1,
      roundResult: finalResult,
      analytics: { ...secondDrawing.analytics, correctGuesses: 2 },
    });
    await updateHook(renderer, { ...baseProps, snapshot: matchEnd, seatId: agent.id });
    const complete = await modelContext.tool("get_match_state").execute({}, toolSignal()) as Record<string, unknown>;
    expect(complete).toMatchObject({
      phase: "match-end",
      mustContinue: false,
      competitive: false,
      outcome: { kind: "practice_complete", winner: null, roundsPlayed: 2, solvedRounds: 2 },
      nextAction: { tool: null, arguments: {} },
    });
    expect(complete).not.toHaveProperty("scores");

    await act(async () => renderer.unmount());
    expect(commands.map(({ type }) => type)).toEqual([
      "draw_batch",
      "undo_draw_batch",
      "ready_next",
      "submit_guess",
    ]);
  });

  it("lets an agent non-artist guess and read individual Free-for-All results", async () => {
    const agentGuesser = { ...agent, team: "coral" as const, score: 175 };
    const rival = {
      id: "free-for-all-rival",
      name: "Pixel",
      team: "coral" as const,
      controller: "human" as const,
      isHost: false,
      isReady: true,
      isConnected: true,
      score: 175,
    };
    const artist = { ...human, score: 90 };
    const leaderboard = [
      {
        seatId: agentGuesser.id,
        name: agentGuesser.name,
        controller: agentGuesser.controller,
        score: 175,
        placement: 1,
        successfulDrawings: 0,
        correctGuesses: 1,
        fastestSolveMs: 40_000,
        averageSolveMs: 40_000,
      },
      {
        seatId: rival.id,
        name: rival.name,
        controller: rival.controller,
        score: 175,
        placement: 1,
        successfulDrawings: 1,
        correctGuesses: 0,
        fastestSolveMs: null,
        averageSolveMs: null,
      },
      {
        seatId: artist.id,
        name: artist.name,
        controller: artist.controller,
        score: 90,
        placement: 3,
        successfulDrawings: 0,
        correctGuesses: 0,
        fastestSolveMs: null,
        averageSolveMs: null,
      },
    ];
    const drawing = practiceSnapshot({
      mode: "free-for-all",
      totalRounds: 3,
      artistSeatId: artist.id,
      seats: [artist, agentGuesser, rival],
      leaderboard,
    });
    const command = vi.fn(async (roomCommand: RoomCommand) => commandResult({
      revision: 2,
      ...(roomCommand.type === "submit_guess"
        ? { correct: roomCommand.guess === "volcano", close: false, pointsAwarded: 140 }
        : {}),
    }));
    const props: HookProps = {
      snapshot: drawing,
      seatId: agentGuesser.id,
      command,
      privatePrompt: vi.fn(async () => ({ prompt: "volcano", category: "nature", roundIndex: 0 })),
      startPractice: vi.fn(async () => undefined),
      joinMatch: vi.fn(async () => undefined),
    };
    const renderer = await mountHook(props);

    expect(latestHookResult?.toolNames).toEqual(["get_match_state", "submit_guesses"]);
    expect(latestHookResult?.actionableTools).toEqual(latestHookResult?.toolNames);
    const state = await modelContext.tool("get_match_state").execute({}, toolSignal()) as Record<string, unknown>;
    expect(state).toMatchObject({
      mode: "free-for-all",
      scoring: "individual",
      yourRole: "guesser",
      yourScore: 175,
      leaderboard,
      nextAction: { tool: "submit_guesses" },
    });
    expect(state).not.toHaveProperty("yourTeam");
    expect(state).not.toHaveProperty("activeTeam");
    expect(state).not.toHaveProperty("scores");

    const guess = await modelContext.tool("submit_guesses").execute({
      guesses: ["volcano"],
    }, toolSignal()) as Record<string, unknown>;
    expect(guess).toMatchObject({
      accepted: true,
      correct: true,
      attempts: [{ guess: "volcano", correct: true }],
      nextAction: { tool: "get_match_state" },
    });
    expect(command).toHaveBeenCalledWith({
      type: "submit_guess",
      guess: "volcano",
      origin: "webmcp",
    }, expect.any(AbortSignal));

    const roundEnd = practiceSnapshot({
      ...drawing,
      phase: "round-end",
      roundResult: {
        roundIndex: 0,
        prompt: "volcano",
        artistSeatId: artist.id,
        team: "cobalt",
        guessedBySeatId: agentGuesser.id,
        pointsAwarded: 140,
        artistPointsAwarded: 140,
        guesserPointsAwarded: 140,
        elapsedMs: 50_000,
        strokeCount: 6,
        toolCallCount: 0,
      },
      guesses: [{
        id: "free-for-all-guess",
        roundIndex: 0,
        seatId: agentGuesser.id,
        displayName: agentGuesser.name,
        guess: "volcano",
        origin: "webmcp",
        isCorrect: true,
        createdAt: Date.now(),
      }],
    });
    await updateHook(renderer, { ...props, snapshot: roundEnd });
    const roundResult = await modelContext.tool("get_round_result").execute({}, toolSignal()) as Record<string, unknown>;
    expect(roundResult).toMatchObject({
      result: {
        prompt: "volcano",
        artist: artist.name,
        guessedBy: agentGuesser.name,
        artistPointsAwarded: 140,
        guesserPointsAwarded: 140,
        scoring: "individual",
        instruction: expect.stringContaining("independently"),
      },
    });
    expect(JSON.stringify(roundResult)).not.toContain("team_result");

    const matchEnd = { ...roundEnd, phase: "match-end" as const };
    await updateHook(renderer, { ...props, snapshot: matchEnd });
    const complete = await modelContext.tool("get_match_state").execute({}, toolSignal()) as Record<string, unknown>;
    expect(complete).toMatchObject({
      mustContinue: false,
      scoring: "individual",
      outcome: {
        kind: "individual_result",
        winners: [
          { seatId: agentGuesser.id, name: agentGuesser.name, score: 175 },
          { seatId: rival.id, name: rival.name, score: 175 },
        ],
      },
    });
    expect(complete).not.toHaveProperty("yourTeam");
    expect(complete).not.toHaveProperty("activeTeam");
    expect(complete).not.toHaveProperty("scores");
    expect(JSON.stringify(complete)).not.toContain("team_result");

    await act(async () => renderer.unmount());
  });

  it("joins successfully from a fresh isolated agent view", async () => {
    Object.assign(window.location, {
      href: "https://agent.mcpencil.com/webmcp/rooms/AB2DE?invite=agent#webmcp",
      origin: "https://agent.mcpencil.com",
    });
    const joinedSnapshot = practiceSnapshot({
      phase: "lobby",
      artistSeatId: null,
      endsAt: null,
      seats: [agent],
    });
    const response: JoinRoomResponse = {
      roomCode: "AB2DE",
      seatId: agent.id,
      token: "t".repeat(32),
      snapshot: joinedSnapshot,
    };
    const joinMatch = vi.fn(async () => response);
    const props: HookProps = {
      snapshot: null,
      seatId: null,
      command: vi.fn(async () => commandResult()),
      privatePrompt: vi.fn(async () => ({ prompt: "camera", category: "objects", roundIndex: 0 })),
      startPractice: vi.fn(async () => undefined),
      joinMatch,
      humanHostDocument: false,
    };
    const renderer = await mountHook(props);

    const result = await modelContext.tool("play_mcpencil").execute({}, toolSignal()) as Record<string, unknown>;
    expect(result).toMatchObject({
      accepted: true,
      status: "joined_and_ready",
      roomCode: "AB2DE",
      yourSeatId: agent.id,
    });
    expect(joinMatch).toHaveBeenCalledOnce();
    expect(joinMatch).toHaveBeenCalledWith(expect.objectContaining({
      roomCode: "AB2DE",
      controller: "agent",
    }));

    await act(async () => renderer.unmount());
  });

  it("rejects play_mcpencil on a seated human host and returns the exact isolated invite", async () => {
    const humanLobby = practiceSnapshot({
      phase: "lobby",
      artistSeatId: null,
      endsAt: null,
      seats: [human],
    });
    const joinMatch = vi.fn(async () => undefined);
    const props: HookProps = {
      snapshot: humanLobby,
      seatId: null,
      humanHostDocument: true,
      command: vi.fn(async () => commandResult()),
      privatePrompt: vi.fn(async () => ({ prompt: "camera", category: "objects", roundIndex: 0 })),
      startPractice: vi.fn(async () => undefined),
      joinMatch,
    };
    const renderer = await mountHook(props);

    expect(latestHookResult?.toolNames).toContain("play_mcpencil");
    await expect(modelContext.tool("play_mcpencil").execute({}, toolSignal())).rejects.toThrow(
      "Open the exact agent invite in a separate agent tab or view: <https://agent.mcpencil.com/webmcp/rooms/AB2DE?invite=agent#webmcp>",
    );
    expect(joinMatch).not.toHaveBeenCalled();

    await act(async () => renderer.unmount());
  });

  it("forwards execution cancellation to a registered handler", async () => {
    const drawing = practiceSnapshot();
    const props: HookProps = {
      snapshot: drawing,
      seatId: agent.id,
      command: vi.fn(async () => commandResult()),
      privatePrompt: vi.fn(async () => ({ prompt: "sleepy turtle", category: "characters", roundIndex: 0 })),
      startPractice: vi.fn(async () => undefined),
      joinMatch: vi.fn(async () => undefined),
    };
    const renderer = await mountHook(props);
    const controller = new AbortController();
    const pending = modelContext.tool("get_match_state").execute({
      afterRevision: drawing.revision,
      waitMs: 25_000,
    }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => renderer.unmount());
  });

  it.each([25_000, 2_000, 750, 0])(
    "bounds active agent-guesser waits while honoring a requested %i ms wait",
    async (waitMs) => {
      const drawing = practiceSnapshot({ artistSeatId: human.id });
      const props = propsForSnapshot(drawing);
      const renderer = await mountHook(props);
      useFakeWindowTimers();
      let settled = false;
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = Promise.resolve(modelContext.tool("get_match_state").execute({
          afterRevision: drawing.revision,
          waitMs,
        }, toolSignal()));
        void pending.then(() => { settled = true; });
        await Promise.resolve();
      });

      const expectedWait = Math.min(waitMs, 2_000);
      if (expectedWait > 0) {
        expect(settled).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(expectedWait - 1); });
        expect(settled).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      }
      await expect(pending).resolves.toMatchObject({
        revision: drawing.revision,
        yourRole: "guesser",
        waitTimedOut: true,
      });
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(props.privatePrompt).not.toHaveBeenCalled();
      expect(await pending).not.toHaveProperty("privatePrompt");
      await act(async () => renderer.unmount());
    },
  );

  it.each(["drawing", "round-end"] as const)(
    "wakes an active guesser immediately for a pushed newer %s revision",
    async (phase) => {
      const drawing = practiceSnapshot({ artistSeatId: human.id });
      const props = propsForSnapshot(drawing);
      const renderer = await mountHook(props);
      useFakeWindowTimers();
      let settled = false;
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = Promise.resolve(modelContext.tool("get_match_state").execute({
          afterRevision: drawing.revision,
          waitMs: 25_000,
        }, toolSignal()));
        void pending.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(settled).toBe(false);

      await updateHook(renderer, {
        ...props,
        snapshot: { ...drawing, phase, revision: drawing.revision + 1 },
      });
      await expect(pending).resolves.toMatchObject({
        phase,
        revision: drawing.revision + 1,
      });
      expect(await pending).not.toHaveProperty("waitTimedOut");
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(props.privatePrompt).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    },
  );

  it.each([
    { label: "lobby", overrides: { phase: "lobby", artistSeatId: null, endsAt: null } },
    { label: "ready round-end", overrides: { phase: "round-end", artistSeatId: human.id } },
    {
      label: "opposing-team spectator",
      overrides: {
        mode: "arena",
        artistSeatId: human.id,
        seats: [human, { ...agent, team: "coral" }],
      },
    },
  ] satisfies Array<{ label: string; overrides: Partial<RoomSnapshot> }>)(
    "preserves the full between-turn wait for a $label",
    async ({ overrides }) => {
      const snapshot = practiceSnapshot(overrides);
      const props = propsForSnapshot(snapshot);
      const renderer = await mountHook(props);
      useFakeWindowTimers();
      let settled = false;
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = Promise.resolve(modelContext.tool("get_match_state").execute({
          afterRevision: snapshot.revision,
          waitMs: 25_000,
        }, toolSignal()));
        void pending.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(settled).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(22_999); });
      expect(settled).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await expect(pending).resolves.toMatchObject({ revision: snapshot.revision, waitTimedOut: true });
      expect(vi.getTimerCount()).toBe(0);
      expect(props.privatePrompt).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    },
  );

  it.each(["cancel", "unmount"] as const)(
    "rejects an active guesser wait on %s and releases its timer",
    async (action) => {
      const drawing = practiceSnapshot({ artistSeatId: human.id });
      const renderer = await mountHook(propsForSnapshot(drawing));
      useFakeWindowTimers();
      const controller = new AbortController();
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = Promise.resolve(modelContext.tool("get_match_state").execute({
          afterRevision: drawing.revision,
          waitMs: 25_000,
        }, { signal: controller.signal }));
      });
      expect(vi.getTimerCount()).toBe(1);
      const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await act(async () => {
        if (action === "cancel") controller.abort();
        else renderer.unmount();
        await Promise.resolve();
      });
      await rejection;
      expect(vi.getTimerCount()).toBe(0);
      if (action === "cancel") await act(async () => renderer.unmount());
    },
  );

  it("keeps guesses 350 ms apart and requests a short refinement wait after misses", async () => {
    const props = propsForSnapshot(practiceSnapshot({ artistSeatId: human.id }));
    const command = vi.fn(async () => commandResult({
      revision: 7,
      canvasVersion: 3,
      correct: false,
      close: true,
    }));
    const renderer = await mountHook({ ...props, command });
    useFakeWindowTimers();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = Promise.resolve(modelContext.tool("submit_guesses").execute({
        guesses: ["camera", "binoculars", "projector"],
      }, toolSignal()));
      await Promise.resolve();
    });
    expect(command).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(349); });
    expect(command).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(command).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(349); });
    expect(command).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    const result = await pending as Record<string, unknown>;
    expect(command).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      accepted: true,
      correct: false,
      revision: 7,
      canvasVersion: 3,
      attempts: [
        { guess: "camera", correct: false, close: true },
        { guess: "binoculars", correct: false, close: true },
        { guess: "projector", correct: false, close: true },
      ],
      nextAction: {
        tool: "get_match_state",
        arguments: { afterRevision: 7, waitMs: 2_000 },
      },
    });
    const guidance = `${result.guidance} ${(result.nextAction as Record<string, unknown>).instruction}`;
    expect(guidance).toMatch(/distinct|different/i);
    expect(guidance).toMatch(/close/i);
    expect(guidance).toMatch(/existing|same|reuse/i);
    expect(vi.getTimerCount()).toBe(0);
    expect(props.privatePrompt).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it("stops a spaced guess sequence immediately after the first correct candidate", async () => {
    const command = vi.fn(async (roomCommand: RoomCommand) => commandResult({
      correct: roomCommand.type === "submit_guess" && roomCommand.guess === "camera",
    }));
    const props = propsForSnapshot(practiceSnapshot({ artistSeatId: human.id }));
    const renderer = await mountHook({ ...props, command });
    useFakeWindowTimers();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = Promise.resolve(modelContext.tool("submit_guesses").execute({
        guesses: ["binoculars", "camera", "projector"],
      }, toolSignal()));
      await vi.advanceTimersByTimeAsync(350);
    });
    await expect(pending).resolves.toMatchObject({
      correct: true,
      attempts: [{ guess: "binoculars", correct: false }, { guess: "camera", correct: true }],
      nextAction: { tool: "get_match_state", arguments: {} },
    });
    expect(command).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(props.privatePrompt).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it("serializes drawing behind server acknowledgement and reuses its canvas version", async () => {
    const acknowledgements: Array<(result: CommandResult) => void> = [];
    const command = vi.fn((_roomCommand: RoomCommand) => new Promise<CommandResult>((resolve) => {
      acknowledgements.push(resolve);
    }));
    const renderer = await mountHook({ ...propsForSnapshot(practiceSnapshot()), command });
    const primitive = { type: "line", x1: 100, y1: 100, x2: 200, y2: 200, color: "ink", width: 7 };
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = Promise.resolve(modelContext.tool("draw_stroke").execute({ primitive }, toolSignal()));
      second = Promise.resolve(modelContext.tool("draw_stroke").execute({
        primitive: { ...primitive, y2: 250 },
      }, toolSignal()));
      await Promise.resolve();
    });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][0]).toMatchObject({
      type: "draw_batch",
      expectedVersion: 0,
      primitives: [primitive],
      origin: "webmcp",
    });

    let firstResult: Record<string, unknown> = {};
    await act(async () => {
      acknowledgements[0](commandResult({ revision: 2, canvasVersion: 1, batchId: "stroke-1" }));
      firstResult = await first as Record<string, unknown>;
      await Promise.resolve();
    });
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[1][0]).toMatchObject({
      type: "draw_batch",
      expectedVersion: 1,
      primitives: [{ ...primitive, y2: 250 }],
      origin: "webmcp",
    });
    expect(firstResult).toMatchObject({
      accepted: true,
      revision: 2,
      canvasVersion: 1,
      batchId: "stroke-1",
      mustContinue: true,
      nextAction: {
        tool: "draw_stroke",
        instruction: expect.stringContaining("expectedCanvasVersion 1"),
      },
      guidance: expect.stringMatching(/accepted.*broadcast/i),
    });
    expect(firstResult.guidance).not.toEqual(expect.stringContaining("expectedCanvasVersion"));
    expect(Object.keys(firstResult).sort()).toEqual([
      "accepted", "batchId", "canvasVersion", "guidance", "mustContinue", "nextAction", "remainingMs", "revision",
    ]);
    await act(async () => {
      acknowledgements[1](commandResult({ revision: 3, canvasVersion: 2, batchId: "stroke-2" }));
      await expect(second).resolves.toMatchObject({
        canvasVersion: 2,
        nextAction: { tool: "draw_stroke", instruction: expect.stringContaining("expectedCanvasVersion 2") },
      });
    });
    await act(async () => renderer.unmount());
  });
});
