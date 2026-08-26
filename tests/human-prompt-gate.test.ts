import { describe, expect, it } from "vitest";
import type { RoomMode, RoomSnapshot } from "../src/shared/game";
import { currentHumanPromptKey, humanPromptGate } from "../src/client/humanPromptGate";

function artistSnapshot(mode: RoomMode): RoomSnapshot {
  return {
    roomCode: "INK42",
    mode,
    phase: "round-prep",
    revision: 1,
    roundIndex: 2,
    totalRounds: mode === "practice" ? 4 : 6,
    roundDurationMs: 90_000,
    activeTeam: "cobalt",
    artistSeatId: "human-seat",
    endsAt: null,
    canvasVersion: 0,
    scores: { cobalt: 0, coral: 0 },
    seats: [{
      id: "human-seat",
      name: "Human Artist",
      team: "cobalt",
      controller: "human",
      isHost: true,
      isReady: true,
      isConnected: true,
      score: 0,
    }],
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

describe("human prompt visibility gate", () => {
  it.each(["practice", "arena", "free-for-all"] as const)(
    "requires the prompt to be hidden before a human artist starts in %s",
    (mode) => {
      const key = currentHumanPromptKey(artistSnapshot(mode), "human-seat", "human");
      expect(key).toBe("INK42:2");
      expect(humanPromptGate(key, null)).toBe("required");
      expect(humanPromptGate(key, key)).toBe("hidden");
    },
  );

  it("does not expose a human prompt gate to an agent, guesser, or completed round", () => {
    const snapshot = artistSnapshot("arena");
    expect(currentHumanPromptKey(snapshot, "human-seat", "agent")).toBeNull();
    expect(currentHumanPromptKey(snapshot, "other-seat", "human")).toBeNull();
    expect(currentHumanPromptKey({ ...snapshot, phase: "round-end" }, "human-seat", "human")).toBeNull();
  });
});
