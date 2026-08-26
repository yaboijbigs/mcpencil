import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ControllerType,
  JoinRoomResponse,
  PrivatePrompt,
  RoomCommand,
  RoomMode,
  RoomSnapshot,
  SeatCredentials,
  TeamId,
} from "../../shared/game";
import {
  ApiError,
  createRoom,
  getPrivatePrompt,
  getReplay,
  getRoomState,
  joinRoom,
  roomSocket,
  sendRoomCommand,
} from "../api";
import type { ReplayPayload } from "../api";

const STORAGE_KEY = "mcpencil.seat.v2";

interface StoredSession {
  primary: SeatCredentials;
  companion?: SeatCredentials;
}

function readStoredCredentials(): StoredSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as StoredSession | null;
    if (!parsed?.primary?.roomCode || !parsed.primary.seatId || !parsed.primary.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCredentials(credentials: StoredSession | null) {
  if (credentials) localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  else localStorage.removeItem(STORAGE_KEY);
}

export interface RoomSession {
  credentials: SeatCredentials | null;
  companion: SeatCredentials | null;
  snapshot: RoomSnapshot | null;
  loading: boolean;
  connected: boolean;
  error: string | null;
  create(input: {
    name: string;
    mode: RoomMode;
    controller: ControllerType;
  }): Promise<void>;
  join(
    roomCode: string,
    input: { name: string; team?: TeamId; controller: ControllerType },
  ): Promise<void>;
  command(command: RoomCommand, signal?: AbortSignal): ReturnType<typeof sendRoomCommand>;
  agentCommand(command: RoomCommand, signal?: AbortSignal): ReturnType<typeof sendRoomCommand>;
  privatePrompt(signal?: AbortSignal): Promise<PrivatePrompt>;
  agentPrivatePrompt(signal?: AbortSignal): Promise<PrivatePrompt>;
  refresh(signal?: AbortSignal): Promise<RoomSnapshot>;
  replay(signal?: AbortSignal): Promise<ReplayPayload>;
  leave(): void;
  dismissError(): void;
}

export function useRoomSession(): RoomSession {
  const stored = useRef(readStoredCredentials());
  const [credentials, setCredentials] = useState<SeatCredentials | null>(() => stored.current?.primary ?? null);
  const [companion, setCompanion] = useState<SeatCredentials | null>(() => stored.current?.companion ?? null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(credentials));
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;

  const adopt = useCallback((response: JoinRoomResponse) => {
    const next = {
      roomCode: response.roomCode,
      seatId: response.seatId,
      token: response.token,
    };
    const nextCompanion = response.companion ?? null;
    saveCredentials({ primary: next, ...(nextCompanion ? { companion: nextCompanion } : {}) });
    setCredentials(next);
    setCompanion(nextCompanion);
    setSnapshot(response.snapshot);
    setError(null);
  }, []);

  const create = useCallback<RoomSession["create"]>(
    async (input) => {
      setLoading(true);
      try {
        const response = await createRoom(input);
        adopt(response);
        if (input.mode === "practice") {
          try {
            await sendRoomCommand(response.roomCode, response.token, { type: "start_match", origin: "human-ui" });
            setSnapshot(await getRoomState(response.roomCode, response.token));
          } catch {
            // Keep the paired lobby usable if automatic start cannot complete.
          }
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not open a room.");
        throw reason;
      } finally {
        setLoading(false);
      }
    },
    [adopt],
  );

  const join = useCallback<RoomSession["join"]>(
    async (roomCode, input) => {
      setLoading(true);
      try {
        adopt(await joinRoom(roomCode.trim().toUpperCase(), input));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not join that room.");
        throw reason;
      } finally {
        setLoading(false);
      }
    },
    [adopt],
  );

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const current = credentialsRef.current;
      if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
      const next = await getRoomState(current.roomCode, current.token, signal);
      setSnapshot(next);
      return next;
    },
    [],
  );

  const command = useCallback(
    async (roomCommand: RoomCommand, signal?: AbortSignal) => {
      const current = credentialsRef.current;
      if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
      try {
        const result = await sendRoomCommand(current.roomCode, current.token, roomCommand, signal);
        await refresh(signal).catch(() => undefined);
        return result;
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "That move was not accepted.");
        }
        throw reason;
      }
    },
    [refresh],
  );

  const privatePrompt = useCallback(async (signal?: AbortSignal) => {
    const current = credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    return getPrivatePrompt(current.roomCode, current.token, signal);
  }, []);

  const agentCommand = useCallback(async (roomCommand: RoomCommand, signal?: AbortSignal) => {
    const current = companion ?? credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    try {
      const result = await sendRoomCommand(current.roomCode, current.token, roomCommand, signal);
      await refresh(signal).catch(() => undefined);
      return result;
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "That agent move was not accepted.");
      }
      throw reason;
    }
  }, [companion, refresh]);

  const agentPrivatePrompt = useCallback(async (signal?: AbortSignal) => {
    const current = companion ?? credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    return getPrivatePrompt(current.roomCode, current.token, signal);
  }, [companion]);

  const replay = useCallback(async (signal?: AbortSignal) => {
    const current = credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    return getReplay(current.roomCode, current.token, signal);
  }, []);

  const leave = useCallback(() => {
    saveCredentials(null);
    setCredentials(null);
    setCompanion(null);
    setSnapshot(null);
    setConnected(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!credentials) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    refresh(controller.signal)
      .catch((reason) => {
        if (reason instanceof ApiError && (reason.status === 401 || reason.status === 404)) leave();
        else if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Room connection failed.");
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [credentials?.roomCode, credentials?.token, leave, refresh]);

  useEffect(() => {
    if (!credentials) return;
    const handleEvent = (event: Parameters<Parameters<typeof roomSocket>[2]>[0]) => {
      if (event.type === "snapshot") {
        setSnapshot((current) => !current || event.snapshot.revision >= current.revision ? event.snapshot : current);
      }
      if (event.type === "presence") {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                seats: current.seats.map((seat) =>
                  seat.id === event.seatId ? { ...seat, isConnected: event.connected } : seat,
                ),
              }
            : current,
        );
      }
      if (event.type === "error") setError(event.message);
    };
    const closePrimary = roomSocket(
      credentials.roomCode,
      credentials.token,
      handleEvent,
      setConnected,
    );
    const closeCompanion = companion
      ? roomSocket(companion.roomCode, companion.token, handleEvent, () => undefined)
      : undefined;
    return () => {
      closePrimary();
      closeCompanion?.();
    };
  }, [companion?.roomCode, companion?.token, credentials?.roomCode, credentials?.token]);

  return {
    credentials,
    companion,
    snapshot,
    loading,
    connected,
    error,
    create,
    join,
    command,
    agentCommand,
    privatePrompt,
    agentPrivatePrompt,
    refresh,
    replay,
    leave,
    dismissError: () => setError(null),
  };
}
