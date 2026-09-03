import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../src/shared/game";
import {
  GAME_MODES,
  getFreeForAllStandings,
  getMissingSketchDuetController,
  MODE_CATALOG,
} from "../src/client/modes";

function freeForAllSnapshot(
  seats: Array<{ id: string; name: string; score: number }>,
): RoomSnapshot {
  return {
    roomCode: "INK42",
    mode: "free-for-all",
    phase: "lobby",
    revision: 1,
    roundIndex: 0,
    totalRounds: 4,
    roundDurationMs: 60_000,
    promptDifficulty: "easy",
    activeTeam: "cobalt",
    artistSeatId: null,
    endsAt: null,
    canvasVersion: 0,
    scores: { cobalt: 0, coral: 0 },
    seats: seats.map((seat, index) => ({
      ...seat,
      team: index % 2 === 0 ? "cobalt" : "coral",
      controller: index % 2 === 0 ? "human" : "agent",
      isHost: index === 0,
      isReady: true,
      isConnected: true,
    })),
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
  };
}

describe("frontend game mode catalog", () => {
  it("keeps all server modes visible with their supported round counts", () => {
    expect(GAME_MODES.map((mode) => mode.id)).toEqual(["practice", "arena", "free-for-all"]);
    expect(MODE_CATALOG.practice).toMatchObject({ recommended: true, rounds: [2, 4, 6] });
    expect(MODE_CATALOG.arena.rounds).toEqual([4, 6, 8]);
    expect(MODE_CATALOG["free-for-all"]).toMatchObject({
      name: "Free-for-All",
      roundsLabel: "1 per player",
      rounds: [3, 4, 5, 6, 7, 8],
    });
  });

  it("ranks individual scores stably and gives tied players the same place", () => {
    const snapshot = freeForAllSnapshot([
      { id: "first-tie", name: "Ink", score: 220 },
      { id: "third", name: "Pixel", score: 80 },
      { id: "second-tie", name: "Vector", score: 220 },
    ]);

    expect(getFreeForAllStandings(snapshot).map((standing) => ({
      id: standing.seatId,
      score: standing.score,
      place: standing.placement,
    }))).toEqual([
      { id: "first-tie", score: 220, place: 1 },
      { id: "second-tie", score: 220, place: 1 },
      { id: "third", score: 80, place: 3 },
    ]);
  });

  it("offers only the missing Sketch Duet controller type", () => {
    expect(getMissingSketchDuetController([
      { controller: "human", isConnected: true },
    ])).toBe("agent");
    expect(getMissingSketchDuetController([
      { controller: "agent", isConnected: true },
    ])).toBe("human");
    expect(getMissingSketchDuetController([
      { controller: "human", isConnected: false },
    ])).toBe("agent");
    expect(getMissingSketchDuetController([
      { controller: "human", isConnected: true },
      { controller: "agent", isConnected: true },
    ])).toBeNull();
  });
});
