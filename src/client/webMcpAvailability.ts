import { DEFAULT_PROMPT_DIFFICULTY, canGuess, isArtist, type RoomSnapshot, type VectorPrimitive } from "../shared/game";
import { buildCanvasPerception } from "./canvasPerception";

export const WEBMCP_REGISTERED_TOOL_NAMES = [
  "get_match_state",
  "start_practice",
  "play_mcpencil",
  "configure_match",
  "start_match",
  "draw_stroke",
  "undo_last_stroke",
  "submit_guesses",
  "get_round_result",
  "ready_next",
] as const;

export function webMcpToolNames(
  snapshot: RoomSnapshot | null,
  seatId: string | null,
  guessesEnabled = true,
  roomInviteCode: string | null = null,
): string[] {
  const names = ["get_match_state"];
  if (snapshot === null) {
    return roomInviteCode
      ? [...names, "play_mcpencil"]
      : [...names, "start_practice", "play_mcpencil"];
  }

  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  const hasAgentSeat = seat?.controller === "agent";
  if (snapshot.phase === "lobby" && !hasAgentSeat) {
    names.push("play_mcpencil");
  }
  if (snapshot.phase === "lobby" && hasAgentSeat && seat.isHost) {
    names.push("configure_match");
    if (snapshot.mode !== "practice") names.push("start_match");
  }
  if (hasAgentSeat && isArtist(snapshot, seatId)) {
    names.push("draw_stroke", "undo_last_stroke");
  }
  if (hasAgentSeat && guessesEnabled && canGuess(snapshot, seatId)) {
    names.push("submit_guesses");
  }
  if (snapshot.roundResult !== null) {
    names.push("get_round_result");
  }
  if (snapshot.phase === "round-end" && hasAgentSeat && !seat.isReady) names.push("ready_next");
  return names;
}

const PLAY_INTENT = "play_mcpencil_with_user";
const COMPLETION_CONDITION = "Use MCPencil's page-exposed WebMCP tools for every game action and continue until phase is match-end. Loading the page, joining, or waiting is not completion.";
const MAX_COMPACT_GEOMETRY_EVENTS = 24;
const MAX_COMPACT_POINTS = 6;

export function compactWebMcpState(
  snapshot: RoomSnapshot | null,
  seatId: string | null,
  roomInviteCode: string | null = null,
) {
  if (!snapshot) {
    const hasInvite = roomInviteCode !== null;
    return {
      intent: PLAY_INTENT,
      roomCode: roomInviteCode,
      phase: "landing",
      mustContinue: true,
      completionCondition: COMPLETION_CONDITION,
      availableActions: hasInvite ? ["play_mcpencil"] : ["start_practice", "play_mcpencil"],
      interactionProtocol: "page-exposed WebMCP tools; browser navigation and visual viewing are not game actions",
      nextAction: {
        tool: "play_mcpencil",
        ...(hasInvite ? { arguments: {} } : {}),
        instruction: hasInvite
          ? "Call the page-exposed play_mcpencil WebMCP tool now with {} to join and ready as the user's AI player."
          : "Open an MCPencil room in a WebMCP-capable agent browser, then use play_mcpencil to join and play.",
      },
      urgency: "immediate",
      deadline: null,
    };
  }
  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  const role = isArtist(snapshot, seatId) ? "artist" : canGuess(snapshot, seatId) ? "guesser" : "spectator";
  const action = compactNextAction(snapshot, seatId);
  const competitive = snapshot.mode !== "practice";
  const scoring = snapshot.mode === "practice"
    ? "cooperative"
    : snapshot.mode === "free-for-all"
      ? "individual"
      : "team";
  const completedRounds = snapshot.phase === "lobby"
    ? 0
    : snapshot.phase === "match-end" || snapshot.phase === "round-end"
      ? snapshot.roundIndex + 1
      : snapshot.roundIndex;
  const seats = snapshot.seats.map(({ id, name, team, controller, isReady, isConnected, score }) => ({
    id,
    name,
    ...(scoring === "team" ? { team } : {}),
    ...(scoring === "individual" ? { score } : {}),
    controller,
    isReady,
    isConnected,
  }));
  const leaderboard = snapshot.mode === "free-for-all"
    ? snapshot.leaderboard ?? compactFallbackLeaderboard(snapshot)
    : null;
  const outcome = snapshot.phase !== "match-end"
    ? null
    : scoring === "team"
      ? {
          kind: "team_result" as const,
          competitive: true,
          winner: snapshot.scores.cobalt === snapshot.scores.coral
            ? "tie"
            : snapshot.scores.cobalt > snapshot.scores.coral ? "cobalt" : "coral",
          scores: snapshot.scores,
        }
      : scoring === "individual"
        ? {
            kind: "individual_result" as const,
            competitive: true,
            winners: leaderboard?.filter((standing) => standing.placement === 1)
              .map(({ seatId: winnerSeatId, name, score }) => ({ seatId: winnerSeatId, name, score })) ?? [],
            leaderboard,
            instruction: "Free-for-All is complete. Report the individual winner or tied winners and final leaderboard; do not report a team score.",
          }
        : {
          kind: "practice_complete" as const,
          competitive: false,
          winner: null,
          roundsPlayed: snapshot.totalRounds,
          solvedRounds: snapshot.analytics.correctGuesses,
          instruction: "Sketch Duet is collaborative. Report the completed rounds and prompts; do not declare a team winner or final team score.",
        };
  const baseState = {
    intent: PLAY_INTENT,
    mustContinue: snapshot.phase !== "match-end",
    completionCondition: COMPLETION_CONDITION,
    competitive,
    scoring,
    roomCode: snapshot.roomCode, mode: snapshot.mode, phase: snapshot.phase, round: snapshot.roundIndex + 1,
    totalRounds: snapshot.totalRounds, revision: snapshot.revision, yourSeatId: seatId,
    yourRole: role,
    matchSettings: {
      totalRounds: snapshot.totalRounds,
      roundDurationMs: snapshot.roundDurationMs,
      promptDifficulty: snapshot.promptDifficulty ?? DEFAULT_PROMPT_DIFFICULTY,
    },
    promptStyle: snapshot.promptDifficulty === "hard"
      ? "An action phrase. Draw or guess the action, not just an object."
      : "A single-word noun.",
    ...(scoring === "team"
      ? { yourTeam: seat?.team, activeTeam: snapshot.activeTeam, scores: snapshot.scores }
      : scoring === "individual"
        ? { yourScore: seat?.score ?? 0, leaderboard }
        : {
          practiceProgress: {
            completedRounds,
            solvedRounds: snapshot.analytics.correctGuesses,
          },
        }),
    outcome,
    artist: snapshot.seats.find((candidate) => candidate.id === snapshot.artistSeatId)?.name ?? null,
    remainingMs: snapshot.endsAt ? Math.max(0, snapshot.endsAt - Date.now()) : null,
    canvasVersion: snapshot.canvasVersion, strokeCount: snapshot.canvas.length,
    nextAction: action.nextAction, urgency: action.urgency, deadline: snapshot.endsAt,
    seats,
  };
  if (seat?.controller !== "agent" || role !== "guesser") return baseState;
  const roundCanvas = snapshot.canvas.filter((event) => event.roundIndex === snapshot.roundIndex);
  const boundedCanvas = roundCanvas.length <= MAX_COMPACT_GEOMETRY_EVENTS
    ? roundCanvas
    : [...roundCanvas.slice(0, 8), ...roundCanvas.slice(-16)];
  const canvasGeometry = boundedCanvas.map((event) => compactPrimitive(event.primitive));
  const canvasPerception = roundCanvas.length > 0
    ? buildCanvasPerception(roundCanvas, snapshot.roundIndex)
    : null;
  const recentGuesses = snapshot.guesses
    .filter((guess) => guess.roundIndex === snapshot.roundIndex)
    .slice(-8)
    .map(({ guess, isCorrect }) => ({ text: guess, correct: isCorrect }));
  return {
    ...baseState,
    canvasPerception,
    canvasGeometryInfo: {
      includedStrokes: boundedCanvas.length,
      totalStrokes: roundCanvas.length,
      strategy: roundCanvas.length > boundedCanvas.length ? "first-8-and-latest-16" : "all",
    },
    canvasGeometry,
    recentGuesses,
    guidance: canvasGeometry.length > 0
      ? "Treat the rendered page/canvas visual as the primary picture. Observe a snapshot and immediately submit 1-3 ordered, distinct, visually supported candidates while the human keeps drawing. New strokes or a newer canvasVersion do not invalidate the observed snapshot: finish the current guess attempt without rechecking or waiting for the canvas to stop changing. Incorporate new strokes in the next observation cycle; do not take a screenshot after every stroke. After a short retry timeout, use the picture or close feedback for visually supported refinements; if none are plausible, briefly wait again. Discard the old picture when the round or artist changes, and stop guessing when the phase or role no longer permits it. canvasPerception is a fast 32x22 top-to-bottom text raster for clients without page vision; use canvasGeometry only as a final cross-check. Never repeat recentGuesses."
      : "Wait for the first meaningful drawing. Then visually inspect the rendered page/canvas as the primary picture and submit candidates immediately. If page vision is unavailable, use canvasPerception before raw canvasGeometry; do not take a screenshot after every stroke.",
  };
}

function compactNextAction(snapshot: RoomSnapshot, seatId: string | null) {
  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  if (snapshot.phase === "match-end") {
    return {
      nextAction: {
        tool: null,
        arguments: {},
        instruction: snapshot.mode === "practice"
          ? "Sketch Duet is complete. Report the collaborative rounds and prompts; do not name a winning team or final team score."
          : snapshot.mode === "free-for-all"
            ? "Free-for-All is complete. Report the individual winner or tied winners and final leaderboard; do not report a team score."
            : "The Team Match has ended. Report the winning team and final score to the user.",
      },
      urgency: "complete",
    };
  }
  if (snapshot.phase === "lobby" && !seat) {
    return {
      nextAction: {
        tool: "play_mcpencil",
        arguments: {},
        instruction: "Call the page-exposed play_mcpencil WebMCP tool now with {} to join and ready as the user's AI player.",
      },
      urgency: "immediate",
    };
  }
  if (seat?.controller !== "agent") {
    return {
      nextAction: {
        tool: "get_match_state",
        arguments: { afterRevision: snapshot.revision, waitMs: 25_000 },
        instruction: "Wait for the next authoritative room update.",
      },
      urgency: "wait",
    };
  }
  if (snapshot.phase === "lobby") {
    if (snapshot.mode === "practice") {
      return {
        nextAction: {
          tool: "get_match_state",
          arguments: { afterRevision: snapshot.revision, waitMs: 25_000 },
          instruction: "Sketch Duet starts automatically after both seats join.",
        },
        urgency: "wait",
      };
    }
    if (seat.isHost) {
      return {
        nextAction: {
          tool: "start_match",
          arguments: {},
          instruction: snapshot.mode === "free-for-all"
            ? "Start as soon as 3 to 8 players are connected and ready. The server makes one round per starting player."
            : "Start as soon as both teams have two ready players.",
        },
        urgency: "when-ready",
      };
    }
  }
  if (isArtist(snapshot, seatId)) {
    return {
      nextAction: {
        tool: "draw_stroke",
        instruction: "Send ONE high-information simple silhouette/outline stroke now using X 0-1000 and Y 0-700, with every ellipse/rectangle/arc extent fully visible. Establish a recognizable outline in the first few strokes; add details later. After each successful acknowledgement, follow the returned nextAction immediately: no screenshots, get_match_state, narration, or full-drawing planning between drawing strokes.",
      },
      urgency: "immediate",
    };
  }
  if (canGuess(snapshot, seatId)) {
    return {
      nextAction: {
        tool: "submit_guesses",
        instruction: "Use the observed snapshot and guidance to submit 1-3 ordered, distinct candidates immediately, even if new strokes arrive. Do not restart the current guess attempt when canvasVersion advances; incorporate new strokes in the next observation cycle. Never repeat recentGuesses; if no plausible candidate is supported, briefly wait again.",
      },
      urgency: "immediate",
    };
  }
  if (snapshot.phase === "round-end" && !seat.isReady) {
    return {
      nextAction: { tool: "ready_next", arguments: {}, instruction: "Ready this seat for the next round." },
      urgency: "immediate",
    };
  }
  return {
    nextAction: {
      tool: "get_match_state",
      arguments: { afterRevision: snapshot.revision, waitMs: 25_000 },
      instruction: "Call with afterRevision equal to this revision and waitMs 25000 so the next role change wakes immediately.",
    },
    urgency: "wait",
  };
}

export function compactWebMcpRoundResult(snapshot: RoomSnapshot) {
  const result = snapshot.roundResult;
  if (result === null) return null;
  const guessTranscript = snapshot.guesses
    .filter((event) => event.roundIndex === result.roundIndex)
    .map(({ displayName, guess, origin, isCorrect }) => ({
      player: displayName,
      guess,
      provenance: origin,
      correct: isCorrect,
    }));
  if (snapshot.mode === "arena") return { ...result, guessTranscript };
  if (snapshot.mode === "free-for-all") {
    return {
      round: result.roundIndex + 1,
      prompt: result.prompt,
      outcome: result.guessedBySeatId === undefined ? "timed_out" : "solved",
      artist: snapshot.seats.find((seat) => seat.id === result.artistSeatId)?.name ?? result.artistSeatId,
      guessedBy: result.guessedBySeatId === undefined
        ? null
        : snapshot.seats.find((seat) => seat.id === result.guessedBySeatId)?.name ?? result.guessedBySeatId,
      pointsPerPlayer: result.pointsAwarded,
      artistPointsAwarded: result.artistPointsAwarded ?? result.pointsAwarded,
      guesserPointsAwarded: result.guesserPointsAwarded ?? result.pointsAwarded,
      elapsedMs: result.elapsedMs,
      strokeCount: result.strokeCount,
      toolCallCount: result.toolCallCount,
      guessTranscript,
      competitive: true,
      scoring: "individual",
      instruction: "The artist and first correct guesser earn the listed points independently; do not describe this as a team result.",
    };
  }
  return {
    round: result.roundIndex + 1,
    prompt: result.prompt,
    outcome: result.guessedBySeatId === undefined ? "timed_out" : "solved",
    artist: snapshot.seats.find((seat) => seat.id === result.artistSeatId)?.name ?? result.artistSeatId,
    guessedBy: result.guessedBySeatId === undefined
      ? null
      : snapshot.seats.find((seat) => seat.id === result.guessedBySeatId)?.name ?? result.guessedBySeatId,
    elapsedMs: result.elapsedMs,
    strokeCount: result.strokeCount,
    toolCallCount: result.toolCallCount,
    guessTranscript,
    competitive: false,
    instruction: "This was a collaborative Sketch Duet round; do not describe its team or points as a competitive score.",
  };
}

function compactPrimitive(primitive: VectorPrimitive): VectorPrimitive {
  const style = {
    color: primitive.color,
    width: primitive.width,
    ...(primitive.fill ? { fill: primitive.fill } : {}),
  };
  switch (primitive.type) {
    case "line":
      return { type: "line", x1: whole(primitive.x1), y1: whole(primitive.y1), x2: whole(primitive.x2), y2: whole(primitive.y2), ...style };
    case "polyline":
      return { type: "polyline", points: samplePoints(primitive.points), ...style };
    case "ellipse":
      return { type: "ellipse", cx: whole(primitive.cx), cy: whole(primitive.cy), rx: whole(primitive.rx), ry: whole(primitive.ry), ...style };
    case "rectangle":
      return {
        type: "rectangle", x: whole(primitive.x), y: whole(primitive.y),
        rectWidth: whole(primitive.rectWidth), rectHeight: whole(primitive.rectHeight),
        ...(primitive.radius === undefined ? {} : { radius: whole(primitive.radius) }), ...style,
      };
    case "arc":
      return {
        type: "arc", cx: whole(primitive.cx), cy: whole(primitive.cy), radius: whole(primitive.radius),
        startAngle: whole(primitive.startAngle), endAngle: whole(primitive.endAngle), ...style,
      };
    case "polygon":
      return { type: "polygon", points: samplePoints(primitive.points), ...style };
  }
}

function compactFallbackLeaderboard(snapshot: RoomSnapshot) {
  let previousScore: number | null = null;
  let placement = 0;
  return snapshot.seats
    .slice()
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map((candidate, index) => {
      if (candidate.score !== previousScore) placement = index + 1;
      previousScore = candidate.score;
      return {
        seatId: candidate.id,
        name: candidate.name,
        controller: candidate.controller,
        score: candidate.score,
        placement,
      };
    });
}

function samplePoints(points: Array<{ x: number; y: number }>) {
  if (points.length <= MAX_COMPACT_POINTS) return points.map(({ x, y }) => ({ x: whole(x), y: whole(y) }));
  return Array.from({ length: MAX_COMPACT_POINTS }, (_, index) => {
    const point = points[Math.round(index * (points.length - 1) / (MAX_COMPACT_POINTS - 1))]!;
    return { x: whole(point.x), y: whole(point.y) };
  });
}

function whole(value: number) {
  return Math.round(value);
}
