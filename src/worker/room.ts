import { DurableObject } from "cloudflare:workers";
import {
  ARENA_ROUND_OPTIONS,
  CommandEnvelopeSchema,
  CreateRoomRequestSchema,
  FREE_FOR_ALL_MAX_PLAYERS,
  FREE_FOR_ALL_MIN_PLAYERS,
  JoinRoomRequestSchema,
  PRACTICE_ROUND_OPTIONS,
  PrimitiveSchema,
  ROUND_DURATION_MS,
  ROUND_DURATION_OPTIONS_MS,
  ROUND_PREP_DURATION_MS,
  ROUND_RESULT_MAX_MS,
  ROUND_RESULT_MIN_MS,
  RoomCodeSchema,
  SeatTokenSchema,
  TEAM_ROUND_COUNT,
  type ActionOrigin,
  type ActivityEvent,
  type CanvasEvent,
  type CommandResult,
  type ControllerType,
  type GuessEvent,
  type JoinRoomResponse,
  type MatchAnalytics,
  type MatchPhase,
  type PrivatePrompt,
  type PromptDifficulty,
  type PlayerStanding,
  type RoomCommand,
  type RoomMode,
  type RoomSnapshot,
  type RoundResult,
  type Seat,
  type TeamId,
  type VectorPrimitive,
} from "../shared/game";
import {
  ApiError,
  SECURITY_HEADERS,
  failureResponse,
  jsonResponse,
  readJsonBody,
  zodIssues,
} from "./errors";
import { isGuessClose, isGuessCorrect } from "./guessing";
import { randomPrompt } from "./prompts";

type SqlRecord = Record<string, SqlStorageValue>;

type StoredRoomMode = RoomMode | "exhibition";

interface RoomRow extends SqlRecord {
  room_code: string;
  mode: StoredRoomMode;
  phase: MatchPhase;
  revision: number;
  round_index: number;
  total_rounds: number;
  round_duration_ms: number;
  prompt_difficulty: PromptDifficulty;
  active_team: TeamId;
  artist_seat_id: string | null;
  ends_at: number | null;
  canvas_version: number;
  score_cobalt: number;
  score_coral: number;
  round_result_json: string | null;
  created_at: number;
}

interface SeatRow extends SqlRecord {
  id: string;
  token_hash: string;
  name: string;
  team: TeamId;
  controller: ControllerType;
  is_host: number;
  is_ready: number;
  is_connected: number;
  position: number;
  joined_at: number;
}

interface RoundRow extends SqlRecord {
  round_index: number;
  prompt: string;
  category: string;
  aliases_json: string;
  artist_seat_id: string;
  team: TeamId;
  started_at: number;
  ends_at: number;
  ended_at: number | null;
  guessed_by_seat_id: string | null;
  points_awarded: number;
  stroke_count: number;
  tool_call_count: number;
}

interface CanvasRow extends SqlRecord {
  id: string;
  batch_id: string;
  canvas_version: number;
  round_index: number;
  seat_id: string;
  origin: ActionOrigin;
  primitive_json: string;
  created_at: number;
  reverted: number;
}

interface GuessRow extends SqlRecord {
  id: string;
  round_index: number;
  seat_id: string;
  display_name: string;
  guess_text: string;
  origin: ActionOrigin;
  is_correct: number;
  created_at: number;
}

interface ActivityRow extends SqlRecord {
  id: string;
  round_index: number;
  kind: ActivityEvent["kind"];
  label: string;
  detail: string;
  seat_id: string | null;
  origin: ActionOrigin | null;
  canvas_version: number;
  created_at: number;
}

interface ValueRow extends SqlRecord {
  value: number | null;
}

interface SocketAttachment {
  seatId: string;
}

interface InternalCreatePayload {
  roomCode: string;
  request: unknown;
}

interface InternalJoinPayload {
  request: unknown;
}

interface CommandExecution {
  result: CommandResult;
  alarm: "set" | "delete" | null;
}

type DeadlineTransition =
  | "prep-held"
  | "prep-started"
  | "round-ended"
  | "result-extended"
  | "round-advanced";

const SCHEMA_VERSION = 3;
const HUMAN_DRAW_RATE_LIMIT_MS = 40;
const AGENT_DRAW_RATE_LIMIT_MS = 250;
const GUESS_RATE_LIMIT_MS = 350;
const MAX_ACTIVITY = 80;
const MAX_SOCKET_MESSAGE_BYTES = 2_048;

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.migrateSchema();
    });
  }

  private migrateSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    const appliedVersions = new Set(
      this.rows<SqlRecord & { version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).map((row) => row.version),
    );
    if (appliedVersions.has(SCHEMA_VERSION)) return;

    if (!appliedVersions.has(1)) {
      this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          room_code TEXT NOT NULL UNIQUE,
          mode TEXT NOT NULL,
          phase TEXT NOT NULL,
          revision INTEGER NOT NULL,
          round_index INTEGER NOT NULL,
          total_rounds INTEGER NOT NULL,
          active_team TEXT NOT NULL,
          artist_seat_id TEXT,
          ends_at INTEGER,
          canvas_version INTEGER NOT NULL,
          score_cobalt INTEGER NOT NULL,
          score_coral INTEGER NOT NULL,
          round_result_json TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS seats (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          team TEXT NOT NULL,
          controller TEXT NOT NULL,
          is_host INTEGER NOT NULL,
          is_ready INTEGER NOT NULL,
          is_connected INTEGER NOT NULL,
          position INTEGER NOT NULL,
          joined_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rounds (
          round_index INTEGER PRIMARY KEY,
          prompt TEXT NOT NULL,
          category TEXT NOT NULL,
          aliases_json TEXT NOT NULL,
          artist_seat_id TEXT NOT NULL,
          team TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ends_at INTEGER NOT NULL,
          ended_at INTEGER,
          guessed_by_seat_id TEXT,
          points_awarded INTEGER NOT NULL DEFAULT 0,
          stroke_count INTEGER NOT NULL DEFAULT 0,
          tool_call_count INTEGER NOT NULL DEFAULT 0
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS canvas_events (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL,
          canvas_version INTEGER NOT NULL UNIQUE,
          round_index INTEGER NOT NULL,
          seat_id TEXT NOT NULL,
          origin TEXT NOT NULL,
          primitive_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          reverted INTEGER NOT NULL DEFAULT 0
        )
      `);
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS canvas_round_idx ON canvas_events(round_index, canvas_version)",
      );
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS guesses (
          id TEXT PRIMARY KEY,
          round_index INTEGER NOT NULL,
          seat_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          guess_text TEXT NOT NULL,
          origin TEXT NOT NULL,
          is_correct INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS guesses_round_idx ON guesses(round_index, created_at)",
      );
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS activities (
          id TEXT PRIMARY KEY,
          round_index INTEGER NOT NULL,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          detail TEXT NOT NULL,
          seat_id TEXT,
          origin TEXT,
          canvas_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS activities_created_idx ON activities(created_at)",
      );
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS idempotency (
          seat_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (seat_id, idempotency_key)
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          seat_id TEXT NOT NULL,
          action TEXT NOT NULL,
          last_at INTEGER NOT NULL,
          PRIMARY KEY (seat_id, action)
        )
      `);
        this.ctx.storage.sql.exec(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)",
          Date.now(),
        );
      });
    }

    if (!appliedVersions.has(2)) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "ALTER TABLE room ADD COLUMN round_duration_ms INTEGER NOT NULL DEFAULT 90000",
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)",
          Date.now(),
        );
      });
    }

    if (!appliedVersions.has(3)) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "ALTER TABLE room ADD COLUMN prompt_difficulty TEXT NOT NULL DEFAULT 'easy'",
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)",
          Date.now(),
        );
      });
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      switch (`${request.method} ${url.pathname}`) {
        case "POST /internal/create":
          return await this.createRoom(request);
        case "POST /internal/join":
          return await this.joinRoom(request);
        case "GET /internal/state":
          return await this.getState(request);
        case "POST /internal/commands":
          return await this.executeCommand(request);
        case "POST /internal/leave":
          return await this.leaveRoom(request);
        case "GET /internal/prompt":
          return await this.getPrompt(request);
        case "GET /internal/replay":
          return await this.getReplay(request);
        case "GET /internal/ws":
          return await this.acceptWebSocket(request);
        default:
          throw new ApiError(404, "NOT_FOUND", "Room endpoint not found.");
      }
    } catch (error) {
      return failureResponse(error);
    }
  }

  async alarm(): Promise<void> {
    await this.expireAndBroadcast(Date.now());
  }

  async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      if (typeof message !== "string") {
        webSocket.close(
          message.byteLength > MAX_SOCKET_MESSAGE_BYTES ? 1009 : 1003,
          message.byteLength > MAX_SOCKET_MESSAGE_BYTES ? "Socket message is too large" : "Text messages only",
        );
        return;
      }
      if (
        message.length > MAX_SOCKET_MESSAGE_BYTES
        || new TextEncoder().encode(message).byteLength > MAX_SOCKET_MESSAGE_BYTES
      ) {
        webSocket.close(1009, "Socket message is too large");
        return;
      }
      if (message === "ping") {
        webSocket.send("pong");
        return;
      }
      const parsed = JSON.parse(message) as { type?: unknown };
      if (parsed.type !== "sync") return;
      const expired = await this.expireAndBroadcast(Date.now());
      if (!expired) {
        webSocket.send(JSON.stringify({ type: "snapshot", snapshot: this.publicSnapshot() }));
      }
    } catch (error) {
      webSocket.send(
        JSON.stringify({
          type: "error",
          code: "INVALID_SOCKET_MESSAGE",
          message: error instanceof Error ? error.message : "Invalid socket message.",
        }),
      );
    }
  }

  async webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    const attachment = this.socketAttachment(webSocket);
    try {
      webSocket.close(code, reason);
    } catch {
      // The runtime may already have completed the close handshake.
    }
    if (attachment === null || this.hasLiveSocket(attachment.seatId, webSocket)) return;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE seats SET is_connected = 0 WHERE id = ?", attachment.seatId);
      this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
    });
    console.log(
      JSON.stringify({ event: "socket_closed", seatId: attachment.seatId, code, wasClean }),
    );
    await this.broadcastSnapshot();
  }

  async webSocketError(webSocket: WebSocket, error: unknown): Promise<void> {
    console.warn(
      JSON.stringify({
        event: "socket_error",
        message: error instanceof Error ? error.message : "Unknown WebSocket error",
      }),
    );
    await this.webSocketClose(webSocket, 1011, "Socket error", false);
  }

  private async createRoom(request: Request): Promise<Response> {
    if (this.roomOrNull() !== null) {
      throw new ApiError(409, "ROOM_EXISTS", "That room code is already in use.");
    }
    const payload = (await readJsonBody(request, 8_000)) as Partial<InternalCreatePayload>;
    const codeResult = RoomCodeSchema.safeParse(payload.roomCode);
    const requestResult = CreateRoomRequestSchema.safeParse(payload.request);
    if (!codeResult.success) {
      throw new ApiError(400, "INVALID_ROOM_CODE", "Room code is invalid.", zodIssues(codeResult.error.issues));
    }
    if (!requestResult.success) {
      throw new ApiError(400, "INVALID_CREATE_REQUEST", "Room settings are invalid.", zodIssues(requestResult.error.issues));
    }

    const now = Date.now();
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const seatId = crypto.randomUUID();
    const roomCode = codeResult.data;
    const data = requestResult.data;
    const name = cleanPlayerText(data.name);
    const totalRounds = data.mode === "practice"
      ? 2
      : data.mode === "free-for-all"
        ? 1
        : TEAM_ROUND_COUNT;

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO room(
          id, room_code, mode, phase, revision, round_index, total_rounds, round_duration_ms, active_team,
          artist_seat_id, ends_at, canvas_version, score_cobalt, score_coral,
          round_result_json, created_at
        ) VALUES (1, ?, ?, 'lobby', 1, -1, ?, ?, 'cobalt', NULL, NULL, 0, 0, 0, NULL, ?)`,
        roomCode,
        data.mode,
        totalRounds,
        ROUND_DURATION_MS,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO seats(
          id, token_hash, name, team, controller, is_host, is_ready,
          is_connected, position, joined_at
        ) VALUES (?, ?, ?, 'cobalt', ?, 1, ?, 0, 0, ?)`,
        seatId,
        tokenHash,
        name,
        data.controller,
        data.mode === "practice" || data.controller === "agent" ? 1 : 0,
        now,
      );
      this.insertActivitySync({
        roundIndex: -1,
        kind: "system",
        label: "room_created",
        detail: "The sketchbook is open.",
        seatId,
        origin: data.controller === "agent" ? "webmcp" : "human-ui",
        canvasVersion: 0,
        now,
      });
    });

    const response: JoinRoomResponse = {
      roomCode,
      seatId,
      token,
      snapshot: this.publicSnapshot(),
    };
    console.log(JSON.stringify({ event: "room_created", roomCode, mode: data.mode }));
    return jsonResponse(response, { status: 201 });
  }

  private async joinRoom(request: Request): Promise<Response> {
    const initialRoom = this.requireRoom();
    if (initialRoom.phase !== "lobby") {
      throw new ApiError(409, "MATCH_STARTED", "This match has already started.");
    }
    const payload = (await readJsonBody(request, 8_000)) as Partial<InternalJoinPayload>;
    const result = JoinRoomRequestSchema.safeParse(payload.request);
    if (!result.success) {
      throw new ApiError(400, "INVALID_JOIN_REQUEST", "Player settings are invalid.", zodIssues(result.error.issues));
    }
    const now = Date.now();
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const seatId = crypto.randomUUID();
    const name = cleanPlayerText(result.data.name);
    // Re-read all mutable lobby state after the final await. No asynchronous work occurs
    // between these capacity decisions and the transaction, so concurrent joins serialize.
    const room = this.requireRoom();
    const mode = publicRoomMode(room.mode);
    if (room.phase !== "lobby") {
      throw new ApiError(409, "MATCH_STARTED", "This match has already started.");
    }
    const seats = this.seatRows();
    let team: TeamId;
    if (mode === "practice") {
      if (seats.length >= 2) {
        throw new ApiError(409, "PRACTICE_FULL", "This Sketch Duet already has two players.");
      }
      const partner = seats[0];
      if (partner === undefined || partner.controller === result.data.controller) {
        throw new ApiError(409, "PRACTICE_PARTNER_REQUIRED", "Sketch Duet needs one human and one agent.");
      }
      if (result.data.team !== undefined && result.data.team !== "cobalt") {
        throw new ApiError(409, "PRACTICE_TEAM", "Sketch Duet uses one shared side.");
      }
      team = "cobalt";
    } else {
      if (seats.length >= FREE_FOR_ALL_MAX_PLAYERS) {
        throw new ApiError(409, "ROOM_FULL", "This room already has eight players.");
      }
      if (mode === "free-for-all") {
        team = "cobalt";
      } else {
        team = result.data.team ?? balancedTeam(seats);
        if (seats.filter((seat) => seat.team === team).length >= 4) {
          throw new ApiError(409, "TEAM_FULL", `Team ${team} already has four players.`);
        }
      }
    }
    const position = seats.length;
    const ready = mode === "practice" || result.data.controller === "agent";

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO seats(
          id, token_hash, name, team, controller, is_host, is_ready,
          is_connected, position, joined_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`,
        seatId,
        tokenHash,
        name,
        team,
        result.data.controller,
        ready ? 1 : 0,
        position,
        now,
      );
      this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
      if (mode === "free-for-all") {
        this.ctx.storage.sql.exec("UPDATE room SET total_rounds = ? WHERE id = 1", seats.length + 1);
      }
      this.insertActivitySync({
        roundIndex: -1,
        kind: "system",
        label: "player_joined",
        detail: mode === "free-for-all" ? `${name} joined the free-for-all.` : `${name} joined ${team}.`,
        seatId,
        origin: result.data.controller === "agent" ? "webmcp" : "human-ui",
        canvasVersion: room.canvas_version,
        now,
      });
    });
    await this.broadcastSnapshot();

    const response: JoinRoomResponse = {
      roomCode: room.room_code,
      seatId,
      token,
      snapshot: this.publicSnapshot(),
    };
    console.log(JSON.stringify({ event: "player_joined", roomCode: room.room_code, seatId, team }));
    return jsonResponse(response, { status: 201 });
  }

  private async getState(request: Request): Promise<Response> {
    await this.expireAndBroadcast(Date.now());
    await this.authorizeRequest(request);
    return jsonResponse(this.publicSnapshot());
  }

  private async getPrompt(request: Request): Promise<Response> {
    await this.expireAndBroadcast(Date.now());
    const seat = await this.authorizeRequest(request);
    const room = this.requireRoom();
    if (
      (room.phase !== "round-prep" && room.phase !== "drawing")
      || room.artist_seat_id !== seat.id
    ) {
      throw new ApiError(403, "NOT_ARTIST", "Only the active artist may see this prompt.");
    }
    const round = this.requireRound(room.round_index);
    const response: PrivatePrompt = {
      prompt: round.prompt,
      category: round.category,
      roundIndex: round.round_index,
    };
    return jsonResponse(response);
  }

  private async getReplay(request: Request): Promise<Response> {
    await this.expireAndBroadcast(Date.now());
    await this.authorizeRequest(request);
    const room = this.requireRoom();
    const completedRounds = this.rows<RoundRow>(
      "SELECT * FROM rounds WHERE ended_at IS NOT NULL ORDER BY round_index",
    ).map((round) => ({
      roundIndex: round.round_index,
      prompt: round.prompt,
      category: round.category,
      artistSeatId: round.artist_seat_id,
      team: round.team,
      startedAt: round.started_at,
      endedAt: round.ended_at,
      guessedBySeatId: round.guessed_by_seat_id,
      pointsAwarded: round.points_awarded,
      ...(publicRoomMode(room.mode) === "free-for-all"
        ? {
            artistPointsAwarded: round.points_awarded,
            guesserPointsAwarded: round.points_awarded,
          }
        : {}),
    }));
    const highestCompletedRound = completedRounds.at(-1)?.roundIndex ?? -1;
    const canvas = this.rows<CanvasRow>(
      "SELECT * FROM canvas_events WHERE round_index <= ? ORDER BY canvas_version",
      highestCompletedRound,
    ).map((event) => ({ ...canvasEventFromRow(event), reverted: event.reverted === 1 }));
    const guesses = this.rows<GuessRow>(
      "SELECT * FROM guesses WHERE round_index <= ? ORDER BY created_at",
      highestCompletedRound,
    ).map(guessEventFromRow);
    return jsonResponse({
      roomCode: room.room_code,
      mode: publicRoomMode(room.mode),
      revision: room.revision,
      rounds: completedRounds,
      canvas,
      guesses,
      analytics: this.analytics(),
      ...(publicRoomMode(room.mode) === "free-for-all"
        ? { leaderboard: this.individualLeaderboard() }
        : {}),
    });
  }

  private async executeCommand(request: Request): Promise<Response> {
    const raw = await readJsonBody(request);
    const parsed = CommandEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(400, "INVALID_COMMAND", "Command payload is invalid.", zodIssues(parsed.error.issues));
    }
    const seat = await this.authorizeToken(parsed.data.token);
    const now = Date.now();
    await this.expireAndBroadcast(now);
    const execution = this.runCommandSync(seat, parsed.data.command, now);
    if (execution.alarm === "set") {
      const endsAt = this.requireRoom().ends_at;
      if (endsAt !== null) await this.ctx.storage.setAlarm(endsAt);
    } else if (execution.alarm === "delete") {
      await this.ctx.storage.deleteAlarm();
    }
    await this.broadcastSnapshot();
    return jsonResponse(execution.result);
  }

  private async leaveRoom(request: Request): Promise<Response> {
    const seat = await this.authorizeRequest(request);
    const room = this.requireRoom();
    const mode = publicRoomMode(room.mode);
    this.ctx.storage.transactionSync(() => {
      if (room.phase === "lobby") {
        this.ctx.storage.sql.exec("DELETE FROM rate_limits WHERE seat_id = ?", seat.id);
        this.ctx.storage.sql.exec("DELETE FROM seats WHERE id = ?", seat.id);
        if (seat.is_host === 1) {
          const successor = this.seatRows().sort((left, right) => left.position - right.position)[0];
          if (successor !== undefined) {
            this.ctx.storage.sql.exec("UPDATE seats SET is_host = 1 WHERE id = ?", successor.id);
          }
        }
        if (mode === "free-for-all") {
          const remainingSeats = this.scalar("SELECT COUNT(*) AS value FROM seats");
          this.ctx.storage.sql.exec("UPDATE room SET total_rounds = ? WHERE id = 1", remainingSeats);
        }
      } else {
        this.ctx.storage.sql.exec("UPDATE seats SET is_connected = 0 WHERE id = ?", seat.id);
      }
      this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
    });
    for (const socket of this.ctx.getWebSockets()) {
      if (this.socketAttachment(socket)?.seatId !== seat.id) continue;
      try {
        socket.close(1000, "Player left");
      } catch {
        // The runtime may already own the close handshake.
      }
    }
    await this.broadcastSnapshot();
    return jsonResponse({ accepted: true });
  }

  private runCommandSync(seat: SeatRow, command: RoomCommand, now: number): CommandExecution {
    switch (command.type) {
      case "ready_up":
        return this.readyUpSync(seat, command.ready, command.origin, now);
      case "configure_seat":
        return this.configureSeatSync(seat, command.team, command.controller, now);
      case "configure_match":
        return this.configureMatchSync(seat, command, now);
      case "start_match":
        return this.startMatchSync(seat, command.origin, now);
      case "draw_batch":
        return this.drawBatchSync(seat, command, now);
      case "undo_draw_batch":
        return this.undoBatchSync(seat, command.expectedVersion, command.origin, now);
      case "submit_guess":
        return this.submitGuessSync(seat, command.guess, command.origin, now);
      case "ready_next":
        return this.readyNextSync(seat, command.expectedRoundIndex, command.origin, now);
    }
  }

  private readyUpSync(seat: SeatRow, ready: boolean, origin: ActionOrigin, now: number): CommandExecution {
    const room = this.requireRoom();
    this.requirePhase(room, "lobby");
    this.assertControllerOrigin(seat, origin);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE seats SET is_ready = ? WHERE id = ?", ready ? 1 : 0, seat.id);
      this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
      this.insertActivitySync({
        roundIndex: -1,
        kind: origin === "webmcp" ? "tool-call" : "human-action",
        label: "ready_up",
        detail: ready ? "Ready to draw." : "No longer ready.",
        seatId: seat.id,
        origin,
        canvasVersion: room.canvas_version,
        now,
      });
    });
    return { result: this.commandResult(), alarm: null };
  }

  private configureSeatSync(
    seat: SeatRow,
    team: TeamId,
    controller: ControllerType,
    now: number,
  ): CommandExecution {
    const room = this.requireRoom();
    this.requirePhase(room, "lobby");
    const mode = publicRoomMode(room.mode);
    if (mode === "practice" && team !== "cobalt") {
      throw new ApiError(409, "PRACTICE_TEAM", "Sketch Duet uses one shared side.");
    }
    if (
      mode === "practice"
      && this.seatRows().some(
        (candidate) => candidate.id !== seat.id && candidate.controller === controller,
      )
    ) {
      throw new ApiError(
        409,
        "PRACTICE_PARTNER_REQUIRED",
        "Sketch Duet needs one human and one agent.",
      );
    }
    const configuredTeam: TeamId = mode === "free-for-all" ? "cobalt" : team;
    if (mode === "arena" && team !== seat.team && this.seatRows().filter((candidate) => candidate.team === team).length >= 4) {
      throw new ApiError(409, "TEAM_FULL", `Team ${team} already has four players.`);
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE seats SET team = ?, controller = ?, is_ready = ? WHERE id = ?",
        configuredTeam,
        controller,
        controller === "agent" ? 1 : 0,
        seat.id,
      );
      this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
      this.insertActivitySync({
        roundIndex: -1,
        kind: "role-change",
        label: "seat_configured",
        detail: mode === "free-for-all"
          ? `Seat controller set to ${controller}.`
          : `Seat set to ${configuredTeam} ${controller}.`,
        seatId: seat.id,
        origin: "human-ui",
        canvasVersion: room.canvas_version,
        now,
      });
    });
    return { result: this.commandResult(), alarm: null };
  }

  private configureMatchSync(
    seat: SeatRow,
    command: Extract<RoomCommand, { type: "configure_match" }>,
    now: number,
  ): CommandExecution {
    const room = this.requireRoom();
    this.requirePhase(room, "lobby");
    if (seat.is_host !== 1) {
      throw new ApiError(403, "HOST_ONLY", "Only the host can configure the match.");
    }
    this.assertControllerOrigin(seat, command.origin);
    const mode = publicRoomMode(room.mode);
    const roundOptions: readonly number[] = mode === "practice"
      ? PRACTICE_ROUND_OPTIONS
      : ARENA_ROUND_OPTIONS;
    if (mode !== "free-for-all" && !roundOptions.includes(command.totalRounds)) {
      throw new ApiError(
        400,
        "INVALID_MATCH_SETTINGS",
        `${mode === "practice" ? "Sketch Duet" : "Team Match"} supports ${roundOptions.join(", ")} rounds.`,
      );
    }
    const durationOptions: readonly number[] = ROUND_DURATION_OPTIONS_MS;
    if (!durationOptions.includes(command.roundDurationMs)) {
      throw new ApiError(
        400,
        "INVALID_MATCH_SETTINGS",
        "Round duration must be 90, 120, or 150 seconds.",
      );
    }
    const promptDifficulty = command.promptDifficulty ?? room.prompt_difficulty;
    if (promptDifficulty !== "easy" && promptDifficulty !== "hard") {
      throw new ApiError(400, "INVALID_MATCH_SETTINGS", "Prompt difficulty must be easy or hard.");
    }

    this.ctx.storage.transactionSync(() => {
      const totalRounds = mode === "free-for-all" ? this.seatRows().length : command.totalRounds;
      this.ctx.storage.sql.exec(
        `UPDATE room SET
           total_rounds = ?, round_duration_ms = ?, prompt_difficulty = ?, revision = revision + 1
         WHERE id = 1`,
        totalRounds,
        command.roundDurationMs,
        promptDifficulty,
      );
      if (mode !== "practice") {
        this.ctx.storage.sql.exec(
          "UPDATE seats SET is_ready = CASE WHEN controller = 'agent' THEN 1 ELSE 0 END",
        );
      }
      this.insertActivitySync({
        roundIndex: -1,
        kind: command.origin === "webmcp" ? "tool-call" : "human-action",
        label: "match_configured",
        detail: mode === "free-for-all"
          ? `${totalRounds} player turns at ${command.roundDurationMs / 1_000} seconds each with ${promptDifficulty} prompts.`
          : `${totalRounds} rounds at ${command.roundDurationMs / 1_000} seconds each with ${promptDifficulty} prompts.`,
        seatId: seat.id,
        origin: command.origin,
        canvasVersion: room.canvas_version,
        now,
      });
    });
    return { result: this.commandResult(), alarm: null };
  }

  private startMatchSync(seat: SeatRow, origin: ActionOrigin, now: number): CommandExecution {
    const room = this.requireRoom();
    this.requirePhase(room, "lobby");
    if (seat.is_host !== 1) throw new ApiError(403, "HOST_ONLY", "Only the host can start the match.");
    this.assertControllerOrigin(seat, origin);
    const mode = publicRoomMode(room.mode);
    const seats = this.seatRows().filter((candidate) => candidate.is_connected === 1);
    if (mode === "arena") {
      const cobaltCount = seats.filter((candidate) => candidate.team === "cobalt").length;
      const coralCount = seats.filter((candidate) => candidate.team === "coral").length;
      if (cobaltCount < 2 || coralCount < 2) {
        throw new ApiError(409, "TEAMS_INCOMPLETE", "Team Match needs at least two players on each team.");
      }
      if (seats.some((candidate) => candidate.is_ready !== 1)) {
        throw new ApiError(409, "PLAYERS_NOT_READY", "Every player must ready up first.");
      }
    } else if (mode === "free-for-all") {
      if (seats.length < FREE_FOR_ALL_MIN_PLAYERS || seats.length > FREE_FOR_ALL_MAX_PLAYERS) {
        throw new ApiError(409, "PLAYERS_INCOMPLETE", "Free-for-All needs 3 to 8 connected players.");
      }
      if (seats.some((candidate) => candidate.is_ready !== 1)) {
        throw new ApiError(409, "PLAYERS_NOT_READY", "Every player must ready up first.");
      }
    }
    this.ctx.storage.transactionSync(() => {
      if (mode === "free-for-all") {
        this.ctx.storage.sql.exec(
          "DELETE FROM rate_limits WHERE seat_id IN (SELECT id FROM seats WHERE is_connected = 0)",
        );
        this.ctx.storage.sql.exec("DELETE FROM seats WHERE is_connected = 0");
        this.ctx.storage.sql.exec("UPDATE room SET total_rounds = ? WHERE id = 1", seats.length);
      }
      this.insertActivitySync({
        roundIndex: -1,
        kind: origin === "webmcp" ? "tool-call" : "human-action",
        label: "start_match",
        detail: "The host started the match.",
        seatId: seat.id,
        origin,
        canvasVersion: room.canvas_version,
        now,
      });
      this.beginRoundSync(room, 0, now);
    });
    return { result: this.commandResult(), alarm: "set" };
  }

  private drawBatchSync(
    seat: SeatRow,
    command: Extract<RoomCommand, { type: "draw_batch" }>,
    now: number,
  ): CommandExecution {
    const room = this.requireRoom();
    this.assertDrawingOrigin(room, seat, command.origin);
    if (command.origin === "webmcp" && command.primitives.length !== 1) {
      throw new ApiError(
        400,
        "AGENT_STROKE_ONLY",
        "Agents must send exactly one primitive per draw call so every stroke appears live.",
      );
    }
    const payloadJson = JSON.stringify({
      expectedVersion: command.expectedVersion,
      primitives: command.primitives,
      origin: command.origin,
    });
    const saved = this.rows<SqlRecord & { payload_json: string; result_json: string }>(
      "SELECT payload_json, result_json FROM idempotency WHERE seat_id = ? AND idempotency_key = ?",
      seat.id,
      command.idempotencyKey,
    )[0];
    if (saved !== undefined) {
      if (saved.payload_json !== payloadJson) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "That idempotency key was used for a different batch.");
      }
      const prior = JSON.parse(saved.result_json) as CommandResult;
      return { result: { ...prior, duplicate: true }, alarm: null };
    }
    if (command.expectedVersion !== room.canvas_version) {
      throw new ApiError(409, "STALE_CANVAS", `Canvas is at version ${room.canvas_version}.`);
    }

    const batchId = crypto.randomUUID();
    const finalVersion = room.canvas_version + command.primitives.length;
    const startsRound = room.phase === "round-prep";
    const drawingEndsAt = startsRound ? now + room.round_duration_ms : room.ends_at;
    const result: CommandResult = {
      accepted: true,
      revision: room.revision + 1,
      canvasVersion: finalVersion,
      remainingMs: drawingEndsAt === null ? null : Math.max(0, drawingEndsAt - now),
      batchId,
      duplicate: false,
    };
    this.ctx.storage.transactionSync(() => {
      this.enforceRateLimitSync(
        seat.id,
        "draw_batch",
        now,
        command.origin === "human-ui" ? HUMAN_DRAW_RATE_LIMIT_MS : AGENT_DRAW_RATE_LIMIT_MS,
      );
      command.primitives.forEach((primitive, index) => {
        this.ctx.storage.sql.exec(
          `INSERT INTO canvas_events(
            id, batch_id, canvas_version, round_index, seat_id, origin,
            primitive_json, created_at, reverted
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          crypto.randomUUID(),
          batchId,
          room.canvas_version + index + 1,
          room.round_index,
          seat.id,
          command.origin,
          JSON.stringify(primitive),
          now,
        );
      });
      if (startsRound) {
        this.ctx.storage.sql.exec(
          "UPDATE rounds SET started_at = ?, ends_at = ? WHERE round_index = ?",
          now,
          drawingEndsAt,
          room.round_index,
        );
        this.ctx.storage.sql.exec(
          `UPDATE room SET
             phase = 'drawing', revision = revision + 1, canvas_version = ?, ends_at = ?
           WHERE id = 1`,
          finalVersion,
          drawingEndsAt,
        );
        this.insertActivitySync({
          roundIndex: room.round_index,
          kind: "system",
          label: "round_started",
          detail: "The drawing clock started with the artist's first stroke.",
          seatId: seat.id,
          canvasVersion: finalVersion,
          now,
        });
      } else {
        this.ctx.storage.sql.exec(
          "UPDATE room SET revision = revision + 1, canvas_version = ? WHERE id = 1",
          finalVersion,
        );
      }
      this.insertActivitySync({
        roundIndex: room.round_index,
        kind: command.origin === "webmcp" ? "tool-call" : "human-action",
        label: "draw_batch",
        detail: `${command.primitives.length} constrained vector primitive${command.primitives.length === 1 ? "" : "s"} accepted.`,
        seatId: seat.id,
        origin: command.origin,
        canvasVersion: finalVersion,
        now,
      });
      this.ctx.storage.sql.exec(
        `INSERT INTO idempotency(
          seat_id, idempotency_key, payload_json, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
        seat.id,
        command.idempotencyKey,
        payloadJson,
        JSON.stringify(result),
        now,
      );
    });
    console.log(
      JSON.stringify({
        event: "draw_batch",
        roomCode: room.room_code,
        seatId: seat.id,
        primitiveCount: command.primitives.length,
        origin: command.origin,
        canvasVersion: finalVersion,
      }),
    );
    return { result, alarm: startsRound ? "set" : null };
  }

  private undoBatchSync(
    seat: SeatRow,
    expectedVersion: number,
    origin: ActionOrigin,
    now: number,
  ): CommandExecution {
    const room = this.requireRoom();
    this.assertDrawingOrigin(room, seat, origin);
    if (expectedVersion !== room.canvas_version) {
      throw new ApiError(409, "STALE_CANVAS", `Canvas is at version ${room.canvas_version}.`);
    }
    const last = this.rows<SqlRecord & { batch_id: string }>(
      `SELECT batch_id FROM canvas_events
       WHERE round_index = ? AND seat_id = ? AND reverted = 0
       ORDER BY canvas_version DESC LIMIT 1`,
      room.round_index,
      seat.id,
    )[0];
    if (last === undefined) throw new ApiError(409, "NOTHING_TO_UNDO", "There is no drawing batch to undo.");
    const nextVersion = room.canvas_version + 1;
    this.ctx.storage.transactionSync(() => {
      this.enforceRateLimitSync(
        seat.id,
        "draw_batch",
        now,
        origin === "human-ui" ? HUMAN_DRAW_RATE_LIMIT_MS : AGENT_DRAW_RATE_LIMIT_MS,
      );
      this.ctx.storage.sql.exec(
        "UPDATE canvas_events SET reverted = 1 WHERE round_index = ? AND batch_id = ?",
        room.round_index,
        last.batch_id,
      );
      this.ctx.storage.sql.exec(
        "UPDATE room SET revision = revision + 1, canvas_version = ? WHERE id = 1",
        nextVersion,
      );
      this.insertActivitySync({
        roundIndex: room.round_index,
        kind: origin === "webmcp" ? "tool-call" : "human-action",
        label: "undo_draw_batch",
        detail: "The latest batch was removed.",
        seatId: seat.id,
        origin,
        canvasVersion: nextVersion,
        now,
      });
    });
    return {
      result: {
        accepted: true,
        revision: room.revision + 1,
        canvasVersion: nextVersion,
        remainingMs: remainingMs(room, now),
      },
      alarm: null,
    };
  }

  private submitGuessSync(
    seat: SeatRow,
    rawGuess: string,
    origin: ActionOrigin,
    now: number,
  ): CommandExecution {
    const room = this.requireRoom();
    this.assertGuessingOrigin(room, seat, origin);
    const round = this.requireRound(room.round_index);
    const guess = cleanPlayerText(rawGuess);
    const aliases = parseStringArray(round.aliases_json);
    const correct = isGuessCorrect(guess, round.prompt, aliases);
    const close = !correct && isGuessClose(guess, round.prompt, aliases);
    const guessRemainingMs = Math.max(0, round.ends_at - now);
    const points = correct ? 100 + Math.floor(guessRemainingMs / 1_000) : 0;
    const nextRevision = room.revision + 1;

    this.ctx.storage.transactionSync(() => {
      this.enforceRateLimitSync(seat.id, "submit_guess", now, GUESS_RATE_LIMIT_MS);
      this.ctx.storage.sql.exec(
        `INSERT INTO guesses(
          id, round_index, seat_id, display_name, guess_text, origin, is_correct, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        room.round_index,
        seat.id,
        seat.name,
        guess,
        origin,
        correct ? 1 : 0,
        now,
      );
      this.insertActivitySync({
        roundIndex: room.round_index,
        kind: origin === "webmcp" ? "tool-call" : "human-action",
        label: "submit_guess",
        detail: correct ? "Correct guess!" : `Guess: ${guess}`,
        seatId: seat.id,
        origin,
        canvasVersion: room.canvas_version,
        now,
      });
      if (correct) {
        this.finishRoundSync(room, now, seat.id, points);
      } else {
        this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
      }
    });

    console.log(
      JSON.stringify({
        event: "guess_submitted",
        roomCode: room.room_code,
        seatId: seat.id,
        origin,
        correct,
      }),
    );
    return {
      result: {
        accepted: true,
        revision: nextRevision,
        canvasVersion: room.canvas_version,
        remainingMs: guessRemainingMs,
        correct,
        close,
        pointsAwarded: points,
      },
      alarm: correct ? "set" : null,
    };
  }

  private readyNextSync(seat: SeatRow, expectedRoundIndex: number, origin: ActionOrigin, now: number): CommandExecution {
    const room = this.requireRoom();
    this.assertControllerOrigin(seat, origin);
    if (room.round_index !== expectedRoundIndex) {
      return { result: { ...this.commandResult(), duplicate: true }, alarm: null };
    }
    if (room.phase === "round-prep" || room.phase === "drawing" || room.phase === "match-end") {
      return { result: { ...this.commandResult(), duplicate: true }, alarm: null };
    }
    this.requirePhase(room, "round-end");
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE seats SET is_ready = 1 WHERE id = ?", seat.id);
      this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
      this.insertActivitySync({
        roundIndex: room.round_index,
        kind: origin === "webmcp" ? "tool-call" : "human-action",
        label: "ready_next",
        detail: "Ready for the next page.",
        seatId: seat.id,
        origin,
        canvasVersion: room.canvas_version,
        now,
      });
    });
    const refreshedSeat = this.requireSeat(seat.id);
    const eligibleSeats = this.seatRows().filter(
      (candidate) => candidate.is_connected === 1 || candidate.id === refreshedSeat.id,
    );
    const allReady = eligibleSeats.length > 0
      && eligibleSeats.every((candidate) => candidate.is_ready === 1);
    const endedAt = this.requireRound(room.round_index).ended_at;
    if (!allReady || endedAt === null || now < endedAt + ROUND_RESULT_MIN_MS) {
      return { result: this.commandResult(), alarm: null };
    }

    this.ctx.storage.transactionSync(() => this.advanceAfterResultSync(room, now));
    return {
      result: this.commandResult(),
      alarm: this.requireRoom().phase === "match-end" ? "delete" : "set",
    };
  }

  private beginRoundSync(previous: RoomRow, roundIndex: number, now: number): void {
    const seats = this.seatRows();
    const mode = publicRoomMode(previous.mode);
    const activeTeam: TeamId = mode !== "arena" || roundIndex % 2 === 0 ? "cobalt" : "coral";
    const teamSeats = seats.filter(
      (seat) => mode === "free-for-all"
        || (seat.team === activeTeam && (mode === "practice" || seat.is_connected === 1)),
    );
    if (teamSeats.length === 0) throw new ApiError(409, "NO_ARTIST", "The active team has no artist.");
    const artist =
      mode === "practice"
        ? teamSeats.find((candidate) => candidate.controller === (roundIndex % 2 === 0 ? "agent" : "human"))
        : mode === "free-for-all"
          ? teamSeats.slice().sort((left, right) => left.id.localeCompare(right.id))[roundIndex]
          : teamSeats[Math.floor(roundIndex / 2) % teamSeats.length];
    if (artist === undefined) throw new ApiError(409, "NO_ARTIST", "The active team has no artist.");
    const usedPrompts = this.rows<SqlRecord & { prompt: string }>(
      "SELECT prompt FROM rounds ORDER BY round_index",
    ).map((round) => round.prompt);
    const card = randomPrompt(usedPrompts, mode === "practice", previous.prompt_difficulty);
    const prepEndsAt = now + ROUND_PREP_DURATION_MS;

    this.ctx.storage.sql.exec(
      `INSERT INTO rounds(
        round_index, prompt, category, aliases_json, artist_seat_id, team,
        started_at, ends_at, ended_at, guessed_by_seat_id, points_awarded,
        stroke_count, tool_call_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 0)`,
      roundIndex,
      card.prompt,
      card.category,
      JSON.stringify(card.aliases),
      artist.id,
      activeTeam,
      now,
      prepEndsAt,
    );
    this.ctx.storage.sql.exec(
      `UPDATE room SET
        phase = 'round-prep', revision = revision + 1, round_index = ?, active_team = ?,
        artist_seat_id = ?, ends_at = ?
       WHERE id = 1`,
      roundIndex,
      activeTeam,
      artist.id,
      prepEndsAt,
    );
    this.ctx.storage.sql.exec("UPDATE seats SET is_ready = 0");
    this.insertActivitySync({
      roundIndex,
      kind: "role-change",
      label: "round_prepared",
      detail: "Private prompt delivered; the round starts with the artist's first stroke.",
      seatId: artist.id,
      origin: artist.controller === "agent" ? "webmcp" : "human-ui",
      canvasVersion: previous.canvas_version,
      now,
    });
  }

  private finishRoundSync(
    room: RoomRow,
    now: number,
    guessedBySeatId: string | null,
    points: number,
  ): void {
    const round = this.requireRound(room.round_index);
    const mode = publicRoomMode(room.mode);
    const strokeCount = this.scalar(
      "SELECT COUNT(*) AS value FROM canvas_events WHERE round_index = ? AND reverted = 0",
      room.round_index,
    );
    const toolCallCount = this.scalar(
      "SELECT COUNT(*) AS value FROM activities WHERE round_index = ? AND kind = 'tool-call'",
      room.round_index,
    );
    const result: RoundResult = {
      roundIndex: room.round_index,
      prompt: round.prompt,
      artistSeatId: round.artist_seat_id,
      team: round.team,
      ...(guessedBySeatId === null ? {} : { guessedBySeatId }),
      pointsAwarded: points,
      ...(mode === "free-for-all"
        ? { artistPointsAwarded: points, guesserPointsAwarded: points }
        : {}),
      elapsedMs: Math.min(room.round_duration_ms, Math.max(0, now - round.started_at)),
      strokeCount,
      toolCallCount,
    };
    this.ctx.storage.sql.exec(
      `UPDATE rounds SET
        ended_at = ?, guessed_by_seat_id = ?, points_awarded = ?,
        stroke_count = ?, tool_call_count = ?
       WHERE round_index = ?`,
      now,
      guessedBySeatId,
      points,
      strokeCount,
      toolCallCount,
      room.round_index,
    );
    const resultDeadline = now + ROUND_RESULT_MIN_MS;
    if (mode === "free-for-all") {
      this.ctx.storage.sql.exec(
        `UPDATE room SET
          phase = 'round-end', revision = revision + 1, ends_at = ?, round_result_json = ?
         WHERE id = 1`,
        resultDeadline,
        JSON.stringify(result),
      );
    } else {
      const scoreColumn = round.team === "cobalt" ? "score_cobalt" : "score_coral";
      this.ctx.storage.sql.exec(
        `UPDATE room SET
          phase = 'round-end', revision = revision + 1, ends_at = ?,
          round_result_json = ?, ${scoreColumn} = ${scoreColumn} + ?
         WHERE id = 1`,
        resultDeadline,
        JSON.stringify(result),
        points,
      );
    }
    this.ctx.storage.sql.exec("UPDATE seats SET is_ready = 0");
    this.insertActivitySync({
      roundIndex: room.round_index,
      kind: "system",
      label: guessedBySeatId === null ? "time_expired" : "round_won",
      detail: guessedBySeatId === null ? "Time ran out; the prompt is now revealed." : `${points} points awarded.`,
      seatId: guessedBySeatId ?? undefined,
      canvasVersion: room.canvas_version,
      now,
    });
  }

  private startDrawingClockSync(room: RoomRow, now: number): void {
    const drawingEndsAt = now + room.round_duration_ms;
    this.ctx.storage.sql.exec(
      "UPDATE rounds SET started_at = ?, ends_at = ? WHERE round_index = ?",
      now,
      drawingEndsAt,
      room.round_index,
    );
    this.ctx.storage.sql.exec(
      "UPDATE room SET phase = 'drawing', revision = revision + 1, ends_at = ? WHERE id = 1",
      drawingEndsAt,
    );
    this.insertActivitySync({
      roundIndex: room.round_index,
      kind: "system",
      label: "round_started",
      detail: "The drawing clock started.",
      seatId: room.artist_seat_id ?? undefined,
      canvasVersion: room.canvas_version,
      now,
    });
  }

  private advanceAfterResultSync(room: RoomRow, now: number): void {
    if (room.round_index + 1 >= room.total_rounds) {
      this.ctx.storage.sql.exec(
        "UPDATE room SET phase = 'match-end', revision = revision + 1, ends_at = NULL, artist_seat_id = NULL WHERE id = 1",
      );
      this.insertActivitySync({
        roundIndex: room.round_index,
        kind: "system",
        label: "match_complete",
        detail: "The final page is complete.",
        canvasVersion: room.canvas_version,
        now,
      });
      return;
    }
    this.beginRoundSync(room, room.round_index + 1, now);
  }

  private expireDeadlineSync(now: number): DeadlineTransition | null {
    const room = this.roomOrNull();
    if (room === null || room.ends_at === null || room.ends_at > now) {
      return null;
    }
    if (room.phase === "round-prep") {
      const artist = room.artist_seat_id === null ? null : this.requireSeat(room.artist_seat_id);
      if (room.mode === "practice" && artist?.controller === "human") {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "UPDATE room SET revision = revision + 1, ends_at = NULL WHERE id = 1",
          );
          this.insertActivitySync({
            roundIndex: room.round_index,
            kind: "system",
            label: "human_prompt_held",
            detail: "Sketch Duet waits for the human artist's first stroke.",
            seatId: artist.id,
            canvasVersion: room.canvas_version,
            now,
          });
        });
        return "prep-held";
      }
      this.ctx.storage.transactionSync(() => this.startDrawingClockSync(room, now));
      return "prep-started";
    }
    if (room.phase === "drawing") {
      this.ctx.storage.transactionSync(() => this.finishRoundSync(room, now, null, 0));
      return "round-ended";
    }
    if (room.phase !== "round-end") return null;

    const round = this.requireRound(room.round_index);
    if (round.ended_at === null) return null;
    const minDeadline = round.ended_at + ROUND_RESULT_MIN_MS;
    const hardDeadline = round.ended_at + ROUND_RESULT_MAX_MS;
    const eligibleSeats = this.seatRows().filter((seat) => seat.is_connected === 1);
    const allReady = eligibleSeats.length > 0
      && eligibleSeats.every((seat) => seat.is_ready === 1);
    if (now >= hardDeadline || (now >= minDeadline && allReady)) {
      this.ctx.storage.transactionSync(() => this.advanceAfterResultSync(room, now));
      return "round-advanced";
    }
    if (now >= minDeadline) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE room SET revision = revision + 1, ends_at = ? WHERE id = 1",
          hardDeadline,
        );
      });
      return "result-extended";
    }
    return null;
  }

  private async expireAndBroadcast(now: number): Promise<boolean> {
    const transition = this.expireDeadlineSync(now);
    if (transition === null) return false;
    const room = this.requireRoom();
    if (room.ends_at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(room.ends_at);
    console.log(JSON.stringify({
      event: "deadline_transition",
      transition,
      roomCode: room.room_code,
      roundIndex: room.round_index,
    }));
    await this.broadcastSnapshot();
    return true;
  }

  private assertDrawingOrigin(room: RoomRow, seat: SeatRow, origin: ActionOrigin): void {
    if (room.phase !== "round-prep" && room.phase !== "drawing") {
      throw new ApiError(409, "WRONG_PHASE", "Drawing is only available during round preparation or drawing.");
    }
    if (room.artist_seat_id !== seat.id) {
      throw new ApiError(403, "NOT_ARTIST", "Only the active artist can change the canvas.");
    }
    if (room.mode === "practice") {
      this.assertControllerOrigin(seat, origin);
      return;
    }
    this.assertControllerOrigin(seat, origin);
  }

  private assertGuessingOrigin(room: RoomRow, seat: SeatRow, origin: ActionOrigin): void {
    this.requirePhase(room, "drawing");
    const mode = publicRoomMode(room.mode);
    if (mode === "free-for-all") {
      if (seat.id === room.artist_seat_id) {
        throw new ApiError(403, "NOT_GUESSER", "The active artist cannot guess their own drawing.");
      }
      this.assertControllerOrigin(seat, origin);
      return;
    }
    if (mode === "practice") {
      if (seat.team !== room.active_team || seat.id === room.artist_seat_id) {
        throw new ApiError(403, "NOT_GUESSER", "Only the Sketch Duet partner may guess.");
      }
      this.assertControllerOrigin(seat, origin);
      return;
    }
    if (seat.team !== room.active_team || seat.id === room.artist_seat_id) {
      throw new ApiError(403, "NOT_GUESSER", "Only the artist's teammates may guess.");
    }
    this.assertControllerOrigin(seat, origin);
  }

  private assertControllerOrigin(seat: SeatRow, origin: ActionOrigin): void {
    const expected: ActionOrigin = seat.controller === "agent" ? "webmcp" : "human-ui";
    if (origin !== expected) {
      throw new ApiError(403, "ORIGIN_MISMATCH", `${seat.controller} seats must use ${expected} actions.`);
    }
  }

  private enforceRateLimitSync(seatId: string, action: string, now: number, minimumIntervalMs: number): void {
    const prior = this.rows<SqlRecord & { last_at: number }>(
      "SELECT last_at FROM rate_limits WHERE seat_id = ? AND action = ?",
      seatId,
      action,
    )[0];
    if (prior !== undefined && now - prior.last_at < minimumIntervalMs) {
      throw new ApiError(429, "RATE_LIMITED", "Please wait a moment before trying again.");
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO rate_limits(seat_id, action, last_at) VALUES (?, ?, ?)
       ON CONFLICT(seat_id, action) DO UPDATE SET last_at = excluded.last_at`,
      seatId,
      action,
      now,
    );
  }

  private async acceptWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new ApiError(426, "UPGRADE_REQUIRED", "A WebSocket upgrade is required.");
    }
    await this.expireAndBroadcast(Date.now());
    const seat = await this.authorizeRequest(request);
    const pair = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const [client, server] = pair;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seatId: seat.id } satisfies SocketAttachment);
    let practiceStarted = false;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE seats SET is_connected = 1 WHERE id = ?", seat.id);
      const room = this.requireRoom();
      const seats = this.seatRows();
      const practiceReady = room.mode === "practice"
        && room.phase === "lobby"
        && seats.length === 2
        && seats.every((candidate) => candidate.is_connected === 1)
        && new Set(seats.map((candidate) => candidate.controller)).size === 2;
      if (practiceReady) {
        this.beginRoundSync(room, 0, Date.now());
        practiceStarted = true;
      } else {
        this.ctx.storage.sql.exec("UPDATE room SET revision = revision + 1 WHERE id = 1");
      }
    });
    if (practiceStarted) {
      const endsAt = this.requireRoom().ends_at;
      if (endsAt !== null) await this.ctx.storage.setAlarm(endsAt);
    }
    const snapshotMessage = JSON.stringify({ type: "snapshot", snapshot: this.publicSnapshot() });
    server.send(snapshotMessage);
    await this.broadcastSnapshot(server);
    console.log(JSON.stringify({ event: "socket_opened", seatId: seat.id }));
    const headers = new Headers(SECURITY_HEADERS);
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  private async broadcastSnapshot(except?: WebSocket): Promise<void> {
    const payload = JSON.stringify({ type: "snapshot", snapshot: this.publicSnapshot() });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(payload);
      } catch {
        try {
          socket.close(1011, "Broadcast failed");
        } catch {
          // The runtime already owns this failed socket.
        }
      }
    }
  }

  private publicSnapshot(): RoomSnapshot {
    const room = this.requireRoom();
    const mode = publicRoomMode(room.mode);
    const leaderboard = mode === "free-for-all" ? this.individualLeaderboard() : undefined;
    const scoreBySeatId = new Map(leaderboard?.map((standing) => [standing.seatId, standing.score]) ?? []);
    const connectedSeatIds = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.socketAttachment(socket);
      if (attachment !== null) connectedSeatIds.add(attachment.seatId);
    }
    const seats: Seat[] = this.seatRows().map((seat) => ({
      id: seat.id,
      name: seat.name,
      team: seat.team,
      controller: seat.controller,
      isHost: seat.is_host === 1,
      isReady: seat.is_ready === 1,
      isConnected: connectedSeatIds.has(seat.id),
      score: scoreBySeatId.get(seat.id) ?? 0,
    }));
    const roundIndex = Math.max(0, room.round_index);
    const canvas =
      room.round_index < 0
        ? []
        : this.rows<CanvasRow>(
            `SELECT * FROM canvas_events
             WHERE round_index = ? AND reverted = 0 ORDER BY canvas_version`,
            room.round_index,
          ).map(canvasEventFromRow);
    const guesses =
      room.round_index < 0
        ? []
        : this.rows<GuessRow>(
            "SELECT * FROM guesses WHERE round_index = ? ORDER BY created_at",
            room.round_index,
          ).map(guessEventFromRow);
    const activity = this.rows<ActivityRow>(
      "SELECT * FROM activities ORDER BY created_at DESC LIMIT ?",
      MAX_ACTIVITY,
    )
      .reverse()
      .map(activityEventFromRow);
    return {
      roomCode: room.room_code,
      mode,
      phase: room.phase,
      revision: room.revision,
      roundIndex,
      totalRounds: room.total_rounds,
      roundDurationMs: room.round_duration_ms,
      promptDifficulty: room.prompt_difficulty,
      activeTeam: room.active_team,
      artistSeatId: room.artist_seat_id,
      endsAt: room.ends_at,
      canvasVersion: room.canvas_version,
      scores: { cobalt: room.score_cobalt, coral: room.score_coral },
      ...(leaderboard === undefined ? {} : { leaderboard }),
      seats,
      canvas,
      guesses,
      activity,
      roundResult:
        room.round_result_json === null ? null : (JSON.parse(room.round_result_json) as RoundResult),
      analytics: this.analytics(),
    };
  }

  private analytics(): MatchAnalytics {
    const totalStrokes = this.scalar("SELECT COUNT(*) AS value FROM canvas_events WHERE reverted = 0");
    const totalToolCalls = this.scalar("SELECT COUNT(*) AS value FROM activities WHERE kind = 'tool-call'");
    const correctGuesses = this.scalar("SELECT COUNT(*) AS value FROM guesses WHERE is_correct = 1");
    const averageGuess = this.rows<ValueRow>(
      `SELECT AVG(ended_at - started_at) AS value
       FROM rounds WHERE guessed_by_seat_id IS NOT NULL AND ended_at IS NOT NULL`,
    )[0]?.value;
    const byOriginRows = this.rows<SqlRecord & { origin: ActionOrigin; value: number }>(
      `SELECT origin, COUNT(*) AS value FROM (
        SELECT origin FROM canvas_events WHERE reverted = 0
        UNION ALL SELECT origin FROM guesses
      ) GROUP BY origin`,
    );
    const byOrigin: Record<ActionOrigin, number> = { "human-ui": 0, webmcp: 0 };
    for (const row of byOriginRows) byOrigin[row.origin] = Number(row.value);
    return {
      totalStrokes,
      totalToolCalls,
      correctGuesses,
      averageGuessMs: averageGuess === null || averageGuess === undefined ? null : Math.round(Number(averageGuess)),
      byOrigin,
    };
  }

  private individualLeaderboard(): PlayerStanding[] {
    const stats = new Map<string, {
      seat: SeatRow;
      score: number;
      successfulDrawings: number;
      correctGuesses: number;
      solveTimes: number[];
    }>();
    for (const seat of this.seatRows()) {
      stats.set(seat.id, {
        seat,
        score: 0,
        successfulDrawings: 0,
        correctGuesses: 0,
        solveTimes: [],
      });
    }
    const rounds = this.rows<RoundRow>(
      "SELECT * FROM rounds WHERE ended_at IS NOT NULL ORDER BY round_index",
    );
    for (const round of rounds) {
      if (round.guessed_by_seat_id === null || round.points_awarded <= 0 || round.ended_at === null) continue;
      const artist = stats.get(round.artist_seat_id);
      if (artist !== undefined) {
        artist.score += round.points_awarded;
        artist.successfulDrawings += 1;
      }
      const guesser = stats.get(round.guessed_by_seat_id);
      if (guesser !== undefined) {
        guesser.score += round.points_awarded;
        guesser.correctGuesses += 1;
        guesser.solveTimes.push(Math.max(0, round.ended_at - round.started_at));
      }
    }

    const ordered = [...stats.values()].sort((left, right) =>
      right.score - left.score
      || left.seat.name.localeCompare(right.seat.name)
      || left.seat.id.localeCompare(right.seat.id),
    );
    let previousScore: number | null = null;
    let placement = 0;
    return ordered.map((entry, index) => {
      if (entry.score !== previousScore) placement = index + 1;
      previousScore = entry.score;
      const solveTotal = entry.solveTimes.reduce((total, value) => total + value, 0);
      return {
        seatId: entry.seat.id,
        name: entry.seat.name,
        controller: entry.seat.controller,
        score: entry.score,
        placement,
        successfulDrawings: entry.successfulDrawings,
        correctGuesses: entry.correctGuesses,
        fastestSolveMs: entry.solveTimes.length === 0 ? null : Math.min(...entry.solveTimes),
        averageSolveMs: entry.solveTimes.length === 0 ? null : Math.round(solveTotal / entry.solveTimes.length),
      };
    });
  }

  private insertActivitySync(input: {
    roundIndex: number;
    kind: ActivityEvent["kind"];
    label: string;
    detail: string;
    seatId?: string;
    origin?: ActionOrigin;
    canvasVersion: number;
    now: number;
  }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO activities(
        id, round_index, kind, label, detail, seat_id, origin, canvas_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      input.roundIndex,
      input.kind,
      input.label,
      input.detail,
      input.seatId ?? null,
      input.origin ?? null,
      input.canvasVersion,
      input.now,
    );
  }

  private async authorizeRequest(request: Request): Promise<SeatRow> {
    const token = request.headers.get("X-Seat-Token");
    const result = SeatTokenSchema.safeParse(token);
    if (!result.success) throw new ApiError(401, "INVALID_TOKEN", "A valid seat token is required.");
    return this.authorizeToken(result.data);
  }

  private async authorizeToken(token: string): Promise<SeatRow> {
    const tokenHash = await hashToken(token);
    const seat = this.rows<SeatRow>("SELECT * FROM seats WHERE token_hash = ?", tokenHash)[0];
    if (seat === undefined) throw new ApiError(401, "INVALID_TOKEN", "Seat token was not recognized.");
    return seat;
  }

  private hasLiveSocket(seatId: string, excluded: WebSocket): boolean {
    return this.ctx.getWebSockets().some((socket) => {
      if (socket === excluded) return false;
      return this.socketAttachment(socket)?.seatId === seatId;
    });
  }

  private socketAttachment(socket: WebSocket): SocketAttachment | null {
    const attachment = socket.deserializeAttachment() as Partial<SocketAttachment> | null;
    return attachment !== null && typeof attachment.seatId === "string"
      ? { seatId: attachment.seatId }
      : null;
  }

  private roomOrNull(): RoomRow | null {
    return this.rows<RoomRow>("SELECT * FROM room WHERE id = 1")[0] ?? null;
  }

  private requireRoom(): RoomRow {
    const room = this.roomOrNull();
    if (room === null) throw new ApiError(404, "ROOM_NOT_FOUND", "Room was not found.");
    return room;
  }

  private requireRound(roundIndex: number): RoundRow {
    const round = this.rows<RoundRow>("SELECT * FROM rounds WHERE round_index = ?", roundIndex)[0];
    if (round === undefined) throw new ApiError(409, "ROUND_NOT_FOUND", "Round state is unavailable.");
    return round;
  }

  private requireSeat(seatId: string): SeatRow {
    const seat = this.rows<SeatRow>("SELECT * FROM seats WHERE id = ?", seatId)[0];
    if (seat === undefined) throw new ApiError(401, "INVALID_SEAT", "Seat was not found.");
    return seat;
  }

  private requirePhase(room: RoomRow, phase: MatchPhase): void {
    if (room.phase !== phase) {
      throw new ApiError(409, "WRONG_PHASE", `This action is only available during ${phase}.`);
    }
  }

  private seatRows(): SeatRow[] {
    return this.rows<SeatRow>("SELECT * FROM seats ORDER BY position");
  }

  private commandResult(): CommandResult {
    const room = this.requireRoom();
    return {
      accepted: true,
      revision: room.revision,
      canvasVersion: room.canvas_version,
      remainingMs: remainingMs(room, Date.now()),
    };
  }

  private scalar(query: string, ...bindings: SqlStorageValue[]): number {
    return Number(this.rows<ValueRow>(query, ...bindings)[0]?.value ?? 0);
  }

  private rows<T extends SqlRecord>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }
}

function canvasEventFromRow(row: CanvasRow): CanvasEvent {
  const primitive = PrimitiveSchema.safeParse(JSON.parse(row.primitive_json) as unknown);
  if (!primitive.success) {
    throw new ApiError(500, "CORRUPT_CANVAS_EVENT", "A persisted canvas event failed validation.");
  }
  return {
    id: row.id,
    batchId: row.batch_id,
    canvasVersion: row.canvas_version,
    roundIndex: row.round_index,
    seatId: row.seat_id,
    origin: row.origin,
    createdAt: row.created_at,
    primitive: primitive.data satisfies VectorPrimitive,
  };
}

function guessEventFromRow(row: GuessRow): GuessEvent {
  return {
    id: row.id,
    roundIndex: row.round_index,
    seatId: row.seat_id,
    displayName: row.display_name,
    guess: row.guess_text,
    origin: row.origin,
    isCorrect: row.is_correct === 1,
    createdAt: row.created_at,
  };
}

function activityEventFromRow(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    ...(row.seat_id === null ? {} : { seatId: row.seat_id }),
    ...(row.origin === null ? {} : { origin: row.origin }),
    canvasVersion: row.canvas_version,
    createdAt: row.created_at,
  };
}

function balancedTeam(seats: readonly SeatRow[]): TeamId {
  const cobalt = seats.filter((seat) => seat.team === "cobalt").length;
  const coral = seats.filter((seat) => seat.team === "coral").length;
  return cobalt <= coral ? "cobalt" : "coral";
}

function publicRoomMode(mode: StoredRoomMode): RoomMode {
  return mode === "exhibition" ? "arena" : mode;
}

function remainingMs(room: RoomRow, now: number): number | null {
  return room.ends_at === null ? null : Math.max(0, room.ends_at - now);
}

function cleanPlayerText(value: string): string {
  return value.trim().replace(/[\u0000-\u001F\u007F]/g, "");
}

function parseStringArray(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
