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
  leaveRoom,
  roomSocket,
  sendRoomCommand,
} from "../api";
import type { ReplayPayload } from "../api";
import { roomCodeFromUrl } from "../invite";

const STORAGE_KEY = "mcpencil.seat.v4";
const LEGACY_STORAGE_KEY = "mcpencil.seat.v3";

interface StoredSession {
  primary: SeatCredentials;
}

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadStoredCredentials(storage: SessionStorageLike, href: string): StoredSession | null {
  try {
    const current = storage.getItem(STORAGE_KEY);
    const legacy = current === null ? storage.getItem(LEGACY_STORAGE_KEY) : null;
    const parsed = JSON.parse(current ?? legacy ?? "null") as (StoredSession & { companion?: SeatCredentials }) | null;
    if (!parsed?.primary?.roomCode || !parsed.primary.seatId || !parsed.primary.token) return null;
    const linkedRoom = roomCodeFromUrl(new URL(href));
    if (linkedRoom && linkedRoom !== parsed.primary.roomCode) {
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(LEGACY_STORAGE_KEY);
      return null;
    }
    const isolated = { primary: parsed.primary };
    storage.setItem(STORAGE_KEY, JSON.stringify(isolated));
    storage.removeItem(LEGACY_STORAGE_KEY);
    return isolated;
  } catch {
    return null;
  }
}

function saveCredentials(credentials: StoredSession | null) {
  if (credentials) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  else sessionStorage.removeItem(STORAGE_KEY);
}

export interface RoomSession {
  credentials: SeatCredentials | null;
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
  ): Promise<JoinRoomResponse>;
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
  const tabIdentity = useRef({ id: crypto.randomUUID(), startedAt: Date.now() });
  const stored = useRef(loadStoredCredentials(sessionStorage, window.location.href));
  const [credentials, setCredentials] = useState<SeatCredentials | null>(() => stored.current?.primary ?? null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(credentials));
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const canvasVersionRef = useRef(0);
  const versionRoomRef = useRef<string | null>(null);
  if (snapshot?.roomCode !== versionRoomRef.current) {
    versionRoomRef.current = snapshot?.roomCode ?? null;
    canvasVersionRef.current = snapshot?.canvasVersion ?? 0;
  } else {
    canvasVersionRef.current = Math.max(canvasVersionRef.current, snapshot?.canvasVersion ?? 0);
  }

  const adopt = useCallback((response: JoinRoomResponse) => {
    const next = {
      roomCode: response.roomCode,
      seatId: response.seatId,
      token: response.token,
    };
    saveCredentials({ primary: next });
    credentialsRef.current = next;
    setCredentials(next);
    setSnapshot(response.snapshot);
    setError(null);
  }, []);

  const create = useCallback<RoomSession["create"]>(
    async (input) => {
      setLoading(true);
      try {
        const response = await createRoom(input);
        adopt(response);
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
        const response = await joinRoom(roomCode.trim().toUpperCase(), input);
        adopt(response);
        return response;
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
      const active = credentialsRef.current;
      if (!active || active.roomCode !== current.roomCode || active.token !== current.token) return next;
      setSnapshot((currentSnapshot) =>
        !currentSnapshot
        || currentSnapshot.roomCode !== next.roomCode
        || next.revision >= currentSnapshot.revision
          ? next
          : currentSnapshot,
      );
      return next;
    },
    [],
  );

  const command = useCallback(
    async (roomCommand: RoomCommand, signal?: AbortSignal) => {
      const current = credentialsRef.current;
      if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
      try {
        const outgoing = withLatestCanvasVersion(roomCommand, canvasVersionRef.current);
        const result = await sendRoomCommand(current.roomCode, current.token, outgoing, signal);
        canvasVersionRef.current = Math.max(canvasVersionRef.current, result.canvasVersion);
        return result;
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "That move was not accepted.");
        }
        throw reason;
      }
    },
    [],
  );

  const privatePrompt = useCallback(async (signal?: AbortSignal) => {
    const current = credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    return getPrivatePrompt(current.roomCode, current.token, signal);
  }, []);

  const agentCommand = useCallback(async (roomCommand: RoomCommand, signal?: AbortSignal) => {
    const current = credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    try {
      const outgoing = withLatestCanvasVersion(roomCommand, canvasVersionRef.current);
      const result = await sendRoomCommand(current.roomCode, current.token, outgoing, signal);
      canvasVersionRef.current = Math.max(canvasVersionRef.current, result.canvasVersion);
      return result;
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "That agent move was not accepted.");
      }
      throw reason;
    }
  }, []);

  const agentPrivatePrompt = useCallback(async (signal?: AbortSignal) => {
    const current = credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    return getPrivatePrompt(current.roomCode, current.token, signal);
  }, []);

  const replay = useCallback(async (signal?: AbortSignal) => {
    const current = credentialsRef.current;
    if (!current) throw new ApiError("Join a room first.", "not_joined", 401);
    return getReplay(current.roomCode, current.token, signal);
  }, []);

  const leave = useCallback(() => {
    const seat = credentialsRef.current;
    if (seat) void leaveRoom(seat.roomCode, seat.token).catch(() => undefined);
    saveCredentials(null);
    setCredentials(null);
    setSnapshot(null);
    setConnected(false);
    setError(null);
  }, []);

  const dropCopiedSession = useCallback(() => {
    saveCredentials(null);
    setCredentials(null);
    setSnapshot(null);
    setConnected(false);
    setError("That seat is already active in another tab. Join this tab as a new player.");
  }, []);

  useEffect(() => {
    if (!credentials || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("mcpencil-seat-claims-v1");
    const identity = tabIdentity.current;
    const seatIds = [credentials.seatId];
    const priority = `${String(identity.startedAt).padStart(16, "0")}:${identity.id}`;
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "object" || event.data === null) return;
      const message = event.data as {
        type?: unknown;
        tabId?: unknown;
        priority?: unknown;
        seatIds?: unknown;
        targetTabId?: unknown;
      };
      if (message.type === "probe"
        && typeof message.tabId === "string"
        && typeof message.priority === "string"
        && Array.isArray(message.seatIds)
        && message.seatIds.some((id) => typeof id === "string" && seatIds.includes(id))) {
        if (priority < message.priority) {
          channel.postMessage({ type: "occupied", targetTabId: message.tabId });
        }
        return;
      }
      if (message.type === "occupied" && message.targetTabId === identity.id) {
        dropCopiedSession();
      }
    });
    channel.postMessage({ type: "probe", tabId: identity.id, priority, seatIds });
    return () => channel.close();
  }, [credentials?.seatId, dropCopiedSession]);

  useEffect(() => {
    if (!credentials) {
      setLoading(false);
      return;
    }
    if (snapshotRef.current?.roomCode === credentials.roomCode) {
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
    return () => {
      closePrimary();
    };
  }, [credentials?.roomCode, credentials?.token]);

  return {
    credentials,
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

function withLatestCanvasVersion(command: RoomCommand, canvasVersion: number): RoomCommand {
  if (command.type !== "draw_batch" && command.type !== "undo_draw_batch") return command;
  return { ...command, expectedVersion: Math.max(command.expectedVersion, canvasVersion) };
}
