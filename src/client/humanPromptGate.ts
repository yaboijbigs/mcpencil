import type { ControllerType, RoomSnapshot } from "../shared/game";

export type HumanPromptGate = "none" | "required" | "hidden";

export function currentHumanPromptKey(
  snapshot: RoomSnapshot | null,
  seatId: string | null,
  controller: ControllerType | null,
): string | null {
  if (
    snapshot === null
    || (snapshot.phase !== "round-prep" && snapshot.phase !== "drawing")
    || snapshot.artistSeatId !== seatId
    || controller !== "human"
  ) {
    return null;
  }
  return `${snapshot.roomCode}:${snapshot.roundIndex}`;
}

export function humanPromptGate(
  activePromptKey: string | null,
  hiddenPromptKey: string | null,
): HumanPromptGate {
  if (activePromptKey === null) return "none";
  return hiddenPromptKey === activePromptKey ? "hidden" : "required";
}
