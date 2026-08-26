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
import {
  ROUND_DURATION_MS,
  ROUND_RESULT_MAX_MS,
  ROUND_RESULT_MIN_MS,
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
  controller: "human" | "agent" = "human",
): Promise<JoinRoomResponse> {
  const response = await request(`/api/rooms/${roomCode}/join`, {
    method: "POST",
    body: JSON.stringify({ name, ...(team === undefined ? {} : { team }), controller }),
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

async function connectSeat(credentials: SeatCredentials): Promise<WebSocket> {
  const response = await request(
    `/ws/${credentials.roomCode}?token=${encodeURIComponent(credentials.token)}`,
    { headers: { Upgrade: "websocket" } },
  );
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const socket = response.webSocket!;
  socket.accept();
  return socket;
}

async function connectPractice(human: SeatCredentials, agent: SeatCredentials): Promise<[WebSocket, WebSocket]> {
  const humanSocket = await connectSeat(human);
  const agentSocket = await connectSeat(agent);
  return [humanSocket, agentSocket];
}

async function prompt(credentials: SeatCredentials): Promise<Response> {
  return request(`/api/rooms/${credentials.roomCode}/prompt`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
  });
}

async function fireReadyResultDeadline(credentials: SeatCredentials, roundIndex: number): Promise<void> {
  const stub = env.ROOMS.getByName(credentials.roomCode);
  await runInDurableObject(stub, async (_instance, durableState) => {
    const now = Date.now();
    const endedAt = now - ROUND_RESULT_MIN_MS - 1;
    durableState.storage.sql.exec(
      "UPDATE rounds SET started_at = ?, ended_at = ? WHERE round_index = ?",
      endedAt - 1_000,
      endedAt,
      roundIndex,
    );
    durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", now - 1);
    await durableState.storage.setAlarm(now + 60_000);
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
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
    expect(human.snapshot).toMatchObject({
      phase: "lobby",
      totalRounds: 2,
      roundDurationMs: ROUND_DURATION_MS,
    });
    expect(human.snapshot.seats).toHaveLength(1);
    const agent = await joinRoom(human.roomCode, "Browser Agent", "cobalt", "agent");

    expect(agent.seatId).not.toBe(human.seatId);
    expect(agent.token).not.toBe(human.token);
    expect(agent.roomCode).toBe(human.roomCode);
    expect(agent.snapshot.seats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: human.seatId, controller: "human" }),
        expect.objectContaining({ id: agent.seatId, controller: "agent" }),
      ]),
    );
    expect(agent.snapshot).toMatchObject({ phase: "lobby", endsAt: null });
    assertPromptAbsent(human.snapshot);
    await connectSeat(human);
    expect(await state(human)).toMatchObject({ phase: "lobby", endsAt: null });
    await connectSeat(agent);

    const firstState = await state(human);
    expect(firstState).toMatchObject({
      mode: "practice",
      phase: "round-prep",
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

    const rejectedMultiStroke = await command(agent, {
      type: "draw_batch",
      expectedVersion: 0,
      idempotencyKey: "agent-multi-stroke",
      primitives: [oneLine, { ...oneLine, y1: 200, y2: 350 }],
      origin: "webmcp",
    });
    expect(rejectedMultiStroke.status).toBe(400);
    expect(await body<ApiFailure>(rejectedMultiStroke)).toMatchObject({ code: "AGENT_STROKE_ONLY" });
    expect(await state(human)).toMatchObject({ phase: "round-prep", canvasVersion: 0 });

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
    expect(firstDrawResult.remainingMs).toBeGreaterThan(89_000);
    expect(await state(human)).toMatchObject({ phase: "drawing", canvasVersion: 1 });

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
    expect(firstGuessResult.remainingMs).toBeGreaterThan(0);

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

    const next = await command(human, { type: "ready_next", expectedRoundIndex: 0, origin: "human-ui" });
    expect(next.status).toBe(200);
    const agentReady = await command(agent, { type: "ready_next", expectedRoundIndex: 0, origin: "webmcp" });
    expect(agentReady.status).toBe(200);
    expect(await state(human)).toMatchObject({ phase: "round-end", roundIndex: 0 });
    await fireReadyResultDeadline(human, 0);
    const secondState = await state(agent);
    expect(secondState).toMatchObject({
      phase: "round-prep",
      roundIndex: 1,
      artistSeatId: human.seatId,
    });
    expect(secondState.roundResult).toMatchObject({ prompt: firstPrompt.prompt, roundIndex: 0 });

    const lateReady = await command(agent, { type: "ready_next", expectedRoundIndex: 0, origin: "webmcp" });
    expect(lateReady.status).toBe(200);
    expect(await body<CommandResult>(lateReady)).toMatchObject({ accepted: true, duplicate: true });

    const deniedAgentPrompt = await prompt(agent);
    expect(deniedAgentPrompt.status).toBe(403);
    const humanPromptResponse = await prompt(human);
    expect(humanPromptResponse.status).toBe(200);
    const secondPrompt = await body<PrivatePrompt>(humanPromptResponse);
    expect(secondPrompt.prompt).not.toBe(firstPrompt.prompt);
    expect(JSON.stringify(await state(agent)).toLocaleLowerCase("en-US"))
      .not.toContain(secondPrompt.prompt.toLocaleLowerCase("en-US"));

    const practiceStub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(practiceStub, async (_instance, durableState) => {
      const now = Date.now();
      durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", now - 1);
      await durableState.storage.setAlarm(now + 60_000);
    });
    expect(await runDurableObjectAlarm(practiceStub)).toBe(true);
    const heldForHuman = await state(agent);
    expect(heldForHuman).toMatchObject({
      phase: "round-prep",
      roundIndex: 1,
      endsAt: null,
      canvasVersion: secondState.canvasVersion,
      guesses: [],
    });
    expect(JSON.stringify(heldForHuman).toLocaleLowerCase("en-US"))
      .not.toContain(secondPrompt.prompt.toLocaleLowerCase("en-US"));
    await runInDurableObject(practiceStub, async (_instance, durableState) => {
      expect(await durableState.storage.getAlarm()).toBeNull();
    });

    const prematureAgentGuess = await command(agent, {
      type: "submit_guess",
      guess: secondPrompt.prompt,
      origin: "webmcp",
    });
    expect(prematureAgentGuess.status).toBe(409);
    expect(await body<ApiFailure>(prematureAgentGuess)).toMatchObject({ code: "WRONG_PHASE" });

    const humanDraw = await command(human, {
      type: "draw_batch",
      expectedVersion: secondState.canvasVersion,
      idempotencyKey: "human-second-round-batch",
      primitives: [{ ...oneLine, color: "cobalt" }],
      origin: "human-ui",
    });
    expect(humanDraw.status).toBe(200);
    expect(await body<CommandResult>(humanDraw)).toMatchObject({
      accepted: true,
      canvasVersion: secondState.canvasVersion + 1,
    });
    expect(await state(agent)).toMatchObject({ phase: "drawing", roundIndex: 1 });

    const secondGuess = await command(agent, {
      type: "submit_guess",
      guess: secondPrompt.prompt,
      origin: "webmcp",
    });
    expect(secondGuess.status).toBe(200);
    expect(await body<CommandResult>(secondGuess)).toMatchObject({ correct: true });

    const staleRoundReady = await command(agent, {
      type: "ready_next",
      expectedRoundIndex: 0,
      origin: "webmcp",
    });
    expect(staleRoundReady.status).toBe(200);
    expect(await body<CommandResult>(staleRoundReady)).toMatchObject({ duplicate: true });
    expect(await state(human)).toMatchObject({ phase: "round-end", roundIndex: 1 });

    const finish = await command(human, { type: "ready_next", expectedRoundIndex: 1, origin: "human-ui" });
    expect(finish.status).toBe(200);
    const agentFinish = await command(agent, { type: "ready_next", expectedRoundIndex: 1, origin: "webmcp" });
    expect(agentFinish.status).toBe(200);
    expect(await state(human)).toMatchObject({ phase: "round-end", roundIndex: 1 });
    await fireReadyResultDeadline(human, 1);
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
  it("defaults settings by mode and lets only the lobby host configure valid options", async () => {
    const agentHostResponse = await request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name: "Agent Settings Host", mode: "practice", controller: "agent" }),
    });
    expect(agentHostResponse.status).toBe(201);
    const agentHost = await body<JoinRoomResponse>(agentHostResponse);
    expect((await command(agentHost, {
      type: "configure_match",
      totalRounds: 6,
      roundDurationMs: 60_000,
      origin: "webmcp",
    })).status).toBe(200);
    expect(await state(agentHost)).toMatchObject({
      totalRounds: 6,
      roundDurationMs: 60_000,
    });

    const practice = await createRoom("practice", "Practice Settings Host");
    expect(practice.snapshot).toMatchObject({
      totalRounds: 2,
      roundDurationMs: 90_000,
    });
    const exhibition = await createRoom("exhibition", "Exhibition Settings Host");
    expect(exhibition.snapshot).toMatchObject({
      totalRounds: 6,
      roundDurationMs: 90_000,
    });
    expect((await command(exhibition, {
      type: "configure_match",
      totalRounds: 4,
      roundDurationMs: 60_000,
      origin: "human-ui",
    })).status).toBe(200);
    expect(await state(exhibition)).toMatchObject({
      totalRounds: 4,
      roundDurationMs: 60_000,
    });

    const host = await createRoom("arena", "Settings Host");
    const teammate = await joinRoom(host.roomCode, "Settings Teammate", "cobalt");
    const agent = await joinRoom(host.roomCode, "Settings Agent", "coral", "agent");
    expect(host.snapshot).toMatchObject({
      totalRounds: 6,
      roundDurationMs: 90_000,
    });

    expect((await command(host, {
      type: "ready_up",
      ready: true,
      origin: "human-ui",
    })).status).toBe(200);
    expect((await command(teammate, {
      type: "ready_up",
      ready: true,
      origin: "human-ui",
    })).status).toBe(200);

    const nonHost = await command(teammate, {
      type: "configure_match",
      totalRounds: 8,
      roundDurationMs: 45_000,
      origin: "human-ui",
    });
    expect(nonHost.status).toBe(403);
    expect(await body<ApiFailure>(nonHost)).toMatchObject({ code: "HOST_ONLY" });

    const invalidRounds = await command(host, {
      type: "configure_match",
      totalRounds: 2,
      roundDurationMs: 45_000,
      origin: "human-ui",
    });
    expect(invalidRounds.status).toBe(400);
    expect(await body<ApiFailure>(invalidRounds)).toMatchObject({ code: "INVALID_MATCH_SETTINGS" });

    const invalidDuration = await request(`/api/rooms/${host.roomCode}/commands`, {
      method: "POST",
      body: JSON.stringify({
        token: host.token,
        command: {
          type: "configure_match",
          totalRounds: 8,
          roundDurationMs: 30_000,
          origin: "human-ui",
        },
      }),
    });
    expect(invalidDuration.status).toBe(400);
    expect(await body<ApiFailure>(invalidDuration)).toMatchObject({ code: "INVALID_COMMAND" });

    const wrongOrigin = await command(host, {
      type: "configure_match",
      totalRounds: 8,
      roundDurationMs: 45_000,
      origin: "webmcp",
    });
    expect(wrongOrigin.status).toBe(403);
    expect(await body<ApiFailure>(wrongOrigin)).toMatchObject({ code: "ORIGIN_MISMATCH" });

    const beforeRevision = (await state(host)).revision;
    const configured = await command(host, {
      type: "configure_match",
      totalRounds: 8,
      roundDurationMs: 45_000,
      origin: "human-ui",
    });
    expect(configured.status).toBe(200);
    expect(await body<CommandResult>(configured)).toMatchObject({
      accepted: true,
      revision: beforeRevision + 1,
    });

    const snapshot = await state(host);
    expect(snapshot).toMatchObject({
      totalRounds: 8,
      roundDurationMs: 45_000,
    });
    expect(snapshot.seats.find((seat) => seat.id === host.seatId)?.isReady).toBe(false);
    expect(snapshot.seats.find((seat) => seat.id === teammate.seatId)?.isReady).toBe(false);
    expect(snapshot.seats.find((seat) => seat.id === agent.seatId)?.isReady).toBe(true);
    expect(snapshot.activity.at(-1)).toMatchObject({
      label: "match_configured",
      origin: "human-ui",
    });

    await abortAllDurableObjects();
    expect(await state(host)).toMatchObject({
      totalRounds: 8,
      roundDurationMs: 45_000,
    });
  });

  it("accepts Practice Pair options, uses the configured clock, and rejects changes after start", async () => {
    const human = await createRoom("practice", "Clock Host");
    const configure = await command(human, {
      type: "configure_match",
      totalRounds: 4,
      roundDurationMs: 45_000,
      origin: "human-ui",
    });
    expect(configure.status).toBe(200);
    expect(await state(human)).toMatchObject({ totalRounds: 4, roundDurationMs: 45_000 });

    const invalidPracticeRounds = await command(human, {
      type: "configure_match",
      totalRounds: 8,
      roundDurationMs: 60_000,
      origin: "human-ui",
    });
    expect(invalidPracticeRounds.status).toBe(400);
    expect(await body<ApiFailure>(invalidPracticeRounds)).toMatchObject({
      code: "INVALID_MATCH_SETTINGS",
    });

    const agent = await joinRoom(human.roomCode, "Clock Agent", "cobalt", "agent");
    await connectPractice(human, agent);
    const started = await state(agent);
    expect(started).toMatchObject({
      phase: "round-prep",
      totalRounds: 4,
      roundDurationMs: 45_000,
    });

    const draw = await command(agent, {
      type: "draw_batch",
      expectedVersion: started.canvasVersion,
      idempotencyKey: "configured-duration-opening-stroke",
      primitives: [oneLine],
      origin: "webmcp",
    });
    expect(draw.status).toBe(200);
    const drawing = await state(human);
    expect(drawing.phase).toBe("drawing");

    const stub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const round = durableState.storage.sql
        .exec<{ started_at: number; ends_at: number }>(
          "SELECT started_at, ends_at FROM rounds WHERE round_index = 0",
        )
        .one();
      expect(round.ends_at - round.started_at).toBe(45_000);
    });

    const wrongPhase = await command(human, {
      type: "configure_match",
      totalRounds: 6,
      roundDurationMs: 90_000,
      origin: "human-ui",
    });
    expect(wrongPhase.status).toBe(409);
    expect(await body<ApiFailure>(wrongPhase)).toMatchObject({ code: "WRONG_PHASE" });
  });

  it("migrates an existing v1 room to the persisted v2 duration column", async () => {
    const host = await createRoom("arena", "Migration Host");
    const stub = env.ROOMS.getByName(host.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      durableState.storage.sql.exec("ALTER TABLE room DROP COLUMN round_duration_ms");
      durableState.storage.sql.exec("DELETE FROM schema_migrations WHERE version = 2");
      const versions = durableState.storage.sql
        .exec<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version")
        .toArray()
        .map((row) => row.version);
      expect(versions).toEqual([1]);
    });

    await abortAllDurableObjects();
    expect(await state(host)).toMatchObject({
      totalRounds: 6,
      roundDurationMs: 90_000,
    });
    const recoveredStub = env.ROOMS.getByName(host.roomCode);
    await runInDurableObject(recoveredStub, async (_instance, durableState) => {
      const columns = durableState.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(room)")
        .toArray()
        .map((row) => row.name);
      expect(columns).toContain("round_duration_ms");
      const versions = durableState.storage.sql
        .exec<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version")
        .toArray()
        .map((row) => row.version);
      expect(versions).toEqual([1, 2]);
    });
  });

  it("persists hashed identity and room state across isolate teardown", async () => {
    const human = await createRoom("practice", "Eviction Test");
    const agent = await joinRoom(human.roomCode, "Eviction Agent", "cobalt", "agent");
    await connectPractice(human, agent);
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

  it("starts a blank prepared round, then finalizes drawing through Durable Object alarms", async () => {
    const human = await createRoom("practice", "Alarm Test");
    const agent = await joinRoom(human.roomCode, "Alarm Agent", "cobalt", "agent");
    await connectPractice(human, agent);
    const stub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const expiredAt = Date.now() - 1;
      durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", expiredAt);
      await durableState.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await state(human)).toMatchObject({ phase: "drawing", canvasVersion: 0 });

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

  it("keeps results stable through the minimum and advances at the hard deadline", async () => {
    const human = await createRoom("practice", "Results Host");
    const agent = await joinRoom(human.roomCode, "Results Agent", "cobalt", "agent");
    await connectPractice(human, agent);
    const secret = await body<PrivatePrompt>(await prompt(agent));
    expect((await command(agent, {
      type: "draw_batch",
      expectedVersion: 0,
      idempotencyKey: "results-opening-stroke",
      primitives: [oneLine],
      origin: "webmcp",
    })).status).toBe(200);
    expect((await command(human, {
      type: "submit_guess",
      guess: secret.prompt,
      origin: "human-ui",
    })).status).toBe(200);

    expect((await command(human, {
      type: "ready_next",
      expectedRoundIndex: 0,
      origin: "human-ui",
    })).status).toBe(200);
    const stub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const now = Date.now();
      const endedAt = now - ROUND_RESULT_MIN_MS - 1;
      durableState.storage.sql.exec(
        "UPDATE rounds SET started_at = ?, ended_at = ? WHERE round_index = 0",
        endedAt - 1_000,
        endedAt,
      );
      durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", now - 1);
      await durableState.storage.setAlarm(now + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const held = await state(human);
    expect(held).toMatchObject({ phase: "round-end", roundIndex: 0 });
    expect(held.roundResult).toMatchObject({ prompt: secret.prompt });

    await runInDurableObject(stub, async (_instance, durableState) => {
      const now = Date.now();
      const endedAt = now - ROUND_RESULT_MAX_MS - 1;
      durableState.storage.sql.exec(
        "UPDATE rounds SET started_at = ?, ended_at = ? WHERE round_index = 0",
        endedAt - 1_000,
        endedAt,
      );
      durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", now - 1);
      await durableState.storage.setAlarm(now + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const advanced = await state(human);
    expect(advanced).toMatchObject({ phase: "round-prep", roundIndex: 1 });
    expect(advanced.roundResult).toMatchObject({ prompt: secret.prompt, roundIndex: 0 });
  });

  it("expires immediately before command execution and rejects a late mutation", async () => {
    const human = await createRoom("practice", "Deadline Test");
    const agent = await joinRoom(human.roomCode, "Deadline Agent", "cobalt", "agent");
    await connectPractice(human, agent);

    const firstStroke = await command(agent, {
      type: "draw_batch",
      expectedVersion: 0,
      idempotencyKey: "on-time-agent-stroke",
      primitives: [oneLine],
      origin: "webmcp",
    });
    expect(firstStroke.status).toBe(200);

    const stub = env.ROOMS.getByName(human.roomCode);
    await runInDurableObject(stub, async (_instance, durableState) => {
      const expiredAt = Date.now() - 1;
      durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", expiredAt);
      durableState.storage.sql.exec("UPDATE rounds SET ends_at = ? WHERE round_index = 0", expiredAt);
    });

    const lateDraw = await command(agent, {
      type: "draw_batch",
      expectedVersion: 1,
      idempotencyKey: "late-agent-batch",
      primitives: [oneLine],
      origin: "webmcp",
    });
    expect(lateDraw.status).toBe(409);
    expect(await body<ApiFailure>(lateDraw)).toMatchObject({ code: "WRONG_PHASE" });

    const expired = await state(human);
    expect(expired).toMatchObject({ phase: "round-end", canvasVersion: 1 });
    expect(expired.roundResult).toMatchObject({ pointsAwarded: 0, strokeCount: 1 });
  });

  it("enforces arena team, host, artist, and guesser permissions", async () => {
    const host = await createRoom("arena", "Cobalt Host");
    const coralOne = await joinRoom(host.roomCode, "Coral One");
    const cobaltMate = await joinRoom(host.roomCode, "Cobalt Mate");
    const coralTwo = await joinRoom(host.roomCode, "Coral Two");
    const players = [host, coralOne, cobaltMate, coralTwo];
    await Promise.all(players.map(connectSeat));

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
    expect(started).toMatchObject({ phase: "round-prep", activeTeam: "cobalt" });
    expect(started.artistSeatId).toBe(host.seatId);

    const artistPromptResponse = await prompt(host);
    expect(artistPromptResponse.status).toBe(200);
    const artistPrompt = await body<PrivatePrompt>(artistPromptResponse);

    const prepGuess = await command(cobaltMate, {
      type: "submit_guess",
      guess: artistPrompt.prompt,
      origin: "human-ui",
    });
    expect(prepGuess.status).toBe(409);
    expect(await body<ApiFailure>(prepGuess)).toMatchObject({ code: "WRONG_PHASE" });

    const openingStroke = await command(host, {
      type: "draw_batch",
      expectedVersion: started.canvasVersion,
      idempotencyKey: "arena-opening-stroke",
      primitives: [oneLine],
      origin: "human-ui",
    });
    expect(openingStroke.status).toBe(200);
    expect(await state(host)).toMatchObject({ phase: "drawing", canvasVersion: 1 });

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

  it("uses six different prompts across a complete arena match", async () => {
    const host = await createRoom("arena", "Deck Host");
    const coralOne = await joinRoom(host.roomCode, "Deck Coral One");
    const cobaltMate = await joinRoom(host.roomCode, "Deck Cobalt Mate");
    const coralTwo = await joinRoom(host.roomCode, "Deck Coral Two");
    const players = [host, coralOne, cobaltMate, coralTwo];
    await Promise.all(players.map(connectSeat));
    for (const player of players) {
      expect((await command(player, {
        type: "ready_up",
        ready: true,
        origin: "human-ui",
      })).status).toBe(200);
    }
    expect((await command(host, { type: "start_match", origin: "human-ui" })).status).toBe(200);

    const credentialsBySeat = new Map(players.map((player) => [player.seatId, player]));
    const seen = new Set<string>();
    const stub = env.ROOMS.getByName(host.roomCode);
    for (let roundIndex = 0; roundIndex < 6; roundIndex += 1) {
      const prepared = await state(host);
      expect(prepared).toMatchObject({ phase: "round-prep", roundIndex });
      const artist = credentialsBySeat.get(prepared.artistSeatId!);
      expect(artist).toBeDefined();
      const card = await body<PrivatePrompt>(await prompt(artist!));
      expect(seen.has(card.prompt)).toBe(false);
      seen.add(card.prompt);

      await runInDurableObject(stub, async (_instance, durableState) => {
        const now = Date.now();
        durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", now - 1);
        await durableState.storage.setAlarm(now + 60_000);
      });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(await state(host)).toMatchObject({ phase: "drawing", roundIndex });

      await runInDurableObject(stub, async (_instance, durableState) => {
        const now = Date.now();
        durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", now - 1);
        durableState.storage.sql.exec(
          "UPDATE rounds SET ends_at = ? WHERE round_index = ?",
          now - 1,
          roundIndex,
        );
        await durableState.storage.setAlarm(now + 60_000);
      });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(await state(host)).toMatchObject({ phase: "round-end", roundIndex });

      await runInDurableObject(stub, async (_instance, durableState) => {
        const now = Date.now();
        const endedAt = now - ROUND_RESULT_MAX_MS - 1;
        durableState.storage.sql.exec(
          "UPDATE rounds SET started_at = ?, ended_at = ? WHERE round_index = ?",
          endedAt - 1_000,
          endedAt,
          roundIndex,
        );
        durableState.storage.sql.exec("UPDATE room SET ends_at = ? WHERE id = 1", now - 1);
        await durableState.storage.setAlarm(now + 60_000);
      });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
    }
    expect(seen).toHaveLength(6);
    expect(await state(host)).toMatchObject({ phase: "match-end", roundIndex: 5 });
  });

  it("auto-readies agent joins and ignores disconnected unready lobby ghosts", async () => {
    const host = await createRoom("arena", "Fast Host");
    const coralAgent = await joinRoom(host.roomCode, "Coral Agent", "coral", "agent");
    const cobaltMate = await joinRoom(host.roomCode, "Cobalt Mate", "cobalt");
    const coralMate = await joinRoom(host.roomCode, "Coral Mate", "coral");
    await joinRoom(host.roomCode, "Abandoned Agent", "cobalt", "agent");
    await Promise.all([host, coralAgent, cobaltMate, coralMate].map(connectSeat));

    const joined = await state(host);
    expect(joined.seats.find((seat) => seat.id === coralAgent.seatId)).toMatchObject({
      controller: "agent",
      isReady: true,
    });

    for (const player of [host, cobaltMate, coralMate]) {
      expect((await command(player, { type: "ready_up", ready: true, origin: "human-ui" })).status).toBe(200);
    }

    const start = await command(host, { type: "start_match", origin: "human-ui" });
    expect(start.status).toBe(200);
    expect(await state(host)).toMatchObject({ phase: "round-prep", artistSeatId: host.seatId });
  });

  it("removes lobby seats on explicit leave and transfers hosting", async () => {
    const host = await createRoom("arena", "Leaving Host");
    const successor = await joinRoom(host.roomCode, "New Host", "coral");
    const response = await request(`/api/rooms/${host.roomCode}/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(200);
    expect(await body<{ accepted: true }>(response)).toEqual({ accepted: true });
    const snapshot = await state(successor);
    expect(snapshot.seats).toEqual([
      expect.objectContaining({ id: successor.seatId, isHost: true }),
    ]);
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
