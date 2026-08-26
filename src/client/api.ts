import type {
  CommandResult,
  CanvasEvent,
  ControllerType,
  JoinRoomResponse,
  PrivatePrompt,
  RoomCommand,
  RoomMode,
  RoomSnapshot,
  ServerEvent,
  TeamId,
} from "../shared/game";

export interface ReplayPayload {
  roomCode: string;
  revision: number;
  rounds: Array<{
    roundIndex: number;
    prompt: string;
    category: string;
    artistSeatId: string;
    team: TeamId;
    startedAt: number;
    endedAt: number;
    guessedBySeatId?: string;
    pointsAwarded: number;
  }>;
  canvas: Array<CanvasEvent & { reverted: boolean }>;
  guesses: import("../shared/game").GuessEvent[];
  analytics: import("../shared/game").MatchAnalytics;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "request_failed", status = 500) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: string; code?: string }
    | null;

  if (!response.ok) {
    const failure = body as { error?: string; code?: string } | null;
    throw new ApiError(
      failure?.error ?? `Request failed (${response.status})`,
      failure?.code ?? "request_failed",
      response.status,
    );
  }

  return body as T;
}

export function createRoom(input: {
  name: string;
  mode: RoomMode;
  controller: ControllerType;
}): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>("/api/rooms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function joinRoom(
  roomCode: string,
  input: { name: string; team?: TeamId; controller: ControllerType },
): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function leaveRoom(roomCode: string, token: string): Promise<{ accepted: true }> {
  return request<{ accepted: true }>(`/api/rooms/${encodeURIComponent(roomCode)}/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getRoomState(roomCode: string, token: string, signal?: AbortSignal) {
  return request<RoomSnapshot>(
    `/api/rooms/${encodeURIComponent(roomCode)}/state`,
    { signal, headers: { Authorization: `Bearer ${token}` } },
  );
}

export function sendRoomCommand(
  roomCode: string,
  token: string,
  command: RoomCommand,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return request<CommandResult>(`/api/rooms/${encodeURIComponent(roomCode)}/commands`, {
    method: "POST",
    body: JSON.stringify({ token, command }),
    signal,
  });
}

export function getPrivatePrompt(roomCode: string, token: string, signal?: AbortSignal) {
  return request<PrivatePrompt>(
    `/api/rooms/${encodeURIComponent(roomCode)}/prompt`,
    { signal, headers: { Authorization: `Bearer ${token}` } },
  );
}

export function getReplay(roomCode: string, token: string, signal?: AbortSignal) {
  return request<ReplayPayload>(`/api/rooms/${encodeURIComponent(roomCode)}/replay`, {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function roomSocket(
  roomCode: string,
  token: string,
  onEvent: (event: ServerEvent) => void,
  onConnection: (connected: boolean) => void,
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = new URLSearchParams({ token });
  let cancelled = false;
  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let retries = 0;

  const connect = () => {
    if (cancelled) return;
    socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/${encodeURIComponent(roomCode)}?${query.toString()}`,
    );
    socket.addEventListener("open", () => {
      retries = 0;
      onConnection(true);
    });
    socket.addEventListener("message", (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as ServerEvent);
      } catch {
        // Ignore malformed frames. The next snapshot remains authoritative.
      }
    });
    socket.addEventListener("close", () => {
      onConnection(false);
      if (!cancelled) {
        retries += 1;
        retryTimer = window.setTimeout(connect, Math.min(8_000, 500 * 2 ** retries));
      }
    });
    socket.addEventListener("error", () => socket?.close());
  };

  connect();
  return () => {
    cancelled = true;
    window.clearTimeout(retryTimer);
    socket?.close(1000, "view closed");
  };
}
