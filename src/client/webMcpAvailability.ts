import { canGuess, isArtist, type RoomSnapshot, type VectorPrimitive } from "../shared/game";

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

export function compactWebMcpState(snapshot: RoomSnapshot | null, seatId: string | null) {
  if (!snapshot) return {
    phase: "landing",
    availableActions: ["start_practice", "join_match"],
    nextAction: { tool: "join_match", instruction: "Join the room identified by the page URL." },
    urgency: "immediate",
    deadline: null,
  };
  const seat = snapshot.seats.find((candidate) => candidate.id === seatId);
  const role = isArtist(snapshot, seatId) ? "artist" : canGuess(snapshot, seatId) ? "guesser" : "spectator";
  const action = compactNextAction(snapshot, seatId);
  const baseState = {
    roomCode: snapshot.roomCode, mode: snapshot.mode, phase: snapshot.phase, round: snapshot.roundIndex + 1,
    totalRounds: snapshot.totalRounds, revision: snapshot.revision, yourSeatId: seatId,
    yourRole: role,
    yourTeam: seat?.team, activeTeam: snapshot.activeTeam,
    artist: snapshot.seats.find((candidate) => candidate.id === snapshot.artistSeatId)?.name ?? null,
    remainingMs: snapshot.endsAt ? Math.max(0, snapshot.endsAt - Date.now()) : null,
    canvasVersion: snapshot.canvasVersion, strokeCount: snapshot.canvas.length, scores: snapshot.scores,
    nextAction: action.nextAction, urgency: action.urgency, deadline: snapshot.endsAt,
    seats: snapshot.seats.map(({ id, name, team, controller, isReady, isConnected }) => ({ id, name, team, controller, isReady, isConnected })),
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
  if (seat?.controller !== "agent") {
    return {
      nextAction: { tool: "get_match_state", instruction: "Wait for the next authoritative room update." },
      urgency: "wait",
    };
  }
  if (snapshot.phase === "lobby") {
    if (snapshot.mode === "practice") {
      return {
        nextAction: { tool: "get_match_state", instruction: "The host starts Practice Pair automatically after both seats join." },
        urgency: "wait",
      };
    }
    if (seat.isHost) {
      return {
        nextAction: { tool: "start_match", instruction: "Start as soon as both teams have two ready players." },
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
      nextAction: { tool: "ready_next", instruction: "Ready this seat for the next round." },
      urgency: "immediate",
    };
  }
  if (snapshot.phase === "match-end" && snapshot.roundResult !== null) {
    return {
      nextAction: { tool: "get_round_result", instruction: "Read the final round result." },
      urgency: "when-ready",
    };
  }
  return {
    nextAction: {
      tool: "get_match_state",
      instruction: "Call with afterRevision equal to this revision and waitMs 25000 so the next role change wakes immediately.",
    },
    urgency: "wait",
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
