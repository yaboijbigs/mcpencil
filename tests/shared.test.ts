import { describe, expect, it } from "vitest";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CommandEnvelopeSchema,
  DrawBatchCommandSchema,
  MAX_BATCH_PRIMITIVES,
  PrimitiveSchema,
  RoomCodeSchema,
  canGuess,
  isArtist,
  type RoomSnapshot,
  type VectorPrimitive,
} from "../src/shared/game";
import { arcPath, pointsAttribute, remainingSeconds } from "../src/shared/format";
import { compactWebMcpState, webMcpToolNames } from "../src/client/webMcpAvailability";

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
      },
      {
        id: "guesser",
        name: "Guesser",
        team: "cobalt",
        controller: "human",
        isHost: false,
        isReady: true,
        isConnected: true,
      },
      {
        id: "opponent",
        name: "Opponent",
        team: "coral",
        controller: "human",
        isHost: false,
        isReady: true,
        isConnected: true,
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

describe("role-safe shared helpers", () => {
  it("recognizes only the current artist during drawing", () => {
    expect(isArtist(snapshot(), "artist")).toBe(true);
    expect(isArtist(snapshot(), "guesser")).toBe(false);
    expect(isArtist(snapshot({ phase: "round-end" }), "artist")).toBe(false);
  });

  it("allows only active-team non-artists to guess", () => {
    expect(canGuess(snapshot(), "guesser")).toBe(true);
    expect(canGuess(snapshot(), "artist")).toBe(false);
    expect(canGuess(snapshot(), "opponent")).toBe(false);
    expect(canGuess(snapshot({ phase: "lobby" }), "guesser")).toBe(false);
  });
});

describe("dynamic WebMCP availability", () => {
  it("registers only landing tools before a seat exists", () => {
    expect(webMcpToolNames(null, null)).toEqual([
      "get_match_state",
      "start_practice",
      "join_match",
    ]);
  });

  it("tracks agent controller, host, phase, and drawing role", () => {
    expect(webMcpToolNames(snapshot({ phase: "lobby" }), "artist")).toEqual([
      "get_match_state",
      "start_match",
    ]);
    expect(webMcpToolNames(snapshot(), "artist")).toEqual([
      "get_match_state",
      "get_draw_prompt",
      "draw_batch",
      "undo_draw_batch",
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
      }],
    });
    expect(webMcpToolNames(practiceLobby, null)).toEqual(["get_match_state", "join_match"]);
  });

  it("withholds submit_guess until the human prompt is hidden", () => {
    const agentGuesser = snapshot({
      seats: snapshot().seats.map((seat) =>
        seat.id === "guesser" ? { ...seat, controller: "agent" as const, isReady: false } : seat,
      ),
    });
    expect(webMcpToolNames(agentGuesser, "guesser", false)).toEqual(["get_match_state"]);
    expect(webMcpToolNames(agentGuesser, "guesser", true)).toEqual([
      "get_match_state",
      "submit_guess",
    ]);
    expect(webMcpToolNames({ ...agentGuesser, phase: "round-end" }, "guesser")).toEqual([
      "get_match_state",
      "get_round_result",
      "ready_next",
    ]);
    expect(webMcpToolNames({
      ...agentGuesser,
      phase: "round-end",
      seats: agentGuesser.seats.map((seat) => seat.id === "guesser" ? { ...seat, isReady: true } : seat),
    }, "guesser")).toEqual(["get_match_state", "get_round_result"]);
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
      canvasGeometry: VectorPrimitive[];
      recentGuesses: Array<{ text: string; correct: boolean }>;
      guidance: string;
    };
    expect(state.canvasGeometry).toHaveLength(60);
    expect(state.canvasGeometry[0]).toMatchObject({ type: "line", x1: 0 });
    expect(state.canvasGeometry[20]).toMatchObject({ type: "line", x1: 30 });
    expect(state.canvasGeometry.at(-1)).toMatchObject({ type: "polyline", points: expect.any(Array) });
    expect((state.canvasGeometry.at(-1) as Extract<VectorPrimitive, { type: "polyline" }>).points).toHaveLength(10);
    expect(state.recentGuesses.map(({ text }) => text)).toEqual(Array.from({ length: 8 }, (_, index) => `answer ${index + 2}`));
    expect(state.guidance).toContain("immediately");
    expect(compactWebMcpState(agentSnapshot, "artist")).not.toHaveProperty("canvasGeometry");
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
