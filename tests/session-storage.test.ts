import { describe, expect, it } from "vitest";
import { loadStoredCredentials } from "../src/client/hooks/useRoomSession";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    value(key: string) { return values.get(key) ?? null; },
  };
}

describe("isolated seat session migration", () => {
  it("migrates only the primary seat and discards a legacy same-page companion", () => {
    const primary = { roomCode: "AB2DE", seatId: "human", token: "h".repeat(32) };
    const companion = { roomCode: "AB2DE", seatId: "agent", token: "a".repeat(32) };
    const storage = memoryStorage({
      "mcpencil.seat.v3": JSON.stringify({ primary, companion }),
    });

    expect(loadStoredCredentials(storage, "https://mcpencil.com/?room=AB2DE")).toEqual({ primary });
    expect(storage.value("mcpencil.seat.v3")).toBeNull();
    expect(JSON.parse(storage.value("mcpencil.seat.v4")!)).toEqual({ primary });
    expect(storage.value("mcpencil.seat.v4")).not.toContain("companion");
  });

  it("drops a stored seat when the invite points at a different room", () => {
    const storage = memoryStorage({
      "mcpencil.seat.v4": JSON.stringify({
        primary: { roomCode: "AB2DE", seatId: "human", token: "h".repeat(32) },
      }),
    });

    expect(loadStoredCredentials(storage, "https://mcpencil.com/?room=FG3JK")).toBeNull();
    expect(storage.value("mcpencil.seat.v4")).toBeNull();
  });
});
