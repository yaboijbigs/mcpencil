import { canGuess, isArtist, type RoomSnapshot, type VectorPrimitive } from "../shared/game";

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
  const completedRounds = snapshot.phase === "lobby"
    ? 0
    : snapshot.phase === "match-end" || snapshot.phase === "round-end"
      ? snapshot.roundIndex + 1
      : snapshot.roundIndex;
  const seats = snapshot.seats.map(({ id, name, team, controller, isReady, isConnected }) => ({
    id,
    name,
    ...(competitive ? { team } : {}),
    controller,
    isReady,
    isConnected,
  }));
  const outcome = snapshot.phase !== "match-end"
    ? null
    : competitive
      ? {
          kind: "team_result" as const,
          competitive: true,
          winner: snapshot.scores.cobalt === snapshot.scores.coral
            ? "tie"
            : snapshot.scores.cobalt > snapshot.scores.coral ? "cobalt" : "coral",
          scores: snapshot.scores,
        }
      : {
          kind: "practice_complete" as const,
          competitive: false,
          winner: null,
          roundsPlayed: snapshot.totalRounds,
          solvedRounds: snapshot.analytics.correctGuesses,
          instruction: "Practice Pair is collaborative. Report the completed rounds and prompts; do not declare a team winner or final team score.",
        };
  const baseState = {
    intent: PLAY_INTENT,
    mustContinue: snapshot.phase !== "match-end",
    completionCondition: COMPLETION_CONDITION,
    competitive,
    roomCode: snapshot.roomCode, mode: snapshot.mode, phase: snapshot.phase, round: snapshot.roundIndex + 1,
    totalRounds: snapshot.totalRounds, revision: snapshot.revision, yourSeatId: seatId,
    yourRole: role,
    matchSettings: { totalRounds: snapshot.totalRounds, roundDurationMs: snapshot.roundDurationMs },
    ...(competitive
      ? { yourTeam: seat?.team, activeTeam: snapshot.activeTeam, scores: snapshot.scores }
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
  const boundedCanvas = roundCanvas.length <= 60
    ? roundCanvas
    : [...roundCanvas.slice(0, 20), ...roundCanvas.slice(-40)];
  const canvasGeometry = boundedCanvas.map((event) => compactPrimitive(event.primitive));
  const recentGuesses = snapshot.guesses
    .filter((guess) => guess.roundIndex === snapshot.roundIndex)
    .slice(-8)
    .map(({ guess, isCorrect }) => ({ text: guess, correct: isCorrect }));
  return {
    ...baseState,
    canvasGeometry,
    recentGuesses,
    guidance: canvasGeometry.length > 0
      ? "Visually inspect the rendered canvas now. Submit 1-3 ordered, distinct candidates immediately. Reconsider the whole drawing on every newer canvasVersion and do not repeat recentGuesses."
      : "Keep get_match_state pending for the first geometry. Visually inspect the rendered canvas and submit candidates immediately when it arrives.",
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
          ? "Practice Pair is complete. Report the collaborative rounds and prompts; do not name a winning team or final team score."
          : "The team match has ended. Report the winning team and final score to the user.",
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
          instruction: "The host starts Practice Pair automatically after both seats join.",
        },
        urgency: "wait",
      };
    }
    if (seat.isHost) {
      return {
        nextAction: { tool: "start_match", arguments: {}, instruction: "Start as soon as both teams have two ready players." },
        urgency: "when-ready",
      };
    }
  }
  if (isArtist(snapshot, seatId)) {
    return {
      nextAction: {
        tool: "draw_stroke",
        instruction: "Do not narrate or plan the full drawing. Send ONE high-information stroke now, then immediately send the next stroke after its acknowledgement.",
      },
      urgency: "immediate",
    };
  }
  if (canGuess(snapshot, seatId)) {
    return {
      nextAction: {
        tool: "submit_guesses",
        instruction: "Visually inspect the rendered canvas and immediately submit 1-3 ordered, distinct candidates; reconsider after every canvasVersion change.",
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
  if (snapshot.mode !== "practice") return result;
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
    competitive: false,
    instruction: "This was a collaborative Practice Pair round; do not describe its team or points as a competitive score.",
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

function samplePoints(points: Array<{ x: number; y: number }>) {
  if (points.length <= 10) return points.map(({ x, y }) => ({ x: whole(x), y: whole(y) }));
  return Array.from({ length: 10 }, (_, index) => {
    const point = points[Math.round(index * (points.length - 1) / 9)]!;
    return { x: whole(point.x), y: whole(point.y) };
  });
}

function whole(value: number) {
  return Math.round(value);
}
