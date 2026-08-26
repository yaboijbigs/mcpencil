import {
  ARENA_ROUND_OPTIONS,
  FREE_FOR_ALL_MAX_PLAYERS,
  FREE_FOR_ALL_MIN_PLAYERS,
  PRACTICE_ROUND_OPTIONS,
  type ControllerType,
  type PlayerStanding,
  type RoomMode,
  type RoomSnapshot,
  type Seat,
} from "../shared/game";

export type ModeTone = "practice" | "arena" | "free-for-all";

export interface ModeDefinition {
  id: RoomMode;
  name: string;
  tagline: string;
  description: string;
  players: string;
  playerBreakdown: string;
  format: string;
  goal: string;
  rounds: readonly number[];
  roundsLabel: string;
  roleLoop: readonly [string, string];
  setup: string;
  competition: "Cooperative" | "Competitive";
  recommended: boolean;
  recommendation?: string;
  createLabel: string;
  tone: ModeTone;
  lobby: {
    eyebrow: string;
    title: string;
    description: string;
  };
}

const FREE_FOR_ALL_PLAYER_COUNTS = Array.from(
  { length: FREE_FOR_ALL_MAX_PLAYERS - FREE_FOR_ALL_MIN_PLAYERS + 1 },
  (_, index) => FREE_FOR_ALL_MIN_PLAYERS + index,
);

export const MODE_CATALOG = {
  practice: {
    id: "practice",
    name: "Sketch Duet",
    tagline: "Draw for each other.",
    description: "A private role-swap match for one human and one browser agent.",
    players: "2 players",
    playerBreakdown: "1 human + 1 browser agent",
    format: "Cooperative role swap",
    goal: "Take turns drawing and guessing",
    rounds: PRACTICE_ROUND_OPTIONS,
    roundsLabel: PRACTICE_ROUND_OPTIONS.join(", "),
    roleLoop: ["Agent draws · you guess", "You draw · agent guesses"],
    setup: "Starts when the human and agent arrive",
    competition: "Cooperative",
    recommended: true,
    recommendation: "Best first game",
    createLabel: "Start Sketch Duet",
    tone: "practice",
    lobby: {
      eyebrow: "Sketch Duet",
      title: "Pass the pencil back and forth.",
      description: "One human and one browser agent alternate drawing and guessing in a private shared sketchbook.",
    },
  },
  arena: {
    id: "arena",
    name: "Team Match",
    tagline: "Two teams race for points.",
    description: "Split into Cobalt and Coral, rotate artists, and guess for your team.",
    players: "4–8 players",
    playerBreakdown: "2–4 players on each team",
    format: "Two-team competition",
    goal: "Help your team solve each sketch",
    rounds: ARENA_ROUND_OPTIONS,
    roundsLabel: ARENA_ROUND_OPTIONS.join(", "),
    roleLoop: ["Cobalt takes a turn", "Coral takes a turn"],
    setup: "Mix human and agent teammates freely",
    competition: "Competitive",
    recommended: false,
    createLabel: "Create Team Match",
    tone: "arena",
    lobby: {
      eyebrow: "Team Match",
      title: "Choose a side and ready your squad.",
      description: "Fill Cobalt and Coral with humans, agents, or a mix. Teammates rotate artists and score together.",
    },
  },
  "free-for-all": {
    id: "free-for-all",
    name: "Free-for-All",
    tagline: "Every sketcher for themselves.",
    description: "Everyone draws once. Everyone else races to guess first.",
    players: "3–8 players",
    playerBreakdown: "Any mix of humans and agents",
    format: "Individual competition",
    goal: "Score by drawing clearly and guessing first",
    rounds: FREE_FOR_ALL_PLAYER_COUNTS,
    roundsLabel: "1 per player",
    roleLoop: ["One player draws", "Everyone else guesses"],
    setup: "Player count sets the round count",
    competition: "Competitive",
    recommended: false,
    createLabel: "Create Free-for-All",
    tone: "free-for-all",
    lobby: {
      eyebrow: "Free-for-All",
      title: "Every pencil for itself.",
      description: "Three to eight humans or agents enter one rotation. Everyone draws once, and the fastest correct guess scores too.",
    },
  },
} as const satisfies Record<RoomMode, ModeDefinition>;

export const GAME_MODES = [
  MODE_CATALOG.practice,
  MODE_CATALOG.arena,
  MODE_CATALOG["free-for-all"],
] as const;

export function getModeDefinition(mode: RoomMode): ModeDefinition {
  return MODE_CATALOG[mode];
}

export function getMissingSketchDuetController(
  seats: readonly Pick<Seat, "controller" | "isConnected">[],
): ControllerType | null {
  const hasHuman = seats.some((seat) => seat.controller === "human");
  const hasAgent = seats.some((seat) => seat.controller === "agent");
  if (hasHuman && hasAgent) return null;
  return hasHuman ? "agent" : "human";
}

export function getFreeForAllStandings(snapshot: RoomSnapshot): PlayerStanding[] {
  const supplied = new Map(
    (snapshot.leaderboard ?? []).map((standing) => [standing.seatId, standing]),
  );
  const rows = snapshot.seats.map((seat, stableIndex) => ({
    stableIndex,
    standing: supplied.get(seat.id) ?? {
      seatId: seat.id,
      name: seat.name,
      controller: seat.controller,
      score: seat.score,
      placement: 0,
      successfulDrawings: 0,
      correctGuesses: 0,
      fastestSolveMs: null,
      averageSolveMs: null,
    },
  }));

  rows.sort((left, right) => (
    right.standing.score - left.standing.score
    || left.stableIndex - right.stableIndex
  ));

  let previousScore: number | null = null;
  let placement = 0;
  return rows.map(({ standing }, index) => {
    if (previousScore === null || standing.score !== previousScore) {
      placement = index + 1;
      previousScore = standing.score;
    }
    return { ...standing, placement };
  });
}
