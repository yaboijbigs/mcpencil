import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { FlipbookShell } from "../src/client/components/FlipbookShell";
import type { FlipbookView } from "../src/client/flipbook";

const landing: FlipbookView = {
  key: "landing",
  label: "Front page · choose a game",
  folio: "01",
  tone: "landing",
};

function shell(view: FlipbookView, content: string) {
  return createElement(
    FlipbookShell,
    { view },
    createElement("main", { id: "live-page" }, content),
  );
}

describe("FlipbookShell", () => {
  it("adds only a decorative leaf when the live scene changes", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(shell(landing, "Choose a mode"));
    });

    expect(renderer.root.findAllByProps({ className: "flipbook-turn-leaf" })).toHaveLength(0);

    act(() => {
      renderer.update(shell(
        { key: "INK42:lobby", label: "Sketch Duet · set up the table", folio: "02", tone: "practice" },
        "Invite your agent",
      ));
    });

    expect(renderer.root.findAllByProps({ className: "flipbook-turn-leaf" })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ id: "live-page" })).toHaveLength(1);
  });

  it("never copies outgoing private-prompt content into the turning leaf", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(shell(
        { key: "INK42:private-prompt:0", label: "Private prompt · round 1", folio: "03", tone: "practice" },
        "Secret sleepy octopus",
      ));
    });

    act(() => {
      renderer.update(shell(
        { key: "INK42:round:0", label: "Sketch Duet · round 1", folio: "04", tone: "practice" },
        "Live canvas",
      ));
    });

    const markup = JSON.stringify(renderer.toJSON());
    expect(markup).toContain("Live canvas");
    expect(markup).not.toContain("Secret sleepy octopus");
  });
});
