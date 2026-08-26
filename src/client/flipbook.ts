import type { RoomMode, RoomSnapshot } from "../shared/game";
import type { HumanPromptGate } from "./humanPromptGate";
import { getModeDefinition } from "./modes";

export type FlipbookTone = RoomMode | "landing" | "agent";

export interface FlipbookView {
  key: string;
  label: string;
  folio: string;
  tone: FlipbookTone;
}

function folio(page: number): string {
  return String(page).padStart(2, "0");
}

export function describeFlipbookView(
  snapshot: RoomSnapshot | null,
  promptGate: HumanPromptGate,
  agentHandoff: boolean,
): FlipbookView {
  if (snapshot === null) {
    return agentHandoff
      ? { key: "agent-handoff", label: "Agent handoff · WebMCP", folio: "01", tone: "agent" }
      : { key: "landing", label: "Front page · choose a game", folio: "01", tone: "landing" };
  }

  const mode = getModeDefinition(snapshot.mode);
  if (snapshot.phase === "lobby") {
    return {
      key: `${snapshot.roomCode}:lobby`,
      label: `${mode.name} · set up the table`,
      folio: "02",
      tone: snapshot.mode,
    };
  }

  if (snapshot.phase === "match-end") {
    return {
      key: `${snapshot.roomCode}:match-end`,
      label: `${mode.name} · match sketchbook`,
      folio: folio(3 + snapshot.totalRounds * 3),
      tone: snapshot.mode,
    };
  }

  const round = snapshot.roundIndex + 1;
  const roundPage = 3 + snapshot.roundIndex * 3;
  if (promptGate === "required") {
    return {
      key: `${snapshot.roomCode}:private-prompt:${snapshot.roundIndex}`,
      label: `Private prompt · round ${round}`,
      folio: folio(roundPage),
      tone: snapshot.mode,
    };
  }

  if (snapshot.phase === "round-end") {
    return {
      key: `${snapshot.roomCode}:round-result:${snapshot.roundIndex}`,
      label: `Round ${round} · sketch review`,
      folio: folio(roundPage + 2),
      tone: snapshot.mode,
    };
  }

  return {
    key: `${snapshot.roomCode}:round:${snapshot.roundIndex}`,
    label: `${mode.name} · round ${round}`,
    folio: folio(roundPage + 1),
    tone: snapshot.mode,
  };
}
