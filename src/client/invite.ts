export type InviteAudience = "person" | "agent";

export interface RoomInvite {
  text: string;
  url: string;
}

export interface RoomInvites {
  agent: RoomInvite;
  person: RoomInvite;
}

const ROOM_CODE_PATTERN = /^[A-Z2-9]{5}$/;
const AGENT_ROUTE_PATTERN = /^\/webmcp\/rooms\/([A-Z2-9]{5})\/?$/i;
const PRODUCTION_HUMAN_ORIGIN = "https://mcpencil.com";
const PRODUCTION_AGENT_ORIGIN = "https://agent.mcpencil.com";
const PRODUCTION_HOSTNAMES = new Set([
  "mcpencil.com",
  "www.mcpencil.com",
  "agent.mcpencil.com",
]);

function isProductionOrigin(url: URL): boolean {
  return url.protocol === "https:"
    && url.port === ""
    && PRODUCTION_HOSTNAMES.has(url.hostname.toLowerCase());
}

/**
 * Production invitations use a dedicated origin so an agent never inherits the
 * human host's sessionStorage or document. Local, preview, and workers.dev URLs
 * deliberately stay on their current origin for development and legacy use.
 */
export function agentOriginFor(origin: string): string {
  const url = new URL(origin);
  return isProductionOrigin(url) ? PRODUCTION_AGENT_ORIGIN : url.origin;
}

function humanOriginFor(origin: string): string {
  const url = new URL(origin);
  return isProductionOrigin(url) ? PRODUCTION_HUMAN_ORIGIN : url.origin;
}

export function buildAgentRoomUrl(roomCode: string, origin: string): string {
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  const agentUrl = new URL(`/webmcp/rooms/${normalizedRoomCode}`, agentOriginFor(origin));
  agentUrl.searchParams.set("invite", "agent");
  agentUrl.hash = "webmcp";
  return agentUrl.toString();
}

export function separateAgentViewInstruction(roomCode: string, origin: string): string {
  const agentUrl = buildAgentRoomUrl(roomCode, origin);
  return `This document is already seated as the human player. Open the exact agent invite in a separate agent tab or view: <${agentUrl}>. Then call play_mcpencil({}) there. Do not use this human host tab for the agent.`;
}

/**
 * Build copy-ready invitations without relying on browser globals.
 */
export function buildRoomInvites(
  roomCode: string,
  origin: string,
  pathname: string,
): RoomInvites {
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  const personPathname = AGENT_ROUTE_PATTERN.test(pathname) ? "/" : pathname;
  const personUrl = new URL(personPathname, humanOriginFor(origin));
  personUrl.search = "";
  personUrl.hash = "";
  personUrl.searchParams.set("room", normalizedRoomCode);

  const agentUrlText = buildAgentRoomUrl(normalizedRoomCode, origin);
  const agentText = [
    "Play MCPencil with me using WebMCP.",
    "Use a WebMCP-capable in-app or agent browser. In Codex, use the in-app browser surface that exposes page tools, not a separate external-browser or computer-control fallback.",
    "Open the agent URL in a separate agent tab or view. Do not load it in, or hand control of, the human player's MCPencil tab.",
    "Exact MCPencil room URL (the angle brackets delimit the URL):",
    `<${agentUrlText}>`,
    "If that exact room is already loaded in your WebMCP browser, do not reopen it. Otherwise navigate there once.",
    "Browser/page visual viewing and screenshot perception are allowed and expected when you are guessing: inspect the rendered canvas at the first meaningful drawing, then again only when newer strokes materially change the scene; do not take a screenshot after every stroke. Reuse the prior visual only if canvasVersion matches the last observed picture, not merely the latest acknowledgement. After a short retry timeout, use the picture or close feedback for visually supported refinements without waiting for more strokes; if none are plausible, briefly wait again. Never repeat recent guesses.",
    "When drawing, send ONE simple, high-information silhouette/outline stroke immediately; establish a recognizable outline in the first few strokes and add details later. Keep all geometry inside X 0-1000, Y 0-700. Follow each successful acknowledgement with the returned nextAction: no screenshots, get_match_state, narration, or full-drawing planning between drawing strokes.",
    "Navigation and visual perception are not game actions. Perform every game action through the page-exposed WebMCP tools only (join, ready, configure, start, draw, undo, or guess); do not substitute DOM clicks or browser automation.",
    "After opening the exact URL, call play_mcpencil({}).",
    "Follow each returned nextAction exactly until phase is match-end.",
    "If WebMCP is unavailable, report that WebMCP is unavailable; do not substitute DOM or browser automation.",
  ].join("\n\n");

  return {
    person: {
      text: personUrl.toString(),
      url: personUrl.toString(),
    },
    agent: {
      text: agentText,
      url: agentUrlText,
    },
  };
}

/**
 * Recognize canonical agent invites and the old invite value produced when
 * adjacent prose (beginning with "Open") was accidentally glued to it.
 */
export function isAgentInviteParam(value: string | null | undefined): boolean {
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "agent" || normalized.startsWith("agentopen");
}

export function roomCodeFromUrl(url: URL): string | null {
  const routeRoom = url.pathname.match(AGENT_ROUTE_PATTERN)?.[1]?.toUpperCase() ?? "";
  if (ROOM_CODE_PATTERN.test(routeRoom)) return routeRoom;
  const queryRoom = url.searchParams.get("room")?.trim().toUpperCase() ?? "";
  return ROOM_CODE_PATTERN.test(queryRoom) ? queryRoom : null;
}

export function isAgentInviteUrl(url: URL): boolean {
  return AGENT_ROUTE_PATTERN.test(url.pathname)
    || isAgentInviteParam(url.searchParams.get("invite"));
}
