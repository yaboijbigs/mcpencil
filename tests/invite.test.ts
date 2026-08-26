import { describe, expect, it } from "vitest";
import {
  agentOriginFor,
  buildAgentRoomUrl,
  buildRoomInvites,
  isAgentInviteParam,
  isAgentInviteUrl,
  roomCodeFromUrl,
  separateAgentViewInstruction,
} from "../src/client/invite";

describe("room invitations", () => {
  it("builds an exact person invite URL", () => {
    const invites = buildRoomInvites(
      " 5f3p8 ",
      "https://mcpencil.com",
      "/play/index.html",
    );
    const url = new URL(invites.person.text);

    expect(invites.person.url).toBe(invites.person.text);
    expect(url.origin).toBe("https://mcpencil.com");
    expect(url.pathname).toBe("/play/index.html");
    expect([...url.searchParams.entries()]).toEqual([["room", "5F3P8"]]);
    expect(url.hash).toBe("");
  });

  it("escapes the agent-only route when building its human fallback", () => {
    const invites = buildRoomInvites(
      "5F3P8",
      "https://mcpencil.com",
      "/webmcp/rooms/5F3P8",
    );
    expect(invites.person.url).toBe("https://mcpencil.com/?room=5F3P8");
    expect(isAgentInviteUrl(new URL(invites.person.url))).toBe(false);
  });

  it("delimits the exact agent URL and supplies the complete WebMCP play contract", () => {
    const { agent } = buildRoomInvites(
      "5F3P8",
      "https://mcpencil.com",
      "/",
    );
    const delimitedUrl = agent.text.match(/<([^>\n]+)>/)?.[1];

    expect(delimitedUrl).toBe(agent.url);
    const url = new URL(delimitedUrl!);
    expect(url.origin).toBe("https://agent.mcpencil.com");
    expect(url.pathname).toBe("/webmcp/rooms/5F3P8");
    expect([...url.searchParams.entries()]).toEqual([["invite", "agent"]]);
    expect(url.hash).toBe("#webmcp");
    expect(agent.text).toMatch(/^Play MCPencil with me using WebMCP\./);
    expect(agent.text).toContain("WebMCP-capable in-app or agent browser");
    expect(agent.text).toContain("In Codex, use the in-app browser surface that exposes page tools");
    expect(agent.text).toContain("not a separate external-browser or computer-control fallback");
    expect(agent.text).toContain("separate agent tab or view");
    expect(agent.text).toContain("Do not load it in, or hand control of, the human player's MCPencil tab");
    expect(agent.text).toContain("If that exact room is already loaded");
    expect(agent.text).toContain("Browser/page visual viewing and screenshot perception are allowed and expected");
    expect(agent.text).toContain("first meaningful drawing");
    expect(agent.text).toContain("only when newer strokes materially change the scene");
    expect(agent.text).toContain("do not take a screenshot after every stroke");
    expect(agent.text).toContain("Navigation and visual perception are not game actions");
    expect(agent.text).toContain("join, ready, configure, start, draw, undo, or guess");
    expect(agent.text).toContain("every game action through the page-exposed WebMCP tools");
    expect(agent.text).toContain("play_mcpencil({})");
    expect(agent.text).toContain("Follow each returned nextAction exactly");
    expect(agent.text).toContain("phase is match-end");
    expect(agent.text).toContain("report that WebMCP is unavailable");
    expect(agent.text).toContain("do not substitute DOM or browser automation");
    expect(agent.text).not.toContain("invite=agentOpen");
  });

  it("maps every production MCPencil host to the isolated agent origin", () => {
    expect(agentOriginFor("https://mcpencil.com")).toBe("https://agent.mcpencil.com");
    expect(agentOriginFor("https://www.mcpencil.com")).toBe("https://agent.mcpencil.com");
    expect(agentOriginFor("https://agent.mcpencil.com")).toBe("https://agent.mcpencil.com");
    expect(buildAgentRoomUrl(" 5f3p8 ", "https://mcpencil.com")).toBe(
      "https://agent.mcpencil.com/webmcp/rooms/5F3P8?invite=agent#webmcp",
    );
  });

  it("keeps workers.dev and local development invitations on their current origin", () => {
    expect(agentOriginFor("https://mcpencil.example.workers.dev")).toBe(
      "https://mcpencil.example.workers.dev",
    );
    expect(agentOriginFor("http://localhost:8787")).toBe("http://localhost:8787");
    expect(buildAgentRoomUrl("5F3P8", "http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/webmcp/rooms/5F3P8?invite=agent#webmcp",
    );
  });

  it("sends a human fallback from the agent origin back to the human site", () => {
    const invites = buildRoomInvites(
      "5F3P8",
      "https://agent.mcpencil.com",
      "/webmcp/rooms/5F3P8",
    );
    expect(invites.person.url).toBe("https://mcpencil.com/?room=5F3P8");
  });

  it("builds a concise separate-view handoff with the exact isolated URL", () => {
    const instruction = separateAgentViewInstruction("5F3P8", "https://mcpencil.com");
    expect(instruction).toContain("already seated as the human player");
    expect(instruction).toContain("separate agent tab or view");
    expect(instruction).toContain(
      "<https://agent.mcpencil.com/webmcp/rooms/5F3P8?invite=agent#webmcp>",
    );
    expect(instruction).toContain("call play_mcpencil({}) there");
    expect(instruction).toContain("Do not use this human host tab");
  });

  it("recognizes both the self-describing agent route and legacy query links", () => {
    const canonical = new URL("https://mcpencil.com/webmcp/rooms/5F3P8?invite=agent#webmcp");
    const routeOnly = new URL("https://mcpencil.com/webmcp/rooms/5F3P8");
    const legacy = new URL("https://mcpencil.com/?room=5F3P8&invite=agentOpen");
    const person = new URL("https://mcpencil.com/?room=5F3P8");

    expect(roomCodeFromUrl(canonical)).toBe("5F3P8");
    expect(roomCodeFromUrl(routeOnly)).toBe("5F3P8");
    expect(roomCodeFromUrl(legacy)).toBe("5F3P8");
    expect(isAgentInviteUrl(canonical)).toBe(true);
    expect(isAgentInviteUrl(routeOnly)).toBe(true);
    expect(isAgentInviteUrl(legacy)).toBe(true);
    expect(isAgentInviteUrl(person)).toBe(false);
  });

  it("treats the canonical route as authoritative over a conflicting legacy query", () => {
    const conflicting = new URL(
      "https://mcpencil.com/webmcp/rooms/5F3P8?room=ABCDE&invite=agent",
    );
    expect(roomCodeFromUrl(conflicting)).toBe("5F3P8");
  });
});

describe("isAgentInviteParam", () => {
  it.each(["agent", "AGENT", "agentOpen", "agentOpenTheRoom"])(
    "recognizes %s as an agent invitation",
    (value) => expect(isAgentInviteParam(value)).toBe(true),
  );

  it.each([undefined, null, "", "person", "agentic", "openAgent"])(
    "does not recognize %s as an agent invitation",
    (value) => expect(isAgentInviteParam(value)).toBe(false),
  );
});
