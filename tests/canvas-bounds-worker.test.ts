import { env } from "cloudflare:workers";
import { abortAllDurableObjects } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/worker/index";
import type { ApiFailure, JoinRoomResponse, RoomSnapshot, SeatCredentials } from "../src/shared/game";

const BASE_URL = "https://mcpencil.com";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return worker.fetch(new Request(`${BASE_URL}${path}`, { ...init, headers }), env);
}

async function responseBody<T>(response: Response): Promise<T> {
  return response.json<T>();
}

async function connect(credentials: SeatCredentials): Promise<WebSocket> {
  const response = await request(
    `/ws/${credentials.roomCode}?token=${encodeURIComponent(credentials.token)}`,
    { headers: { Upgrade: "websocket" } },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  return socket;
}

afterEach(async () => {
  await abortAllDurableObjects();
});

describe("authoritative canvas command validation", () => {
  it("rejects off-canvas geometry before persistence and accepts an exact-edge centerline", async () => {
    const createResponse = await request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name: "Bounds Human", mode: "practice", controller: "human" }),
    });
    expect(createResponse.status).toBe(201);
    const human = await responseBody<JoinRoomResponse>(createResponse);

    const joinResponse = await request(`/api/rooms/${human.roomCode}/join`, {
      method: "POST",
      body: JSON.stringify({ name: "Bounds Agent", team: "cobalt", controller: "agent" }),
    });
    expect(joinResponse.status).toBe(201);
    const agent = await responseBody<JoinRoomResponse>(joinResponse);
    await connect(human);
    await connect(agent);

    const rejected = await request(`/api/rooms/${agent.roomCode}/commands`, {
      method: "POST",
      body: JSON.stringify({
        token: agent.token,
        command: {
          type: "draw_batch",
          expectedVersion: 0,
          idempotencyKey: "off-canvas-ellipse",
          primitives: [{
            type: "ellipse",
            cx: 500,
            cy: 650,
            rx: 100,
            ry: 51,
            color: "ink",
            width: 7,
          }],
          origin: "webmcp",
        },
      }),
    });
    expect(rejected.status).toBe(400);
    expect(await responseBody<ApiFailure>(rejected)).toMatchObject({
      code: "INVALID_COMMAND",
      issues: [expect.objectContaining({ path: "command.primitives.0.ry" })],
    });

    const unchangedResponse = await request(`/api/rooms/${human.roomCode}/state`, {
      headers: { Authorization: `Bearer ${human.token}` },
    });
    expect(await responseBody<RoomSnapshot>(unchangedResponse)).toMatchObject({
      phase: "round-prep",
      canvasVersion: 0,
      canvas: [],
    });

    const accepted = await request(`/api/rooms/${agent.roomCode}/commands`, {
      method: "POST",
      body: JSON.stringify({
        token: agent.token,
        command: {
          type: "draw_batch",
          expectedVersion: 0,
          idempotencyKey: "exact-canvas-edge",
          primitives: [{
            type: "line",
            x1: 0,
            y1: 700,
            x2: 1000,
            y2: 700,
            color: "ink",
            width: 7,
          }],
          origin: "webmcp",
        },
      }),
    });
    expect(accepted.status).toBe(200);

    const persistedResponse = await request(`/api/rooms/${human.roomCode}/state`, {
      headers: { Authorization: `Bearer ${human.token}` },
    });
    expect(await responseBody<RoomSnapshot>(persistedResponse)).toMatchObject({
      phase: "drawing",
      canvasVersion: 1,
      canvas: [expect.objectContaining({
        primitive: expect.objectContaining({ type: "line", y1: 700, y2: 700 }),
      })],
    });
  });
});
