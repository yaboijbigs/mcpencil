import { canGuess, isArtist, type RoomSnapshot } from "../shared/game";

export function webMcpToolNames(
  snapshot: RoomSnapshot | null,
  seatId: string | null,
  guessesEnabled = true,
): string[] {
  const names = ["get_match_state"];
  if (snapshot === null) return [...names, "start_practice", "join_match"];

  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  const hasAgentSeat = seat?.controller === "agent";
  if (snapshot.phase === "lobby" && snapshot.mode === "practice" && !hasAgentSeat) {
    names.push("join_match");
  }
  if (snapshot.phase === "lobby" && snapshot.mode !== "practice" && hasAgentSeat) {
    if (seat.isHost) names.push("start_match");
  }
  if (hasAgentSeat && isArtist(snapshot, seatId)) {
    names.push("get_draw_prompt", "draw_batch", "undo_draw_batch");
  }
  if (hasAgentSeat && guessesEnabled && canGuess(snapshot, seatId)) {
    names.push("submit_guess");
  }
  if (snapshot.phase === "round-end" || snapshot.phase === "match-end") {
    names.push("get_round_result");
    if (snapshot.phase === "round-end" && hasAgentSeat) names.push("ready_next");
  }
  return names;
}
