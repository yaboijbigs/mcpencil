import type { CanvasEvent, GuessEvent } from "../shared/game";

type ReplayCanvasEvent = CanvasEvent & { reverted?: boolean };

export interface ReplayRoundSummary {
  vectorMarks: number;
  agentDrawingMoves: number;
  agentDrawingMarks: number;
  agentGuesses: number;
  humanDrawingMoves: number;
  humanDrawingMarks: number;
  humanGuesses: number;
  humanUiActions: number;
  allGuesses: number;
}

/**
 * Summarizes only authoritative canvas and guess events for one round.
 * A drawing move is one accepted batch; it can contain multiple vector marks.
 * Human UI actions intentionally means human drawing moves plus human guesses.
 */
export function summarizeReplayRound(
  events: ReplayCanvasEvent[],
  guesses: GuessEvent[],
  roundIndex: number,
): ReplayRoundSummary {
  const roundEvents = events.filter((event) => event.roundIndex === roundIndex && !event.reverted);
  const roundGuesses = guesses.filter((guess) => guess.roundIndex === roundIndex);
  const agentEvents = roundEvents.filter((event) => event.origin === "webmcp");
  const humanEvents = roundEvents.filter((event) => event.origin === "human-ui");
  const agentGuesses = roundGuesses.filter((guess) => guess.origin === "webmcp").length;
  const humanGuesses = roundGuesses.length - agentGuesses;
  const agentDrawingMoves = distinctBatchCount(agentEvents);
  const humanDrawingMoves = distinctBatchCount(humanEvents);

  return {
    vectorMarks: roundEvents.length,
    agentDrawingMoves,
    agentDrawingMarks: agentEvents.length,
    agentGuesses,
    humanDrawingMoves,
    humanDrawingMarks: humanEvents.length,
    humanGuesses,
    humanUiActions: humanDrawingMoves + humanGuesses,
    allGuesses: roundGuesses.length,
  };
}

function distinctBatchCount(events: ReplayCanvasEvent[]): number {
  return new Set(events.map((event) => event.batchId)).size;
}
