import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/worker/index";
import type {
  ApiFailure,
  CommandResult,
  JoinRoomResponse,
  PrivatePrompt,
  RoomCommand,
  RoomSnapshot,
  SeatCredentials,
  VectorPrimitive,
} from "../src/shared/game";

const BASE_URL = "https://mcpencil.com";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return worker.fetch(new Request(`${BASE_URL}${path}`, { ...init, headers }), env);
}

async function body<T>(response: Response): Promise<T> {
  return response.json<T>();
}

async function createRoom(
  mode: "practice" | "arena" | "exhibition",
  name = "Test Human",
): Promise<JoinRoomResponse> {
  const response = await request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name, mode, controller: "human" }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("Permissions-Policy")).toContain("tools=(self)");
  return body<JoinRoomResponse>(response);
}

async function joinRoom(
  roomCode: string,
  name: string,
  team?: "cobalt" | "coral",
): Promise<JoinRoomResponse> {
  const response = await request(`/api/rooms/${roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name, ...(team === undefined ? {} : { team }), controller: "human" }),
  });
  expect(response.status).toBe(201);
  return body<JoinRoomResponse>(response);
}

async function command(
  credentials: SeatCredentials,
  roomCommand: RoomCommand,
): Promise<Response> {
  return request(`/api/rooms/${credentials.roomCode}/commands`, {
    method: "POST",
    body: JSON.stringify({ token: credentials.token, command: roomCommand }),
  });
}

async function state(credentials: SeatCredentials): Promise<RoomSnapshot> {
  const response = await request(`/api/rooms/${credentials.roomCode}/state`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
  });
  expect(response.status).toBe(200);
  return body<RoomSnapshot>(response);
}

async function prompt(credentials: SeatCredentials): Promise<Response> {
  return request(`/api/rooms/${credentials.roomCode}/prompt`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
  });
}

const oneLine: VectorPrimitive = {
  type: "line",
  x1: 100,
  y1: 100,
  x2: 300,
  y2: 250,
  color: "ink",
  width: 7,
};

function assertPromptAbsent(value: unknown, secret?: string): void {
  const serialized = JSON.stringify(value).toLocaleLowerCase("en-US");
  expect(serialized).not.toMatch(/"prompt"\s*:/);
  expect(serialized).not.toMatch(/"aliases"\s*:/);
  if (secret !== undefined) {
    expect(serialized).not.toContain(secret.toLocaleLowerCase("en-US"));
  }
}

describe("Practice Pair HTTP journey", () => {
  it("keeps two identities separate and completes both WebMCP directions", async () => {
    const human = await createRoom("practice", "Human Artist");
    const agent = human.companion;
    expect(agent).toBeDefined();
    if (agent === undefined) throw new Error("Practice response omitted its agent companion.");

    expect(agent.seatId).not.toBe(human.seatId);
    expect(agent.token).not.toBe(human.token);
    expect(agent.roomCode).toBe(human.roomCode);
    expect(human.snapshot.seats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: human.seatId, controller: "human" }),
        expect.objectContaining({ id: agent.seatId, controller: "agent" }),
      ]),
    );
    assertPromptAbsent(human.snapshot);

    const start = await command(human, { type: "start_match", origin: "human-ui" });
    expect(start.status).toBe(200);
    const firstState = await state(human);
    expect(firstState).toMatchObject({
      mode: "practice",
      phase: "drawing",
      roundIndex: 0,
      totalRounds: 2,
      artistSeatId: agent.seatId,
    });

    const deniedHumanPrompt = await prompt(human);
    expect(deniedHumanPrompt.status).toBe(403);
    expect(await body<ApiFailure>(deniedHumanPrompt)).toMatchObject({ code: "NOT_ARTIST" });

    const agentPromptResponse = await prompt(agent);
    expect(agentPromptResponse.status).toBe(200);
    const firstPrompt = await body<PrivatePrompt>(agentPromptResponse);
    expect(firstPrompt.prompt.length).toBeGreaterThan(2);
    assertPromptAbsent(await state(human), firstPrompt.prompt);

    const replayBeforeReveal = await request(`/api/rooms/${human.roomCode}/replay`, {
      headers: { Authorization: `Bearer ${human.token}` },
    });
    expect(replayBeforeReveal.status).toBe(200);
    assertPromptAbsent(await body<unknown>(replayBeforeReveal), firstPrompt.prompt);

    const wrongOrigin = await command(agent, {
      type: "draw_batch",
      expectedVersion: 0,
      idempotencyKey: "origin-mismatch-1",
      primitives: [oneLine],
      origin: "human-ui",
    });
    expect(wrongOrigin.status).toBe(403);
    expect(await body<ApiFailure>(wrongOrigin)).toMatchObject({ code: "ORIGIN_MISMATCH" });

    const firstDrawCommand: RoomCommand = {
      type: "draw_batch",
      expectedVersion: 0,
      idempotencyKey: "agent-first-batch",
      primitives: [oneLine],
      origin: "webmcp",
    };
    const firstDraw = await command(agent, firstDrawCommand);
    expect(firstDraw.status).toBe(200);
    const firstDrawResult = await body<CommandResult>(firstDraw);
    expect(firstDrawResult).toMatchObject({ accepted: true, canvasVersion: 1, duplicate: false });

    const duplicate = await command(agent, firstDrawCommand);
    expect(duplicate.status).toBe(200);
    expect(await body<CommandResult>(duplicate)).toMatchObject({
      accepted: true,
      canvasVersion: 1,
      duplicate: true,
      batchId: firstDrawResult.batchId,
    });

    const stale = await command(agent, {
      ...firstDrawCommand,
      idempotencyKey: "agent-stale-batch",
      expectedVersion: 0,
    });
    expect(stale.status).toBe(409);
    expect(await body<ApiFailure>(stale)).toMatchObject({ code: "STALE_CANVAS" });

    const rateLimited = await command(agent, {
      ...firstDrawCommand,
      idempotencyKey: "agent-rate-batch",
      expectedVersion: 1,
    });
    expect(rateLimited.status).toBe(429);
    expect(await body<ApiFailure>(rateLimited)).toMatchObject({ code: "RATE_LIMITED" });

    const firstGuess = await command(human, {
      type: "submit_guess",
      guess: firstPrompt.prompt,
      origin: "human-ui",
    });
    expect(firstGuess.status).toBe(200);
    const firstGuessResult = await body<CommandResult>(firstGuess);
    expect(firstGuessResult.correct).toBe(true);
    expect(firstGuessResult.pointsAwarded).toBeGreaterThanOrEqual(100);
    expect(firstGuessResult.pointsAwarded).toBeLessThanOrEqual(190);

    const firstResult = await state(human);
    expect(firstResult.phase).toBe("round-end");
    expect(firstResult.roundResult).toMatchObject({
      prompt: firstPrompt.prompt,
      artistSeatId: agent.seatId,
      guessedBySeatId: human.seatId,
      strokeCount: 1,
    });
    expect(firstResult.analytics.byOrigin.webmcp).toBe(1);
    expect(firstResult.analytics.byOrigin["human-ui"]).toBe(1);

    const next = await command(human, { type: "ready_next", origin: "human-ui" });
    expect(next.status).toBe(200);
    const secondState = await state(agent);
    expect(secondState).toMatchObject({
      phase: "drawing",
      roundIndex: 1,
      artistSeatId: human.seatId,
    });

    const deniedAgentPrompt = await prompt(agent);
    expect(deniedAgentPrompt.status).toBe(403);
    const humanPromptResponse = await prompt(human);
    expect(humanPromptResponse.status).toBe(200);
    const secondPrompt = await body<PrivatePrompt>(humanPromptResponse);
    expect(secondPrompt.prompt).not.toBe(firstPrompt.prompt);
    assertPromptAbsent(await state(agent), secondPrompt.prompt);

    const humanDraw = await command(human, {
      type: "draw_batch",
      expectedVersion: secondState.canvasVersion,
      idempotencyKey: "human-second-round-batch",
      primitives: [{ ...oneLine, color: "cobalt" }],
      origin: "human-ui",
    });
    expect(humanDraw.status).toBe(200);

    const secondGuess = await command(agent, {
      type: "submit_guess",
      guess: secondPrompt.prompt,
      origin: "webmcp",
    });
    expect(secondGuess.status).toBe(200);
    expect(await body<CommandResult>(secondGuess)).toMatchObject({ correct: true });

    const finish = await command(human, { type: "ready_next", origin: "human-ui" });
    expect(finish.status).toBe(200);
    const finalState = await state(human);
    expect(finalState.phase).toBe("match-end");
    expect(finalState.artistSeatId).toBeNull();
    expect(finalState.analytics.correctGuesses).toBe(2);
    expect(finalState.analytics.totalStrokes).toBe(2);

    const finalReplay = await request(`/api/rooms/${human.roomCode}/replay`, {
      headers: { Authorization: `Bearer ${human.token}` },
    });
    expect(finalReplay.status).toBe(200);
    const finalReplayText = await finalReplay.text();
    expect(finalReplayText).toContain(firstPrompt.prompt);
    expect(finalReplayText).toContain(secondPrompt.prompt);
  });
});

describe("Durable room authority", () => {
  it("persists hashed identity and room state across isolate teardown", async () => {
    const human = await createRoom("practice", "Eviction Test");
    expect(human.companion).toBeDefined();
    const start = await command(human, { type: "start_match", origin: "human-ui" });
    expect(start.status).toBe(200);
    const before = await state(human);

    const stub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const columns = durableState.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(seats)")
        .toArray()
        .map((row) => row.name);
      expect(columns).toContain("token_hash");
      expect(columns).not.toContain("token");

      const hashes = durableState.storage.sql
        .exec<{ token_hash: string }>("SELECT token_hash FROM seats")
        .toArray();
      expect(hashes).toHaveLength(2);
      for (const row of hashes) {
        expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(row.token_hash).not.toBe(human.token);
      }

    });

    // Force a new DO instance without deleting storage. This exercises the same reconstruction
    // path as eviction while avoiding the plugin's graceful-drain wait for active alarm references.
    await abortAllDurableObjects();
    const recovered = await state(human);
    expect(recovered).toMatchObject({
      roomCode: before.roomCode,
      phase: before.phase,
      roundIndex: before.roundIndex,
      artistSeatId: before.artistSeatId,
      canvasVersion: before.canvasVersion,
    });
  });

  it("finalizes an expired round through the Durable Object alarm", async () => {
    const human = await createRoom("practice", "Alarm Test");
    expect((await command(human, { type: "start_match", origin: "human-ui" })).status).toBe(200);
    const stub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const expiredAt = Date.now() - 1;
      durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", expiredAt);
      durableState.storage.sql.exec("UPDATE rounds SET ends_at = ? WHERE round_index = 0", expiredAt);
      await durableState.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const expired = await state(human);
    expect(expired.phase).toBe("round-end");
    expect(expired.roundResult).toMatchObject({
      roundIndex: 0,
      pointsAwarded: 0,
    });
  });

  it("expires immediately before command execution and rejects a late mutation", async () => {
    const human = await createRoom("practice", "Deadline Test");
    const agent = human.companion;
    expect(agent).toBeDefined();
    if (agent === undefined) throw new Error("Practice response omitted its agent companion.");
    expect((await command(human, { type: "start_match", origin: "human-ui" })).status).toBe(200);

    const stub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const expiredAt = Date.now() - 1;
      durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", expiredAt);
      durableState.storage.sql.exec("UPDATE rounds SET ends_at = ? WHERE round_index = 0", expiredAt);
    });

    const lateDraw = await command(agent, {
      type: "draw_batch",
      expectedVersion: 0,
      idempotencyKey: "late-agent-batch",
      primitives: [oneLine],
      origin: "webmcp",
    });
    expect(lateDraw.status).toBe(409);
    expect(await body<ApiFailure>(lateDraw)).toMatchObject({ code: "WRONG_PHASE" });

    const expired = await state(human);
    expect(expired).toMatchObject({ phase: "round-end", canvasVersion: 0 });
    expect(expired.roundResult).toMatchObject({ pointsAwarded: 0, strokeCount: 0 });
  });

  it("enforces arena team, host, artist, and guesser permissions", async () => {
    const host = await createRoom("arena", "Cobalt Host");
    const coralOne = await joinRoom(host.roomCode, "Coral One");
    const cobaltMate = await joinRoom(host.roomCode, "Cobalt Mate");
    const coralTwo = await joinRoom(host.roomCode, "Coral Two");
    const players = [host, coralOne, cobaltMate, coralTwo];

    const spoofedReady = await command(host, {
      type: "ready_up",
      ready: true,
      origin: "webmcp",
    });
    expect(spoofedReady.status).toBe(403);
    expect(await body<ApiFailure>(spoofedReady)).toMatchObject({ code: "ORIGIN_MISMATCH" });

    for (const player of players) {
      const response = await command(player, { type: "ready_up", ready: true, origin: "human-ui" });
      expect(response.status).toBe(200);
    }

    const nonHostStart = await command(coralOne, { type: "start_match", origin: "human-ui" });
    expect(nonHostStart.status).toBe(403);
    expect(await body<ApiFailure>(nonHostStart)).toMatchObject({ code: "HOST_ONLY" });

    const hostStart = await command(host, { type: "start_match", origin: "human-ui" });
    expect(hostStart.status).toBe(200);
    const started = await state(host);
    expect(started).toMatchObject({ phase: "drawing", activeTeam: "cobalt" });
    expect(started.artistSeatId).toBe(host.seatId);

    const artistPromptResponse = await prompt(host);
    expect(artistPromptResponse.status).toBe(200);
    const artistPrompt = await body<PrivatePrompt>(artistPromptResponse);

    const opponentGuess = await command(coralOne, {
      type: "submit_guess",
      guess: artistPrompt.prompt,
      origin: "human-ui",
    });
    expect(opponentGuess.status).toBe(403);
    expect(await body<ApiFailure>(opponentGuess)).toMatchObject({ code: "NOT_GUESSER" });

    const selfGuess = await command(host, {
      type: "submit_guess",
      guess: artistPrompt.prompt,
      origin: "human-ui",
    });
    expect(selfGuess.status).toBe(403);
    expect(await body<ApiFailure>(selfGuess)).toMatchObject({ code: "NOT_GUESSER" });

    const teammateGuess = await command(cobaltMate, {
      type: "submit_guess",
      guess: artistPrompt.prompt,
      origin: "human-ui",
    });
    expect(teammateGuess.status).toBe(200);
    expect(await body<CommandResult>(teammateGuess)).toMatchObject({ correct: true });

    const ended = await state(coralTwo);
    expect(ended.phase).toBe("round-end");
    expect(ended.scores.cobalt).toBeGreaterThanOrEqual(100);
    expect(ended.scores.coral).toBe(0);
  });

  it("serializes concurrent joins without overfilling teams or duplicating positions", async () => {
    const host = await createRoom("arena", "Concurrency Host");
    const joins = await Promise.all(
      Array.from({ length: 7 }, (_, index) => request(`/api/rooms/${host.roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: `Concurrent ${index + 1}`, controller: "human" }),
      })),
    );
    expect(joins.map((response) => response.status)).toEqual(Array(7).fill(201));

    const overflow = await request(`/api/rooms/${host.roomCode}/join`, {
      method: "POST",
      body: JSON.stringify({ name: "Ninth Player", controller: "human" }),
    });
    expect(overflow.status).toBe(409);
    expect(await body<ApiFailure>(overflow)).toMatchObject({ code: "ROOM_FULL" });

    const snapshot = await state(host);
    expect(snapshot.seats).toHaveLength(8);
    expect(snapshot.seats.filter((seat) => seat.team === "cobalt")).toHaveLength(4);
    expect(snapshot.seats.filter((seat) => seat.team === "coral")).toHaveLength(4);

    const stub = env.ROOMS.getByName(host.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const positions = durableState.storage.sql
        .exec<{ position: number }>("SELECT position FROM seats ORDER BY position")
        .toArray()
        .map((row) => row.position);
      expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
  });

  it("rejects cross-origin API requests before touching room state", async () => {
    const response = await request("/api/rooms", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({ name: "Mallory", mode: "arena", controller: "human" }),
    });
    expect(response.status).toBe(403);
    expect(await body<ApiFailure>(response)).toMatchObject({ code: "ORIGIN_REJECTED" });
  });
});
