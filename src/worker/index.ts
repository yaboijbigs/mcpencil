import { CreateRoomRequestSchema, JoinRoomRequestSchema, RoomCodeSchema } from "../shared/game";
import {
  ApiError,
  applySecurityHeaders,
  failureResponse,
  jsonResponse,
  readJsonBody,
  withSecurityHeaders,
  zodIssues,
} from "./errors";
import { GameRoom } from "./room";

export { GameRoom };

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_ATTEMPTS = 6;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.hostname.toLowerCase() === "www.mcpencil.com") {
        url.protocol = "https:";
        url.hostname = "mcpencil.com";
        const headers = applySecurityHeaders(new Headers({ Location: url.toString() }));
        return new Response(null, { status: 308, headers });
      }

      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
        enforceSameOrigin(request, url);
      }

      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const body = await readJsonBody(request, 8_000);
        const parsed = CreateRoomRequestSchema.safeParse(body);
        if (!parsed.success) {
          throw new ApiError(400, "INVALID_CREATE_REQUEST", "Room settings are invalid.", zodIssues(parsed.error.issues));
        }
        for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
          const roomCode = randomRoomCode();
          const room = env.ROOMS.getByName(roomCode);
          const response = await room.fetch(
            new Request("https://room/internal/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ roomCode, request: parsed.data }),
            }),
          );
          if (response.status !== 409) return withSecurityHeaders(response, true);
        }
        throw new ApiError(503, "ROOM_CODE_EXHAUSTED", "Could not reserve a room code. Please retry.");
      }

      const apiMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(join|leave|state|commands|prompt|replay)$/);
      if (apiMatch !== null) {
        const roomCode = parseRoomCode(apiMatch[1] ?? "");
        const action = apiMatch[2];
        const room = env.ROOMS.getByName(roomCode);

        if (action === "join" && request.method === "POST") {
          const body = await readJsonBody(request, 8_000);
          const parsed = JoinRoomRequestSchema.safeParse(body);
          if (!parsed.success) {
            throw new ApiError(400, "INVALID_JOIN_REQUEST", "Player settings are invalid.", zodIssues(parsed.error.issues));
          }
          const response = await room.fetch(
            new Request("https://room/internal/join", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ request: parsed.data }),
            }),
          );
          return withSecurityHeaders(response, true);
        }

        if (action === "commands" && request.method === "POST") {
          const body = await readJsonBody(request);
          const response = await room.fetch(
            new Request("https://room/internal/commands", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
          );
          return withSecurityHeaders(response, true);
        }

        if (action === "leave" && request.method === "POST") {
          const token = bearerOrQueryToken(request, url);
          const response = await room.fetch(
            new Request("https://room/internal/leave", {
              method: "POST",
              headers: { "X-Seat-Token": token },
            }),
          );
          return withSecurityHeaders(response, true);
        }

        if ((action === "state" || action === "prompt" || action === "replay") && request.method === "GET") {
          const token = bearerOrQueryToken(request, url);
          const response = await room.fetch(
            new Request(`https://room/internal/${action}`, {
              headers: { "X-Seat-Token": token },
            }),
          );
          return withSecurityHeaders(response, true);
        }

        throw new ApiError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this room endpoint.");
      }

      const socketMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
      if (socketMatch !== null) {
        if (request.method !== "GET") {
          throw new ApiError(405, "METHOD_NOT_ALLOWED", "WebSocket endpoint only accepts GET.");
        }
        const roomCode = parseRoomCode(socketMatch[1] ?? "");
        const token = bearerOrQueryToken(request, url);
        const headers = new Headers(request.headers);
        headers.set("X-Seat-Token", token);
        headers.delete("Authorization");
        headers.delete("Cookie");
        const room = env.ROOMS.getByName(roomCode);
        return room.fetch(new Request("https://room/internal/ws", { method: "GET", headers }));
      }

      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
        return jsonResponse({ error: "Endpoint not found.", code: "NOT_FOUND" }, { status: 404 });
      }

      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      return failureResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

function parseRoomCode(value: string): string {
  const parsed = RoomCodeSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "INVALID_ROOM_CODE", "Room code is invalid.");
  return parsed.data;
}

function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let code = "";
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  return code;
}

function bearerOrQueryToken(request: Request, url: URL): string {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return url.searchParams.get("token") ?? "";
}

function enforceSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get("Origin");
  if (origin === null) return;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new ApiError(403, "ORIGIN_REJECTED", "Request origin is not allowed.");
  }
  if (parsedOrigin.origin !== url.origin) {
    throw new ApiError(403, "ORIGIN_REJECTED", "Request origin is not allowed.");
  }
}
