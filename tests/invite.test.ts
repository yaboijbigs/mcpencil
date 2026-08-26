import { describe, expect, it } from "vitest";
import {
  buildRoomInvites,
  isAgentInviteParam,
  isAgentInviteUrl,
  roomCodeFromUrl,
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
    expect(url.origin).toBe("https://mcpencil.com");
    expect(url.pathname).toBe("/webmcp/rooms/5F3P8");
    expect([...url.searchParams.entries()]).toEqual([["invite", "agent"]]);
    expect(url.hash).toBe("#webmcp");
    expect(agent.text).toMatch(/^Play MCPencil with me using WebMCP\./);
    expect(agent.text).toContain("WebMCP-capable in-app or agent browser");
    expect(agent.text).toContain("In Codex, use the in-app browser surface that exposes page tools");
    expect(agent.text).toContain("not a separate external-browser or computer-control fallback");
    expect(agent.text).toContain("If that exact room is already loaded");
    expect(agent.text).toContain("Use browser navigation/viewing only");
    expect(agent.text).toContain("every game action through the page-exposed WebMCP tools");
    expect(agent.text).toContain("play_mcpencil({})");
    expect(agent.text).toContain("Follow each returned nextAction exactly");
    expect(agent.text).toContain("phase is match-end");
    expect(agent.text).toContain("report that WebMCP is unavailable");
    expect(agent.text).toContain("do not substitute DOM or browser automation");
    expect(agent.text).not.toContain("invite=agentOpen");
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
