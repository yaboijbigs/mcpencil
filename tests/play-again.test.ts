import { describe, expect, it, vi } from "vitest";
import { playAnotherMatch } from "../src/client/playAgain";

describe("play another match", () => {
  it("leaves the completed room before returning to the landing URL", () => {
    const order: string[] = [];
    const leave = vi.fn(() => order.push("leave"));
    const navigate = vi.fn((url: string) => order.push(`navigate:${url}`));

    playAnotherMatch(leave, navigate);

    expect(order).toEqual(["leave", "navigate:/"]);
    expect(leave).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
