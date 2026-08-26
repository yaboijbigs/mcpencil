import {
  ARENA_ROUND_OPTIONS,
  PRACTICE_ROUND_OPTIONS,
  type ControllerType,
  type RoomMode,
  type RoomSnapshot,
  type TeamId,
} from "../shared/game";

export type ModeTone = "practice" | "arena" | "exhibition";

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

export const MODE_CATALOG = {
  practice: {
    id: "practice",
    name: "Practice Pair",
    tagline: "Learn both sides together.",
    description: "A private role-swap match for you and one browser agent.",
    players: "2 players",
    playerBreakdown: "1 human + 1 browser agent",
    format: "Cooperative role swap",
    goal: "Understand each other’s sketches",
    rounds: PRACTICE_ROUND_OPTIONS,
    roleLoop: ["Agent draws · you guess", "You draw · agent guesses"],
    setup: "Invite one agent; play starts automatically",
    competition: "Cooperative",
    recommended: true,
    recommendation: "Best first game",
    createLabel: "Start Practice Pair",
    tone: "practice",
    lobby: {
      eyebrow: "Practice Pair",
      title: "Bring your agent to the sketchbook.",
      description: "Copy the AI invite, hand it to a WebMCP-capable agent, and the alternating role loop starts automatically.",
    },
  },
  arena: {
    id: "arena",
    name: "Team Arena",
    tagline: "Build two mixed sketch squads.",
    description: "Humans and agents share teams, rotate artists, and race for points.",
    players: "4–8 players",
    playerBreakdown: "2–4 players on each team",
    format: "Two-team competition",
    goal: "Guess your own team’s sketch first",
    rounds: ARENA_ROUND_OPTIONS,
    roleLoop: ["Cobalt draws · Cobalt guesses", "Coral draws · Coral guesses"],
    setup: "Mix human and agent seats freely",
    competition: "Competitive",
    recommended: false,
    createLabel: "Create Team Arena",
    tone: "arena",
    lobby: {
      eyebrow: "Team Arena",
      title: "Assemble your sketch squads.",
      description: "Fill both teams with humans, agents, or a mix. Each active team draws and guesses together.",
    },
  },
  exhibition: {
    id: "exhibition",
    name: "Exhibition",
    tagline: "Put human and agent play on display.",
    description: "Stage a controller-first showcase using the same fair drawing rules.",
    players: "4–8 players",
    playerBreakdown: "2–4 players on each team",
    format: "Showcase team competition",
    goal: "Compare how humans and agents communicate",
    rounds: ARENA_ROUND_OPTIONS,
    roleLoop: ["One team draws + guesses", "The other team takes the next round"],
    setup: "Human vs agent, agent vs agent, or custom",
    competition: "Competitive",
    recommended: false,
    createLabel: "Create Exhibition",
    tone: "exhibition",
    lobby: {
      eyebrow: "Exhibition",
      title: "Stage the human–agent showcase.",
      description: "Set each seat’s controller, confirm the matchup, and let the same canvas rules speak for themselves.",
    },
  },
} as const satisfies Record<RoomMode, ModeDefinition>;

export const GAME_MODES = [
  MODE_CATALOG.practice,
  MODE_CATALOG.arena,
  MODE_CATALOG.exhibition,
] as const;

export function getModeDefinition(mode: RoomMode): ModeDefinition {
  return MODE_CATALOG[mode];
}

type TeamControllerProfile = ControllerType | "mixed" | "open";

export interface ExhibitionMatchup {
  label: "Human vs Agent" | "Agent vs Agent" | "Custom showcase";
  detail: string;
  profiles: Record<TeamId, TeamControllerProfile>;
}

function teamControllerProfile(
  snapshot: RoomSnapshot,
  team: TeamId,
): TeamControllerProfile {
  const controllers = new Set(
    snapshot.seats
      .filter((seat) => seat.isConnected && seat.team === team)
      .map((seat) => seat.controller),
  );
  if (controllers.size === 0) return "open";
  if (controllers.size > 1) return "mixed";
  return controllers.has("agent") ? "agent" : "human";
}

function profileLabel(profile: TeamControllerProfile): string {
  if (profile === "agent") return "Agent team";
  if (profile === "human") return "Human team";
  if (profile === "mixed") return "Mixed team";
  return "Open team";
}

export function getExhibitionMatchup(snapshot: RoomSnapshot): ExhibitionMatchup {
  const profiles = {
    cobalt: teamControllerProfile(snapshot, "cobalt"),
    coral: teamControllerProfile(snapshot, "coral"),
  } satisfies Record<TeamId, TeamControllerProfile>;
  const opposingControllers = new Set([profiles.cobalt, profiles.coral]);
  const label = opposingControllers.has("human") && opposingControllers.has("agent")
    ? "Human vs Agent"
    : profiles.cobalt === "agent" && profiles.coral === "agent"
      ? "Agent vs Agent"
      : "Custom showcase";

  return {
    label,
    detail: `Cobalt: ${profileLabel(profiles.cobalt)} · Coral: ${profileLabel(profiles.coral)}`,
    profiles,
  };
}
