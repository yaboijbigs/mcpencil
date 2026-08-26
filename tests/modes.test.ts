import { describe, expect, it } from "vitest";
import type { ControllerType, RoomSnapshot, TeamId } from "../src/shared/game";
import {
  GAME_MODES,
  getExhibitionMatchup,
  MODE_CATALOG,
} from "../src/client/modes";

function exhibitionSnapshot(
  seats: Array<{ id: string; team: TeamId; controller: ControllerType }>,
): RoomSnapshot {
  return {
    roomCode: "INK42",
    mode: "exhibition",
    phase: "lobby",
    revision: 1,
    roundIndex: 0,
    totalRounds: 4,
    roundDurationMs: 60_000,
    activeTeam: "cobalt",
    artistSeatId: null,
    endsAt: null,
    canvasVersion: 0,
    scores: { cobalt: 0, coral: 0 },
    seats: seats.map((seat, index) => ({
      ...seat,
      name: `Player ${index + 1}`,
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
    expect(GAME_MODES.map((mode) => mode.id)).toEqual(["practice", "arena", "exhibition"]);
    expect(MODE_CATALOG.practice).toMatchObject({ recommended: true, rounds: [2, 4, 6] });
    expect(MODE_CATALOG.arena.rounds).toEqual([4, 6, 8]);
    expect(MODE_CATALOG.exhibition.rounds).toEqual([4, 6, 8]);
  });

  it("describes exhibition controller makeup from connected team seats", () => {
    const humanVsAgent = exhibitionSnapshot([
      { id: "h1", team: "cobalt", controller: "human" },
      { id: "a1", team: "coral", controller: "agent" },
    ]);
    const agentVsAgent = exhibitionSnapshot([
      { id: "a1", team: "cobalt", controller: "agent" },
      { id: "a2", team: "coral", controller: "agent" },
    ]);

    expect(getExhibitionMatchup(humanVsAgent).label).toBe("Human vs Agent");
    expect(getExhibitionMatchup(agentVsAgent).label).toBe("Agent vs Agent");
  });
});
