// @vitest-environment node

import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebMcpLens } from "../src/client/components/WebMcpLens";

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("WebMCP Proof panel", () => {
  it("presents an unsupported human browser as neutral compatibility information", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(createElement(WebMcpLens, {
        supported: false,
        tools: [],
        invocations: [],
        activity: [],
      }));
    });
    const serialized = JSON.stringify(renderer!.toJSON());
    const text = renderedText(renderer!);
    expect(text).toContain("Human interface · WebMCP optional");
    expect(text).toContain("This browser is using MCPencil’s human interface");
    expect(serialized).not.toContain('"role":"alert"');
    await act(async () => renderer!.unmount());
  });

  it("separates registered descriptors from current authorization and renders safe call evidence", async () => {
    const now = Date.now();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(createElement(WebMcpLens, {
        supported: true,
        actionableTools: ["get_match_state"],
        registeredTools: [{
          name: "get_match_state",
          title: "Inspect MCPencil match",
          description: "Read current state.",
          annotations: { readOnlyHint: true, untrustedContentHint: true },
        }, {
          name: "draw_stroke",
          title: "Draw one stroke now",
          description: "Draw exactly one primitive.",
        }],
        context: {
          phase: "drawing",
          role: "guesser",
          controller: "agent",
          seatName: "Ink",
          roomCode: "AB2DE",
          round: 2,
          totalRounds: 4,
        },
        authorizationEvents: [{
          id: "auth-1",
          tool: "draw_stroke",
          change: "revoked",
          createdAt: now - 1,
          phase: "drawing",
          role: "guesser",
        }],
        invocations: [{
          id: "call-1",
          tool: "get_match_state",
          status: "ok",
          inputSummary: "after revision 12 · wait up to 25000ms",
          outputSummary: "State and private prompt delivered · prompt masked",
          startedAt: now,
          durationMs: 42,
          canvasVersion: 7,
          batchId: "12345678-1234-1234-1234-123456789012",
          provenance: "webmcp",
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          result: {
            revision: 13,
            canvasVersion: 7,
            batchId: "12345678-1234-1234-1234-123456789012",
            role: "guesser",
            promptMasked: true,
          },
        }],
        activity: [{
          id: "activity-1",
          kind: "system",
          label: "Prompt issued",
          detail: "Private prompt: sleepy turtle",
          canvasVersion: 7,
          createdAt: now - 2,
        }],
      }));
    });

    let serialized = JSON.stringify(renderer!.toJSON());
    let text = renderedText(renderer!);
    expect(text).toContain("2 registered · 1 authorized now");
    expect(text).toContain("Registered on this page");
    expect(text).toContain("Authorized for this role and phase");
    expect(text).toContain("readOnlyHint: true");
    expect(text).toContain("untrustedContentHint: true");
    expect(text).toContain("Withheld now");
    expect(serialized).not.toContain("tool-kind");

    const evidenceTab = renderer!.root.findAllByType("button").find((button) => button.children.includes("Evidence log"));
    if (!evidenceTab) throw new Error("Missing evidence log tab.");
    await act(async () => evidenceTab.props.onClick());
    serialized = JSON.stringify(renderer!.toJSON());
    text = renderedText(renderer!);
    expect(text).toContain("Call");
    expect(text).toContain("after revision 12 · wait up to 25000ms");
    expect(text).toContain("Result");
    expect(text).toContain("42ms");
    expect(text).toContain("batch 12345678…");
    expect(text).toContain("private prompt masked");
    expect(text).toContain("Authorization revoked");
    expect(text).toContain("Private prompt event · content masked");
    expect(text).not.toContain("sleepy turtle");
    await act(async () => renderer!.unmount());
  });
});

function renderedText(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children.filter((child): child is string => typeof child === "string"))
    .join("");
}
