import { describe, expect, it } from "vitest";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CommandEnvelopeSchema,
  DEFAULT_PROMPT_DIFFICULTY,
  DrawBatchCommandSchema,
  MAX_BATCH_PRIMITIVES,
  PrimitiveSchema,
  PROMPT_DIFFICULTIES,
  ROUND_DURATION_MS,
  ROUND_DURATION_OPTIONS_MS,
  RoomCodeSchema,
  RoomCommandSchema,
  canGuess,
  isArtist,
  type RoomSnapshot,
  type VectorPrimitive,
} from "../src/shared/game";
import { arcPath, pointsAttribute, remainingSeconds } from "../src/shared/format";
import {
  WEBMCP_REGISTERED_TOOL_NAMES,
  compactWebMcpRoundResult,
  compactWebMcpState,
  webMcpToolNames,
} from "../src/client/webMcpAvailability";

const line: VectorPrimitive = {
  type: "line",
  x1: 10,
  y1: 20,
  x2: 300,
  y2: 400,
  color: "ink",
  width: 7,
};

function drawingCommand(primitives: VectorPrimitive[]) {
  return {
    type: "draw_batch" as const,
    expectedVersion: 0,
    idempotencyKey: "test-batch-0001",
    origin: "webmcp" as const,
    primitives,
  };
}

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomCode: "ABCDE",
    mode: "arena",
    phase: "drawing",
    revision: 3,
    roundIndex: 0,
    totalRounds: 6,
    roundDurationMs: 90_000,
    promptDifficulty: "easy",
    activeTeam: "cobalt",
    artistSeatId: "artist",
    endsAt: 100_000,
    canvasVersion: 0,
    scores: { cobalt: 0, coral: 0 },
    seats: [
      {
        id: "artist",
        name: "Artist",
        team: "cobalt",
        controller: "agent",
        isHost: true,
        isReady: true,
        isConnected: true,
        score: 0,
      },
      {
        id: "guesser",
        name: "Guesser",
        team: "cobalt",
        controller: "human",
        isHost: false,
        isReady: true,
        isConnected: true,
        score: 0,
      },
      {
        id: "opponent",
        name: "Opponent",
        team: "coral",
        controller: "human",
        isHost: false,
        isReady: true,
        isConnected: true,
        score: 0,
      },
    ],
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

describe("vector command contract", () => {
  it("accepts each deliberately supported primitive", () => {
    const primitives: VectorPrimitive[] = [
      line,
      {
        type: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 80 },
        ],
        color: "cobalt",
        width: 3,
      },
      {
        type: "ellipse",
        cx: 200,
        cy: 180,
        rx: 90,
        ry: 40,
        color: "coral",
        width: 12,
        fill: "paper",
      },
      {
        type: "rectangle",
        x: 500,
        y: 300,
        rectWidth: 180,
        rectHeight: 120,
        radius: 18,
        color: "leaf",
        width: 7,
      },
      {
        type: "arc",
        cx: 700,
        cy: 300,
        radius: 75,
        startAngle: -90,
        endAngle: 170,
        color: "sun",
        width: 20,
      },
      {
        type: "polygon",
        points: [
          { x: 800, y: 80 },
          { x: 900, y: 120 },
          { x: 860, y: 220 },
        ],
        color: "ink",
        width: 3,
        fill: "cobalt",
      },
    ];

    expect(DrawBatchCommandSchema.parse(drawingCommand(primitives)).primitives).toHaveLength(6);
  });

  it("enforces the 12-primitive batch ceiling", () => {
    expect(
      DrawBatchCommandSchema.safeParse(
        drawingCommand(Array.from({ length: MAX_BATCH_PRIMITIVES }, () => ({ ...line }))),
      ).success,
    ).toBe(true);

    expect(
      DrawBatchCommandSchema.safeParse(
        drawingCommand(Array.from({ length: MAX_BATCH_PRIMITIVES + 1 }, () => ({ ...line }))),
      ).success,
    ).toBe(false);
  });

  it("rejects arbitrary SVG, URL, text, and event attributes", () => {
    const hostileValues: unknown[] = [
      { type: "path", d: "M0 0 L1 1", color: "ink", width: 3 },
      { ...line, href: "https://example.com/pixel" },
      { ...line, text: "THE ANSWER" },
      { ...line, onload: "alert(1)" },
    ];

    for (const hostile of hostileValues) {
      expect(PrimitiveSchema.safeParse(hostile).success).toBe(false);
    }
  });

  it("accepts the common five-pixel agent stroke width", () => {
    expect(PrimitiveSchema.safeParse({ ...line, width: 5 }).success).toBe(true);
  });

  it("rejects out-of-range, non-finite, and excessive point geometry", () => {
    expect(PrimitiveSchema.safeParse({ ...line, x1: -1 }).success).toBe(false);
    expect(PrimitiveSchema.safeParse({ ...line, x2: CANVAS_WIDTH + 1 }).success).toBe(false);
    expect(PrimitiveSchema.safeParse({ ...line, y1: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(
      PrimitiveSchema.safeParse({
        type: "polyline",
        points: Array.from({ length: 49 }, (_, index) => ({ x: index, y: index })),
        color: "ink",
        width: 3,
      }).success,
    ).toBe(false);
  });

  it("keeps protocol constants stable for renderers and tools", () => {
    expect(CANVAS_WIDTH).toBe(1000);
    expect(CANVAS_HEIGHT).toBe(700);
    expect(MAX_BATCH_PRIMITIVES).toBe(12);
  });

  it("requires a valid token and a strict command envelope", () => {
    const valid = {
      token: "a".repeat(32),
      command: drawingCommand([line]),
    };
    expect(CommandEnvelopeSchema.safeParse(valid).success).toBe(true);
    expect(CommandEnvelopeSchema.safeParse({ ...valid, token: "short" }).success).toBe(false);
    expect(CommandEnvelopeSchema.safeParse({ ...valid, prompt: "leak" }).success).toBe(false);
  });

  it("normalizes and constrains room codes", () => {
    expect(RoomCodeSchema.parse("ab2de")).toBe("AB2DE");
    expect(RoomCodeSchema.safeParse("AB10E").success).toBe(false);
    expect(RoomCodeSchema.safeParse("ABCD").success).toBe(false);
  });
});

describe("match duration settings", () => {
  it("offers 90, 120, and 150 seconds while keeping the 90-second default", () => {
    expect(ROUND_DURATION_OPTIONS_MS).toEqual([90_000, 120_000, 150_000]);
    expect(ROUND_DURATION_MS).toBe(90_000);
  });

  it.each([90_000, 120_000, 150_000])("accepts a %i ms configuration", (roundDurationMs) => {
    expect(RoomCommandSchema.safeParse({
      type: "configure_match",
      totalRounds: 4,
      roundDurationMs,
      origin: "webmcp",
    }).success).toBe(true);
  });

  it.each([45_000, 60_000, 30_000, 119_999, 120_000.5])(
    "rejects an unsupported %i ms configuration",
    (roundDurationMs) => {
      expect(RoomCommandSchema.safeParse({
        type: "configure_match",
        totalRounds: 4,
        roundDurationMs,
        origin: "webmcp",
      }).success).toBe(false);
    },
  );
});

describe("prompt difficulty settings", () => {
  const baseConfiguration = {
    type: "configure_match",
    totalRounds: 4,
    roundDurationMs: 90_000,
    origin: "webmcp",
  };

  it("offers easy and hard with an easy default", () => {
    expect(PROMPT_DIFFICULTIES).toEqual(["easy", "hard"]);
    expect(DEFAULT_PROMPT_DIFFICULTY).toBe("easy");
  });

  it.each(["easy", "hard"])("accepts explicit %s prompts", (promptDifficulty) => {
    expect(RoomCommandSchema.parse({ ...baseConfiguration, promptDifficulty }))
      .toMatchObject({ promptDifficulty });
  });

  it("preserves omitted difficulty for existing clients", () => {
    expect(RoomCommandSchema.parse(baseConfiguration)).not.toHaveProperty("promptDifficulty");
  });

  it.each(["medium", "HARD", "", null, 1])("rejects invalid difficulty %s", (promptDifficulty) => {
    expect(RoomCommandSchema.safeParse({ ...baseConfiguration, promptDifficulty }).success).toBe(false);
  });
});

describe("role-safe shared helpers", () => {
  it("recognizes only the current artist during drawing", () => {
    expect(isArtist(snapshot(), "artist")).toBe(true);
    expect(isArtist(snapshot({ phase: "round-prep" }), "artist")).toBe(true);
    expect(isArtist(snapshot(), "guesser")).toBe(false);
    expect(isArtist(snapshot({ phase: "round-end" }), "artist")).toBe(false);
  });

  it("allows only active-team non-artists to guess in Team Match", () => {
    expect(canGuess(snapshot(), "guesser")).toBe(true);
    expect(canGuess(snapshot(), "artist")).toBe(false);
    expect(canGuess(snapshot(), "opponent")).toBe(false);
    expect(canGuess(snapshot({ phase: "lobby" }), "guesser")).toBe(false);
  });

  it("allows every Free-for-All non-artist to guess regardless of legacy team assignment", () => {
    const freeForAll = snapshot({ mode: "free-for-all", totalRounds: 3 });
    expect(canGuess(freeForAll, "guesser")).toBe(true);
    expect(canGuess(freeForAll, "opponent")).toBe(true);
    expect(canGuess(freeForAll, "artist")).toBe(false);
    expect(canGuess({ ...freeForAll, phase: "round-end" }, "opponent")).toBe(false);
  });
});

describe("dynamic WebMCP availability", () => {
  it.each([2, 4, 6])("keeps document descriptors stable throughout a %i-round Sketch Duet", (totalRounds) => {
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
    const activeFingerprints = [JSON.stringify(webMcpToolNames(null, null, true, "ABCDE"))];
    const registeredFingerprints = [JSON.stringify(WEBMCP_REGISTERED_TOOL_NAMES)];
    let previousResult: RoomSnapshot["roundResult"] = null;

    for (let roundIndex = 0; roundIndex < totalRounds; roundIndex += 1) {
      const artistSeatId = roundIndex % 2 === 0 ? agent.id : human.id;
      const drawing = snapshot({
        mode: "practice",
        phase: "drawing",
        roundIndex,
        totalRounds,
        artistSeatId,
        seats: [human, agent],
        roundResult: previousResult,
      });
      activeFingerprints.push(JSON.stringify(webMcpToolNames(drawing, agent.id)));
      registeredFingerprints.push(JSON.stringify(WEBMCP_REGISTERED_TOOL_NAMES));

      previousResult = {
        roundIndex,
        prompt: roundIndex % 2 === 0 ? "camera" : "drums",
        artistSeatId,
        team: "cobalt",
        pointsAwarded: 100,
        elapsedMs: 30_000,
        strokeCount: 5,
        toolCallCount: 5,
      };
      const roundEnd = {
        ...drawing,
        phase: "round-end" as const,
        roundResult: previousResult,
        seats: [human, { ...agent, isReady: false }],
      };
      activeFingerprints.push(JSON.stringify(webMcpToolNames(roundEnd, agent.id)));
      registeredFingerprints.push(JSON.stringify(WEBMCP_REGISTERED_TOOL_NAMES));

      const ready = {
        ...roundEnd,
        seats: [human, agent],
      };
      activeFingerprints.push(JSON.stringify(webMcpToolNames(ready, agent.id)));
      registeredFingerprints.push(JSON.stringify(WEBMCP_REGISTERED_TOOL_NAMES));
    }

    const activeChanges = activeFingerprints.slice(1).filter(
      (fingerprint, index) => fingerprint !== activeFingerprints[index],
    ).length;
    const registeredChanges = registeredFingerprints.slice(1).filter(
      (fingerprint, index) => fingerprint !== registeredFingerprints[index],
    ).length;

    expect(activeChanges).toBe(totalRounds * 3);
    expect(registeredChanges).toBe(0);
  });

  it("registers only landing tools before a seat exists", () => {
    expect(webMcpToolNames(null, null)).toEqual([
      "get_match_state",
      "start_practice",
      "play_mcpencil",
    ]);
  });

  it("turns a room invite into an unambiguous zero-input play action", () => {
    expect(webMcpToolNames(null, null, true, "AB2DE")).toEqual([
      "get_match_state",
      "play_mcpencil",
    ]);
    expect(compactWebMcpState(null, null, "AB2DE")).toMatchObject({
      intent: "play_mcpencil_with_user",
      roomCode: "AB2DE",
      phase: "landing",
      mustContinue: true,
      completionCondition: expect.stringContaining("match-end"),
      availableActions: ["play_mcpencil"],
      interactionProtocol: expect.stringContaining("page-exposed WebMCP tools"),
      nextAction: {
        tool: "play_mcpencil",
        arguments: {},
        instruction: expect.stringContaining("play_mcpencil WebMCP tool now with {}"),
      },
      urgency: "immediate",
    });
  });

  it("tracks agent controller, host, phase, and drawing role", () => {
    expect(webMcpToolNames(snapshot({ phase: "lobby" }), "artist")).toEqual([
      "get_match_state",
      "configure_match",
      "start_match",
    ]);
    expect(webMcpToolNames(snapshot(), "artist")).toEqual([
      "get_match_state",
      "draw_stroke",
      "undo_last_stroke",
    ]);
    expect(webMcpToolNames(snapshot(), "guesser")).toEqual(["get_match_state"]);
  });

  it("lets an agent explicitly join a waiting human-hosted practice room", () => {
    const practiceLobby = snapshot({
      mode: "practice",
      phase: "lobby",
      totalRounds: 2,
      artistSeatId: null,
      seats: [{
        id: "human-host",
        name: "Human Host",
        team: "cobalt",
        controller: "human",
        isHost: true,
        isReady: true,
        isConnected: true,
        score: 0,
      }],
    });
    expect(webMcpToolNames(practiceLobby, null)).toEqual(["get_match_state", "play_mcpencil"]);
  });

  it("lets an agent host configure balanced lobby settings", () => {
    const agentPracticeHost = snapshot({
      mode: "practice",
      phase: "lobby",
      totalRounds: 4,
      roundDurationMs: 120_000,
      promptDifficulty: "hard",
      artistSeatId: null,
      seats: [{
        id: "artist",
        name: "Agent Host",
        team: "cobalt",
        controller: "agent",
        isHost: true,
        isReady: true,
        isConnected: true,
        score: 0,
      }],
    });
    expect(webMcpToolNames(agentPracticeHost, "artist")).toEqual([
      "get_match_state",
      "configure_match",
    ]);
    expect(compactWebMcpState(agentPracticeHost, "artist")).toMatchObject({
      competitive: false,
      matchSettings: { totalRounds: 4, roundDurationMs: 120_000, promptDifficulty: "hard" },
      promptStyle: "An action phrase. Draw or guess the action, not just an object.",
    });
  });

  it("lets an agent join a human-hosted Team Match without replacing the host seat", () => {
    const arenaLobby = snapshot({
      phase: "lobby",
      artistSeatId: null,
      seats: [{
        id: "human-host",
        name: "Human Host",
        team: "cobalt",
        controller: "human",
        isHost: true,
        isReady: true,
        isConnected: true,
        score: 0,
      }],
    });
    expect(webMcpToolNames(arenaLobby, null)).toEqual(["get_match_state", "play_mcpencil"]);
    expect(compactWebMcpState(arenaLobby, null)).toMatchObject({
      mustContinue: true,
      nextAction: {
        tool: "play_mcpencil",
        arguments: {},
        instruction: expect.stringContaining("play_mcpencil WebMCP tool now with {}"),
      },
      urgency: "immediate",
    });
  });

  it("withholds submit_guesses until the human prompt is hidden", () => {
    const agentGuesser = snapshot({
      seats: snapshot().seats.map((seat) =>
        seat.id === "guesser" ? { ...seat, controller: "agent" as const, isReady: false } : seat,
      ),
    });
    expect(webMcpToolNames(agentGuesser, "guesser", false)).toEqual(["get_match_state"]);
    expect(webMcpToolNames(agentGuesser, "guesser", true)).toEqual([
      "get_match_state",
      "submit_guesses",
    ]);
    const roundResult = {
      roundIndex: 0,
      prompt: "sleepy volcano",
      artistSeatId: "artist",
      team: "cobalt" as const,
      pointsAwarded: 0,
      elapsedMs: 90_000,
      strokeCount: 4,
      toolCallCount: 4,
    };
    expect(webMcpToolNames({ ...agentGuesser, phase: "round-end", roundResult }, "guesser")).toEqual([
      "get_match_state",
      "get_round_result",
      "ready_next",
    ]);
    expect(webMcpToolNames({
      ...agentGuesser,
      phase: "round-end",
      roundResult,
      seats: agentGuesser.seats.map((seat) => seat.id === "guesser" ? { ...seat, isReady: true } : seat),
    }, "guesser")).toEqual(["get_match_state", "get_round_result"]);
  });

  it("exposes individual Free-for-All state and guessing to every agent non-artist", () => {
    const leaderboard = [
      {
        seatId: "guesser",
        name: "Guesser",
        controller: "human" as const,
        score: 180,
        placement: 1,
        successfulDrawings: 0,
        correctGuesses: 1,
        fastestSolveMs: 31_000,
        averageSolveMs: 31_000,
      },
      {
        seatId: "opponent",
        name: "Opponent",
        controller: "agent" as const,
        score: 180,
        placement: 1,
        successfulDrawings: 1,
        correctGuesses: 0,
        fastestSolveMs: null,
        averageSolveMs: null,
      },
      {
        seatId: "artist",
        name: "Artist",
        controller: "agent" as const,
        score: 90,
        placement: 3,
        successfulDrawings: 0,
        correctGuesses: 0,
        fastestSolveMs: null,
        averageSolveMs: null,
      },
    ];
    const freeForAll = snapshot({
      mode: "free-for-all",
      totalRounds: 3,
      seats: snapshot().seats.map((seat) => ({
        ...seat,
        controller: seat.id === "opponent" ? "agent" as const : seat.controller,
        score: leaderboard.find((standing) => standing.seatId === seat.id)?.score ?? 0,
      })),
      leaderboard,
    });

    expect(webMcpToolNames(freeForAll, "opponent")).toEqual([
      "get_match_state",
      "submit_guesses",
    ]);
    const state = compactWebMcpState(freeForAll, "opponent");
    expect(state).toMatchObject({
      mode: "free-for-all",
      competitive: true,
      scoring: "individual",
      yourRole: "guesser",
      yourScore: 180,
      leaderboard,
      nextAction: { tool: "submit_guesses" },
    });
    expect(state).not.toHaveProperty("yourTeam");
    expect(state).not.toHaveProperty("activeTeam");
    expect(state).not.toHaveProperty("scores");
    expect(state.seats.every((seat) => !("team" in seat))).toBe(true);

    const complete = compactWebMcpState({ ...freeForAll, phase: "match-end" }, "opponent");
    expect(complete).toMatchObject({
      mustContinue: false,
      scoring: "individual",
      outcome: {
        kind: "individual_result",
        competitive: true,
        winners: [
          { seatId: "guesser", name: "Guesser", score: 180 },
          { seatId: "opponent", name: "Opponent", score: 180 },
        ],
        leaderboard,
        instruction: expect.stringContaining("tied winners"),
      },
      nextAction: {
        tool: null,
        instruction: expect.stringContaining("individual winner or tied winners"),
      },
    });
    expect(JSON.stringify(complete)).not.toContain("team_result");
    expect(complete).not.toHaveProperty("yourTeam");
    expect(complete).not.toHaveProperty("activeTeam");
    expect(complete).not.toHaveProperty("scores");
  });

  it("reports Free-for-All artist and guesser awards without team framing", () => {
    const freeForAllResult = compactWebMcpRoundResult(snapshot({
      mode: "free-for-all",
      totalRounds: 3,
      phase: "round-end",
      roundResult: {
        roundIndex: 0,
        prompt: "volcano",
        artistSeatId: "artist",
        team: "cobalt",
        guessedBySeatId: "opponent",
        pointsAwarded: 140,
        artistPointsAwarded: 140,
        guesserPointsAwarded: 140,
        elapsedMs: 50_000,
        strokeCount: 7,
        toolCallCount: 7,
      },
      guesses: [{
        id: "free-for-all-guess",
        roundIndex: 0,
        seatId: "opponent",
        displayName: "Opponent",
        guess: "volcano",
        origin: "webmcp",
        isCorrect: true,
        createdAt: 1,
      }],
    }));

    expect(freeForAllResult).toMatchObject({
      round: 1,
      prompt: "volcano",
      outcome: "solved",
      artist: "Artist",
      guessedBy: "Opponent",
      pointsPerPlayer: 140,
      artistPointsAwarded: 140,
      guesserPointsAwarded: 140,
      competitive: true,
      scoring: "individual",
      instruction: expect.stringContaining("independently"),
      guessTranscript: [{
        player: "Opponent",
        guess: "volcano",
        provenance: "webmcp",
        correct: true,
      }],
    });
    expect(freeForAllResult).not.toHaveProperty("team");
    expect(freeForAllResult).not.toHaveProperty("scores");
    expect(JSON.stringify(freeForAllResult)).not.toContain("team_result");
  });

  it("supports the hosted Sketch Duet WebMCP lifecycle end to end", () => {
    const humanHost = {
      id: "human-host",
      name: "Human Host",
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
    const waiting = snapshot({
      mode: "practice",
      phase: "lobby",
      totalRounds: 2,
      artistSeatId: null,
      seats: [humanHost],
    });
    expect(webMcpToolNames(waiting, null)).toEqual(["get_match_state", "play_mcpencil"]);

    const agentPrep = snapshot({
      mode: "practice",
      phase: "round-prep",
      totalRounds: 2,
      artistSeatId: agent.id,
      seats: [humanHost, agent],
    });
    expect(webMcpToolNames(agentPrep, agent.id)).toEqual([
      "get_match_state",
      "draw_stroke",
      "undo_last_stroke",
    ]);
    expect(compactWebMcpState(agentPrep, agent.id)).toMatchObject({
      intent: "play_mcpencil_with_user",
      mustContinue: true,
      completionCondition: expect.stringContaining("match-end"),
      yourRole: "artist",
      nextAction: { tool: "draw_stroke" },
      urgency: "immediate",
      deadline: agentPrep.endsAt,
    });

    const firstResult = {
      roundIndex: 0,
      prompt: "tiny dragon",
      artistSeatId: agent.id,
      team: "cobalt" as const,
      guessedBySeatId: humanHost.id,
      pointsAwarded: 142,
      elapsedMs: 48_000,
      strokeCount: 6,
      toolCallCount: 6,
    };
    const humanPrep = snapshot({
      mode: "practice",
      phase: "round-prep",
      roundIndex: 1,
      totalRounds: 2,
      artistSeatId: humanHost.id,
      seats: [humanHost, agent],
      roundResult: firstResult,
    });
    expect(webMcpToolNames(humanPrep, agent.id, true)).toEqual([
      "get_match_state",
      "get_round_result",
    ]);

    const humanDrawing = { ...humanPrep, phase: "drawing" as const };
    expect(webMcpToolNames(humanDrawing, agent.id, false)).toEqual([
      "get_match_state",
      "get_round_result",
    ]);
    expect(webMcpToolNames(humanDrawing, agent.id, true)).toEqual([
      "get_match_state",
      "submit_guesses",
      "get_round_result",
    ]);
    expect(webMcpToolNames({ ...humanDrawing, phase: "match-end" }, agent.id, true)).toEqual([
      "get_match_state",
      "get_round_result",
    ]);
    const practiceEnd = {
      ...humanDrawing,
      phase: "match-end" as const,
      scores: { cobalt: 283, coral: 0 },
      guesses: [{
        id: "practice-guess-1",
        roundIndex: 0,
        seatId: humanHost.id,
        displayName: humanHost.name,
        guess: "tiny dragon",
        origin: "human-ui" as const,
        isCorrect: true,
        createdAt: 1,
      }, {
        id: "practice-guess-2",
        roundIndex: 1,
        seatId: agent.id,
        displayName: agent.name,
        guess: "unrelated later guess",
        origin: "webmcp" as const,
        isCorrect: false,
        createdAt: 2,
      }],
      analytics: { ...humanDrawing.analytics, correctGuesses: 2 },
    };
    const practiceEndState = compactWebMcpState(practiceEnd, agent.id);
    expect(practiceEndState).toMatchObject({
      phase: "match-end",
      mustContinue: false,
      competitive: false,
      outcome: {
        kind: "practice_complete",
        competitive: false,
        winner: null,
        roundsPlayed: 2,
        solvedRounds: 2,
        instruction: expect.stringContaining("do not declare a team winner"),
      },
      nextAction: {
        tool: null,
        arguments: {},
        instruction: expect.stringContaining("do not name a winning team"),
      },
      urgency: "complete",
    });
    expect(practiceEndState).not.toHaveProperty("scores");
    expect(practiceEndState).not.toHaveProperty("yourTeam");
    expect(practiceEndState).not.toHaveProperty("activeTeam");
    expect(practiceEndState.practiceProgress).not.toHaveProperty("collaborativePoints");
    expect(practiceEndState.seats[0]).not.toHaveProperty("team");
    expect(compactWebMcpRoundResult(practiceEnd)).toMatchObject({
      prompt: firstResult.prompt,
      outcome: "solved",
      competitive: false,
      guessTranscript: [{
        player: humanHost.name,
        guess: "tiny dragon",
        provenance: "human-ui",
        correct: true,
      }],
      instruction: expect.stringContaining("collaborative"),
    });
    expect(compactWebMcpRoundResult(practiceEnd)).not.toHaveProperty("team");
    expect(compactWebMcpRoundResult(practiceEnd)).not.toHaveProperty("pointsAwarded");
  });

  it("keeps the previous round result readable while the next artist draws", () => {
    const previousResult = {
      roundIndex: 0,
      prompt: "flying library",
      artistSeatId: "opponent",
      team: "coral" as const,
      pointsAwarded: 120,
      elapsedMs: 70_000,
      strokeCount: 9,
      toolCallCount: 9,
    };
    expect(webMcpToolNames(snapshot({
      phase: "round-prep",
      roundIndex: 1,
      roundResult: previousResult,
    }), "artist")).toEqual([
      "get_match_state",
      "draw_stroke",
      "undo_last_stroke",
      "get_round_result",
    ]);
  });

  it.each(["round-prep", "drawing"] as const)("guides agent artists to draw an outline immediately during %s", (phase) => {
    const state = compactWebMcpState(snapshot({ phase }), "artist");

    expect(state.mustContinue).toBe(true);
    expect(state.nextAction.tool).toBe("draw_stroke");
    expect(state.nextAction.instruction).toContain("ONE high-information simple silhouette/outline stroke now");
    expect(state.nextAction.instruction).toContain("X 0-1000 and Y 0-700");
    expect(state.nextAction.instruction).toContain("every ellipse/rectangle/arc extent fully visible");
    expect(state.nextAction.instruction).toContain("recognizable outline in the first few strokes; add details later");
    expect(state.nextAction.instruction).toContain("After each successful acknowledgement, follow the returned nextAction immediately");
    expect(state.nextAction.instruction).toContain("no screenshots, get_match_state, narration, or full-drawing planning between drawing strokes");
  });

  it.each([
    { promptDifficulty: "easy", promptStyle: "A single-word noun." },
    { promptDifficulty: "hard", promptStyle: "An action phrase. Draw or guess the action, not just an object." },
  ] as const)("guides artists and guessers for $promptDifficulty prompts without exposing answers", ({ promptDifficulty, promptStyle }) => {
    const current = snapshot({
      promptDifficulty,
      seats: snapshot().seats.map((seat) => seat.id === "guesser"
        ? { ...seat, controller: "agent" as const }
        : seat),
    });
    for (const [seatId, tool] of [["artist", "draw_stroke"], ["guesser", "submit_guesses"]] as const) {
      const state = compactWebMcpState(current, seatId);
      expect(state).toMatchObject({
        matchSettings: { promptDifficulty },
        promptStyle,
        nextAction: { tool },
      });
      expect(state).not.toHaveProperty("privatePrompt");
      expect(state).not.toHaveProperty("prompt");
      expect(state).not.toHaveProperty("aliases");
    }
  });

  it("gives only active agent guessers bounded current-round geometry and recent guesses", () => {
    const agentSnapshot = snapshot({
      seats: snapshot().seats.map((seat) => seat.id === "guesser"
        ? { ...seat, controller: "agent" as const, isReady: false }
        : seat),
      canvasVersion: 70,
      canvas: Array.from({ length: 70 }, (_, index) => ({
        id: `event-${index}`,
        batchId: `batch-${index}`,
        canvasVersion: index + 1,
        roundIndex: 0,
        seatId: "artist",
        origin: "webmcp" as const,
        createdAt: index,
        primitive: index === 69
          ? {
              type: "polyline" as const,
              points: Array.from({ length: 25 }, (__, point) => ({ x: point + 0.4, y: point + 0.6 })),
              color: "ink" as const,
              width: 7 as const,
            }
          : { ...line, x1: index, x2: index },
      })),
      guesses: Array.from({ length: 10 }, (_, index) => ({
        id: `guess-${index}`,
        roundIndex: 0,
        seatId: "guesser",
        displayName: "Agent",
        guess: `answer ${index}`,
        origin: "webmcp" as const,
        isCorrect: false,
        createdAt: index,
      })),
    });
    const state = compactWebMcpState(agentSnapshot, "guesser") as {
      canvasPerception: { format: string; width: number; height: number; rows: string[] };
      canvasGeometryInfo: { includedStrokes: number; totalStrokes: number; strategy: string };
      canvasGeometry: VectorPrimitive[];
      recentGuesses: Array<{ text: string; correct: boolean }>;
      guidance: string;
      nextAction: { tool: string; instruction: string };
      urgency: string;
    };
    expect(state.canvasPerception).toMatchObject({ format: "ascii-raster-v1", width: 32, height: 22 });
    expect(state.canvasPerception.rows).toHaveLength(22);
    expect(state.canvasGeometryInfo).toEqual({
      includedStrokes: 24,
      totalStrokes: 70,
      strategy: "first-8-and-latest-16",
    });
    expect(state.canvasGeometry).toHaveLength(24);
    expect(state.canvasGeometry[0]).toMatchObject({ type: "line", x1: 0 });
    expect(state.canvasGeometry[8]).toMatchObject({ type: "line", x1: 54 });
    expect(state.canvasGeometry.at(-1)).toMatchObject({ type: "polyline", points: expect.any(Array) });
    expect((state.canvasGeometry.at(-1) as Extract<VectorPrimitive, { type: "polyline" }>).points).toHaveLength(6);
    expect(state.recentGuesses.map(({ text }) => text)).toEqual(Array.from({ length: 8 }, (_, index) => `answer ${index + 2}`));
    expect(state.guidance).toContain("rendered page/canvas visual as the primary picture");
    expect(state.guidance).toContain("immediately submit 1-3 ordered, distinct, visually supported candidates while the human keeps drawing");
    expect(state.guidance).toContain("New strokes or a newer canvasVersion do not invalidate the observed snapshot");
    expect(state.guidance).toContain("finish the current guess attempt without rechecking or waiting for the canvas to stop changing");
    expect(state.guidance).toContain("Incorporate new strokes in the next observation cycle");
    expect(state.guidance).toContain("do not take a screenshot after every stroke");
    expect(state.guidance).toContain("After a short retry timeout");
    expect(state.guidance).toContain("visually supported refinements");
    expect(state.guidance).toContain("if none are plausible, briefly wait again");
    expect(state.guidance).toContain("Discard the old picture when the round or artist changes");
    expect(state.guidance).toContain("stop guessing when the phase or role no longer permits it");
    expect(state.guidance).toContain("Never repeat recentGuesses");
    expect(state.guidance).toContain("canvasPerception is a fast 32x22");
    expect(state.guidance).toContain("canvasGeometry only as a final cross-check");
    expect(state.guidance).toContain("immediately");
    expect(state.nextAction.tool).toBe("submit_guesses");
    expect(state.nextAction.instruction).toContain("Use the observed snapshot and guidance");
    expect(state.nextAction.instruction).toContain("1-3 ordered, distinct candidates immediately");
    expect(state.nextAction.instruction).toContain("Do not restart the current guess attempt when canvasVersion advances");
    expect(state.nextAction.instruction).toContain("incorporate new strokes in the next observation cycle");
    expect(state.nextAction.instruction).toContain("if no plausible candidate is supported, briefly wait again");
    expect(state.nextAction.instruction).toContain("Never repeat recentGuesses");
    expect(state.urgency).toBe("immediate");
    expect(compactWebMcpState(agentSnapshot, "artist")).not.toHaveProperty("canvasGeometry");
    expect(compactWebMcpState(agentSnapshot, "artist")).not.toHaveProperty("canvasPerception");
  });

  it("keeps a worst-case agent guesser state compact", () => {
    const densePolyline: VectorPrimitive = {
      type: "polyline",
      points: Array.from({ length: 48 }, (_, index) => ({
        x: Math.round(index * CANVAS_WIDTH / 47),
        y: Math.round((index % 2) * CANVAS_HEIGHT),
      })),
      color: "ink",
      width: 20,
    };
    const denseSnapshot = snapshot({
      canvasVersion: 100,
      seats: snapshot().seats.map((seat) => seat.id === "guesser" ? { ...seat, controller: "agent" as const } : seat),
      canvas: Array.from({ length: 100 }, (_, index) => ({
        id: `dense-${index}`,
        batchId: `dense-batch-${index}`,
        canvasVersion: index + 1,
        roundIndex: 0,
        seatId: "artist",
        origin: "human-ui" as const,
        createdAt: index,
        primitive: densePolyline,
      })),
    });

    const state = compactWebMcpState(denseSnapshot, "guesser");
    expect(JSON.stringify(state).length).toBeLessThan(8_000);
  });
});

describe("deterministic SVG formatting", () => {
  it("creates a bounded arc path from numeric input", () => {
    const path = arcPath({
      type: "arc",
      cx: 100,
      cy: 100,
      radius: 50,
      startAngle: 0,
      endAngle: 180,
      color: "ink",
      width: 3,
    });
    expect(path).toMatch(/^M 100 50 A 50 50 0 0 1 /);
    expect(path).not.toContain("NaN");
  });

  it("formats polyline points without markup", () => {
    expect(pointsAttribute([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe("1,2 3,4");
  });

  it("rounds remaining display time up and clamps expired rounds", () => {
    expect(remainingSeconds(10_001, 10_000)).toBe(1);
    expect(remainingSeconds(11_001, 10_000)).toBe(2);
    expect(remainingSeconds(9_999, 10_000)).toBe(0);
    expect(remainingSeconds(null, 10_000)).toBeNull();
  });
});
