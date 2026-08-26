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
  const personUrl = new URL(personPathname, origin);
  personUrl.search = "";
  personUrl.hash = "";
  personUrl.searchParams.set("room", normalizedRoomCode);

  const agentUrl = new URL(`/webmcp/rooms/${normalizedRoomCode}`, origin);
  agentUrl.searchParams.set("invite", "agent");
  agentUrl.hash = "webmcp";

  const agentUrlText = agentUrl.toString();
  const agentText = [
    "Play MCPencil with me using WebMCP.",
    "Use a WebMCP-capable in-app or agent browser. In Codex, use the in-app browser surface that exposes page tools, not a separate external-browser or computer-control fallback.",
    "Exact MCPencil room URL (the angle brackets delimit the URL):",
    `<${agentUrlText}>`,
    "If that exact room is already loaded in your WebMCP browser, do not reopen it. Otherwise navigate there once.",
    "Use browser navigation/viewing only. Perform every game action through the page-exposed WebMCP tools; do not substitute DOM clicks or browser automation.",
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
