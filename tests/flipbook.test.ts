import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../src/shared/game";
import { describeFlipbookView } from "../src/client/flipbook";

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomCode: "INK42",
    mode: "practice",
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
    seats: [],
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

describe("flipbook scene descriptors", () => {
  it("uses coarse page keys so the first stroke does not cause a redundant turn", () => {
    const prep = describeFlipbookView(snapshot({ phase: "round-prep" }), "none", false);
    const drawing = describeFlipbookView(snapshot({ phase: "drawing", revision: 9 }), "none", false);

    expect(prep.key).toBe("INK42:round:0");
    expect(drawing.key).toBe(prep.key);
  });

  it("turns from a private prompt to the live round without copying prompt content", () => {
    const prompt = describeFlipbookView(snapshot({ phase: "round-prep" }), "required", false);
    const play = describeFlipbookView(snapshot({ phase: "round-prep" }), "hidden", false);

    expect(prompt).toMatchObject({ key: "INK42:private-prompt:0", label: "Private prompt · round 1" });
    expect(play.key).toBe("INK42:round:0");
    expect(play.label).not.toMatch(/secret|prompt/i);
  });

  it("gives landing, lobby, results, and match end distinct leaves", () => {
    expect(describeFlipbookView(null, "none", false).key).toBe("landing");
    expect(describeFlipbookView(snapshot(), "none", false).key).toBe("INK42:lobby");
    expect(describeFlipbookView(snapshot({ phase: "round-end" }), "none", false).key).toBe("INK42:round-result:0");
    expect(describeFlipbookView(snapshot({ phase: "match-end" }), "none", false).key).toBe("INK42:match-end");
  });
});
