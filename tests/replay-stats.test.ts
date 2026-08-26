import { describe, expect, it } from "vitest";
import type { CanvasEvent, GuessEvent } from "../src/shared/game";
import { summarizeReplayRound } from "../src/client/replayStats";

const line = {
  type: "line" as const,
  x1: 10,
  y1: 10,
  x2: 40,
  y2: 40,
  color: "ink" as const,
  width: 5 as const,
};

function canvasEvent(
  id: string,
  batchId: string,
  origin: CanvasEvent["origin"],
  roundIndex = 1,
): CanvasEvent {
  return {
    id,
    batchId,
    canvasVersion: Number(id.replace(/\D/g, "")) || 1,
    roundIndex,
    seatId: `${origin}-seat`,
    origin,
    createdAt: 1_000,
    primitive: line,
  };
}

function guessEvent(id: string, origin: GuessEvent["origin"], roundIndex = 1): GuessEvent {
  return {
    id,
    roundIndex,
    seatId: `${origin}-seat`,
    displayName: origin === "webmcp" ? "Agent" : "Human",
    guess: "turtle",
    origin,
    isCorrect: false,
    createdAt: 2_000,
  };
}

describe("replay round provenance", () => {
  it("separates drawing batches, vector marks, guesses, and human UI actions", () => {
    const events = [
      canvasEvent("a1", "agent-batch-1", "webmcp"),
      canvasEvent("a2", "agent-batch-1", "webmcp"),
      canvasEvent("a3", "agent-batch-2", "webmcp"),
      canvasEvent("h1", "human-batch-1", "human-ui"),
      { ...canvasEvent("h2", "human-undone", "human-ui"), reverted: true },
      canvasEvent("other", "other-round", "webmcp", 0),
    ];
    const guesses = [
      guessEvent("g1", "webmcp"),
      guessEvent("g2", "webmcp"),
      guessEvent("g3", "human-ui"),
      guessEvent("other-guess", "human-ui", 0),
    ];

    expect(summarizeReplayRound(events, guesses, 1)).toEqual({
      vectorMarks: 4,
      agentDrawingMoves: 2,
      agentDrawingMarks: 3,
      agentGuesses: 2,
      humanDrawingMoves: 1,
      humanDrawingMarks: 1,
      humanGuesses: 1,
      humanUiActions: 2,
      allGuesses: 3,
    });
  });

  it("returns zeroed counters when the selected round has no events", () => {
    expect(summarizeReplayRound([], [], 4)).toEqual({
      vectorMarks: 0,
      agentDrawingMoves: 0,
      agentDrawingMarks: 0,
      agentGuesses: 0,
      humanDrawingMoves: 0,
      humanDrawingMarks: 0,
      humanGuesses: 0,
      humanUiActions: 0,
      allGuesses: 0,
    });
  });
});
