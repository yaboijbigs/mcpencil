// @vitest-environment node

import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyExperience, type LobbyExperienceProps } from "../src/client/components/LobbyExperience";
import type { RoomMode, RoomSnapshot } from "../src/shared/game";

let renderer: ReactTestRenderer;

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

function lobby(mode: RoomMode = "practice"): RoomSnapshot {
  return {
    roomCode: "ABCDE", mode, phase: "lobby", revision: 1, roundIndex: 0,
    totalRounds: mode === "practice" ? 4 : mode === "arena" ? 6 : 3,
    roundDurationMs: 90_000, promptDifficulty: "easy", activeTeam: "cobalt",
    artistSeatId: null, endsAt: null, canvasVersion: 0,
    scores: { cobalt: 0, coral: 0 },
    seats: [{
      id: "host", name: "Host", team: "cobalt", controller: "human",
      isHost: true, isReady: false, isConnected: true, score: 0,
    }],
    canvas: [], guesses: [], activity: [], roundResult: null,
    analytics: { totalStrokes: 0, totalToolCalls: 0, correctGuesses: 0, averageGuessMs: null,
      byOrigin: { "human-ui": 0, webmcp: 0 } },
  };
}

async function render(snapshot: RoomSnapshot, overrides: Partial<LobbyExperienceProps> = {}) {
  const onCommand = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    renderer = create(createElement(LobbyExperience, {
      snapshot, seatId: "host", busy: false, lens: null, onCommand,
      copiedInvite: null, onCopyInvite: vi.fn(), ...overrides,
    }));
  });
  return onCommand;
}

function button(label: string | number) {
  return renderer.root.findAllByType("button").find((node) =>
    [node.props.children].flat().join("") === String(label))!;
}

describe("lobby prompt difficulty", () => {
  it.each<RoomMode>(["practice", "arena", "free-for-all"])("lets the host choose Hard in %s", async (mode) => {
    const snapshot = lobby(mode);
    const onCommand = await render(snapshot);
    expect(button("Easy").props["aria-pressed"]).toBe(true);
    expect(button("Hard").props["aria-pressed"]).toBe(false);
    await act(async () => button("Hard").props.onClick());
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({
      type: "configure_match", totalRounds: snapshot.totalRounds,
      roundDurationMs: 90_000, promptDifficulty: "hard", origin: "human-ui",
    });
  });

  it.each<RoomMode>(["practice", "arena", "free-for-all"])("preserves Hard while changing other %s options", async (mode) => {
    const snapshot = { ...lobby(mode), promptDifficulty: "hard" as const };
    const onCommand = await render(snapshot);
    expect(button("Hard").props["aria-pressed"]).toBe(true);
    expect(renderer.root.findByProps({ className: "settings-summary" }).props["aria-label"]).toContain("Hard prompts");
    await act(async () => button("120s").props.onClick());
    expect(onCommand).toHaveBeenLastCalledWith({
      type: "configure_match", totalRounds: snapshot.totalRounds,
      roundDurationMs: 120_000, promptDifficulty: "hard", origin: "human-ui",
    });
    if (mode !== "free-for-all") {
      await act(async () => button(mode === "practice" ? 2 : 8).props.onClick());
      expect(onCommand).toHaveBeenLastCalledWith({
        type: "configure_match", totalRounds: mode === "practice" ? 2 : 8,
        roundDurationMs: 90_000, promptDifficulty: "hard", origin: "human-ui",
      });
    }
    await act(async () => button("Easy").props.onClick());
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ promptDifficulty: "easy" }));
  });

  it("defaults a legacy snapshot to Easy", async () => {
    const snapshot = lobby();
    Reflect.deleteProperty(snapshot, "promptDifficulty");
    const onCommand = await render(snapshot);
    expect(button("Easy").props["aria-pressed"]).toBe(true);
    await act(async () => button("150s").props.onClick());
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ promptDifficulty: "easy" }));
  });

  it.each(["guest", "agent", "busy", "started"])("locks difficulty for %s but keeps help accessible", async (condition) => {
    const snapshot = lobby("arena");
    if (condition === "guest") snapshot.seats[0]!.isHost = false;
    if (condition === "agent") snapshot.seats[0]!.controller = "agent";
    if (condition === "started") snapshot.phase = "drawing";
    await render(snapshot, { busy: condition === "busy" });
    expect(renderer.root.findAllByType("fieldset").every((node) => node.props.disabled)).toBe(true);
    const help = renderer.root.findByProps({ "aria-label": "About prompt difficulty" });
    expect(help.props.disabled).toBeUndefined();
    expect(help.parent!.type).not.toBe("fieldset");
    await act(async () => help.props.onFocus());
    expect(renderer.root.findByProps({ role: "tooltip" }).props.hidden).toBe(false);
  });

  it("explains both modes and supports hover, focus, Escape, and tap", async () => {
    await render(lobby());
    const help = renderer.root.findByProps({ "aria-label": "About prompt difficulty" });
    const wrapper = renderer.root.findByProps({ className: "difficulty-help" });
    const tooltip = () => renderer.root.findByProps({ role: "tooltip" });
    expect(help.props["aria-describedby"]).toBe(tooltip().props.id);
    expect(tooltip().props.hidden).toBe(true);
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain("a single word, like bear, dog, hat, or helicopter.");
    expect(text).toContain("an action, like flying a kite or driving a car.");
    await act(async () => wrapper.props.onMouseEnter());
    expect(tooltip().props.hidden).toBe(false);
    await act(async () => wrapper.props.onMouseLeave());
    expect(tooltip().props.hidden).toBe(true);
    await act(async () => help.props.onFocus());
    expect(tooltip().props.hidden).toBe(false);
    await act(async () => wrapper.props.onMouseLeave());
    expect(tooltip().props.hidden).toBe(false);
    await act(async () => help.props.onKeyDown({ key: "Escape" }));
    expect(tooltip().props.hidden).toBe(true);
    await act(async () => help.props.onClick());
    expect(tooltip().props.hidden).toBe(false);
    await act(async () => help.props.onBlur());
    expect(tooltip().props.hidden).toBe(true);
  });
});
