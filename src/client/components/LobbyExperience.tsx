import type { ReactNode } from "react";
import {
  ARENA_ROUND_OPTIONS,
  PRACTICE_ROUND_OPTIONS,
  ROUND_DURATION_OPTIONS_MS,
  type ControllerType,
  type RoomCommand,
  type RoomSnapshot,
  type Seat,
  type TeamId,
} from "../../shared/game";
import type { InviteAudience } from "../invite";
import {
  getExhibitionMatchup,
  getModeDefinition,
} from "../modes";
import {
  ArrowIcon,
  BotIcon,
  CheckIcon,
  PeopleIcon,
  PencilIcon,
  SparkIcon,
} from "./Icons";

export interface LobbyExperienceProps {
  snapshot: RoomSnapshot;
  seatId: string;
  busy: boolean;
  lens: ReactNode;
  onCommand(command: RoomCommand): Promise<unknown>;
  copiedInvite: InviteAudience | null;
  onCopyInvite(audience: InviteAudience): void;
}

const TEAMS: readonly TeamId[] = ["cobalt", "coral"];

export function LobbyExperience({
  snapshot,
  seatId,
  busy,
  lens,
  onCommand,
  copiedInvite,
  onCopyInvite,
}: LobbyExperienceProps) {
  const self = snapshot.seats.find((seat) => seat.id === seatId);
  if (!self) return null;

  if (snapshot.mode === "practice") {
    return (
      <PracticeLobby
        snapshot={snapshot}
        self={self}
        busy={busy}
        lens={lens}
        onCommand={onCommand}
        copiedInvite={copiedInvite}
        onCopyInvite={onCopyInvite}
      />
    );
  }

  return (
    <TeamLobby
      snapshot={snapshot}
      self={self}
      busy={busy}
      lens={lens}
      onCommand={onCommand}
      copiedInvite={copiedInvite}
      onCopyInvite={onCopyInvite}
    />
  );
}

function PracticeLobby({
  snapshot,
  self,
  busy,
  lens,
  onCommand,
  copiedInvite,
  onCopyInvite,
}: Omit<LobbyExperienceProps, "seatId"> & { self: Seat }) {
  const definition = getModeDefinition("practice");
  const activeSeats = snapshot.seats.filter((seat) => seat.isConnected);
  const hasHuman = activeSeats.some((seat) => seat.controller === "human");
  const hasAgent = activeSeats.some((seat) => seat.controller === "agent");
  const pairReady = hasHuman && hasAgent;
  const drawingsEach = snapshot.totalRounds / 2;
  const missingController: ControllerType = hasHuman ? "agent" : "human";

  return (
    <main className="lobby-page practice-lobby">
      <section className="lobby-heading mode-lobby-heading">
        <div>
          <span className="eyebrow">{definition.lobby.eyebrow} · Cooperative</span>
          <h1>{definition.lobby.title}</h1>
          <p>{definition.lobby.description}</p>
        </div>
        <InviteCard
          roomCode={snapshot.roomCode}
          copiedInvite={copiedInvite}
          onCopyInvite={onCopyInvite}
          agentFirst
        />
      </section>

      <div className="practice-lobby-grid">
        <section className="practice-duo-card" aria-labelledby="practice-loop-title">
          <header>
            <span className="eyebrow">Your two-way match</span>
            <h2 id="practice-loop-title">Two roles. One shared sketchbook.</h2>
          </header>

          <div className="practice-seat-row">
            {snapshot.seats.map((seat) => (
              <PracticeSeat key={seat.id} seat={seat} isSelf={seat.id === self.id} />
            ))}
            {snapshot.seats.length < 2 ? <OpenPracticeSeat controller={missingController} /> : null}
          </div>

          <div className="practice-leg-grid">
            <article className="practice-leg agent-first">
              <span className="practice-leg-number">Round 1</span>
              <div><BotIcon /><ArrowIcon /><PeopleIcon /></div>
              <h3>Agent draws. You guess.</h3>
              <p>The private prompt stays with the agent while its geometry appears on your shared canvas.</p>
            </article>
            <article className="practice-leg human-first">
              <span className="practice-leg-number">Round 2</span>
              <div><PeopleIcon /><ArrowIcon /><BotIcon /></div>
              <h3>You draw. Agent guesses.</h3>
              <p>Your agent reads the live canvas state and submits guesses through its role-safe tools.</p>
            </article>
          </div>

          <div className="practice-explainer">
            <SparkIcon />
            <p><strong>{snapshot.totalRounds} alternating rounds:</strong> each player draws {drawingsEach} {drawingsEach === 1 ? "time" : "times"}, with {snapshot.roundDurationMs / 1000} seconds per drawing.</p>
          </div>
          <p className="waiting-host" role="status">
            <span className="pulse-dot" />
            {pairReady ? "Pair complete — opening the first round…" : `Waiting for a ${missingController === "agent" ? "browser agent to call play_mcpencil" : "human player to join"}…`}
          </p>
        </section>

        <aside className="lobby-controls">
          <GameSettingsCard
            snapshot={snapshot}
            self={self}
            busy={busy}
            onConfigure={(totalRounds, roundDurationMs) => onCommand({
              type: "configure_match",
              totalRounds,
              roundDurationMs,
              origin: "human-ui",
            })}
          />
          {lens}
        </aside>
      </div>
    </main>
  );
}

function TeamLobby({
  snapshot,
  self,
  busy,
  lens,
  onCommand,
  copiedInvite,
  onCopyInvite,
}: Omit<LobbyExperienceProps, "seatId"> & { self: Seat }) {
  const definition = getModeDefinition(snapshot.mode);
  const activeSeats = snapshot.seats.filter((seat) => seat.isConnected);
  const allReady = activeSeats.length > 0 && activeSeats.every((seat) => seat.isReady);
  const enoughPlayers = TEAMS.every(
    (team) => activeSeats.filter((seat) => seat.team === team).length >= 2,
  );
  const waitingCount = activeSeats.filter((seat) => !seat.isReady).length;
  const exhibition = snapshot.mode === "exhibition"
    ? getExhibitionMatchup(snapshot)
    : null;
  const startMessage = !enoughPlayers
    ? "Need 2 live players on each team"
    : !allReady
      ? `Waiting for ${waitingCount} player${waitingCount === 1 ? "" : "s"} to ready up`
      : "Both teams are ready";

  return (
    <main className={`lobby-page team-lobby ${snapshot.mode}-lobby`}>
      <section className="lobby-heading mode-lobby-heading">
        <div>
          <span className="eyebrow">{definition.lobby.eyebrow} · Competitive</span>
          <h1>{definition.lobby.title}</h1>
          <p>{definition.lobby.description}</p>
        </div>
        <InviteCard
          roomCode={snapshot.roomCode}
          copiedInvite={copiedInvite}
          onCopyInvite={onCopyInvite}
        />
      </section>

      {exhibition ? (
        <section className="exhibition-matchup" aria-labelledby="exhibition-matchup-title">
          <div>
            <span className="eyebrow">Current controller matchup</span>
            <h2 id="exhibition-matchup-title">{exhibition.label}</h2>
            <p>{exhibition.detail}</p>
          </div>
          <div className="matchup-stage" aria-hidden="true">
            <ControllerProfileIcon profile={exhibition.profiles.cobalt} />
            <strong>VS</strong>
            <ControllerProfileIcon profile={exhibition.profiles.coral} />
          </div>
        </section>
      ) : null}

      <div className="lobby-content">
        <section className="team-board" aria-label={`${definition.name} teams`}>
          {TEAMS.map((team) => (
            <TeamColumn
              key={team}
              team={team}
              seats={snapshot.seats.filter((seat) => seat.team === team)}
              selfId={self.id}
            />
          ))}
        </section>

        <aside className="lobby-controls">
          <SeatControls
            self={self}
            busy={busy}
            onCommand={onCommand}
          />
          <GameSettingsCard
            snapshot={snapshot}
            self={self}
            busy={busy}
            onConfigure={(totalRounds, roundDurationMs) => onCommand({
              type: "configure_match",
              totalRounds,
              roundDurationMs,
              origin: "human-ui",
            })}
          />
          <section className={`start-readiness ${enoughPlayers && allReady ? "is-ready" : ""}`} aria-live="polite">
            <span className="eyebrow">Start condition</span>
            <p><span className="pulse-dot" />{startMessage}</p>
            <small>Each team needs two connected players, and every human seat must be ready. Agent seats ready automatically.</small>
          </section>
          <StartMatchControl
            self={self}
            busy={busy}
            enoughPlayers={enoughPlayers}
            allReady={allReady}
            startMessage={startMessage}
            onCommand={onCommand}
          />
          {lens}
        </aside>
      </div>
    </main>
  );
}

function PracticeSeat({ seat, isSelf }: { seat: Seat; isSelf: boolean }) {
  return (
    <article className={`practice-player ${!seat.isConnected ? "is-away" : ""}`}>
      <span className={`avatar ${seat.controller}`} aria-hidden="true">
        {seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <small>{seat.controller === "agent" ? "BROWSER AGENT" : "HUMAN PLAYER"}</small>
        <strong>{seat.name}{isSelf ? " (you)" : ""}</strong>
        <span>{seat.isConnected ? <><CheckIcon /> Ready</> : "Disconnected"}</span>
      </div>
    </article>
  );
}

function OpenPracticeSeat({ controller }: { controller: ControllerType }) {
  return (
    <article className="practice-player open-practice-seat">
      <span className={`avatar ${controller}`} aria-hidden="true">
        {controller === "agent" ? <BotIcon /> : <PeopleIcon />}
      </span>
      <div>
        <small>{controller === "agent" ? "BROWSER AGENT" : "HUMAN PLAYER"}</small>
        <strong>Open seat</strong>
        <span>Waiting to join</span>
      </div>
    </article>
  );
}

function TeamColumn({ team, seats, selfId }: {
  team: TeamId;
  seats: Seat[];
  selfId: string;
}) {
  const connectedCount = seats.filter((seat) => seat.isConnected).length;
  const openSeats = Math.max(0, 4 - seats.length);
  return (
    <article className={`team-column team-${team}`}>
      <header>
        <span className="team-pattern" />
        <div><small>TEAM</small><h2>{team === "cobalt" ? "Cobalt" : "Coral"}</h2></div>
        <strong aria-label={`${connectedCount} of 4 seats connected`}>{connectedCount}/4</strong>
      </header>
      <div className="seat-stack">
        {seats.map((seat) => <SeatCard key={seat.id} seat={seat} isSelf={seat.id === selfId} />)}
        {Array.from({ length: openSeats }, (_, index) => (
          <div className="empty-seat" key={index}><span>+</span> Open seat</div>
        ))}
      </div>
    </article>
  );
}

function SeatCard({ seat, isSelf }: { seat: Seat; isSelf: boolean }) {
  return (
    <div className={`seat-card ${seat.isReady ? "is-ready" : ""} ${!seat.isConnected ? "is-away" : ""}`}>
      <span className={`avatar ${seat.controller}`} aria-hidden="true">
        {seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <strong>{seat.name}{isSelf ? " (you)" : ""}</strong>
        <small>{seat.isHost ? "Host · " : ""}{seat.controller === "agent" ? "Browser agent · WebMCP" : "Human player · UI"}</small>
      </div>
      <span className="seat-status">{!seat.isConnected ? "Away" : seat.isReady ? <CheckIcon /> : "Not ready"}</span>
    </div>
  );
}

function SeatControls({ self, busy, onCommand }: {
  self: Seat;
  busy: boolean;
  onCommand(command: RoomCommand): Promise<unknown>;
}) {
  return (
    <section className="control-card" aria-labelledby="seat-controls-title">
      <span className="eyebrow">Your seat</span>
      <h3 id="seat-controls-title">{self.name}</h3>
      <label>Team</label>
      <div className="segmented">
        {TEAMS.map((team) => (
          <button
            type="button"
            key={team}
            className={self.team === team ? `active ${team}` : ""}
            aria-pressed={self.team === team}
            disabled={busy}
            onClick={() => void onCommand({ type: "configure_seat", team, controller: self.controller })}
          >
            {team === "cobalt" ? "Cobalt" : "Coral"}
          </button>
        ))}
      </div>
      <label>Controller</label>
      <div className="segmented">
        <button
          type="button"
          className={self.controller === "human" ? "active" : ""}
          aria-pressed={self.controller === "human"}
          disabled={busy}
          onClick={() => void onCommand({ type: "configure_seat", team: self.team, controller: "human" })}
        ><PeopleIcon /> Human</button>
        <button
          type="button"
          className={self.controller === "agent" ? "active" : ""}
          aria-pressed={self.controller === "agent"}
          disabled={busy}
          onClick={() => void onCommand({ type: "configure_seat", team: self.team, controller: "agent" })}
        ><BotIcon /> Agent</button>
      </div>
      {self.controller === "human" ? (
        <button
          className={`ready-button ${self.isReady ? "is-ready" : ""}`}
          type="button"
          disabled={busy}
          onClick={() => void onCommand({ type: "ready_up", ready: !self.isReady, origin: "human-ui" })}
        >
          {self.isReady ? <><CheckIcon /> Ready!</> : "I’m ready"}
        </button>
      ) : (
        <div className="agent-guess-note">
          <BotIcon /><div><strong>Agent seat is ready.</strong><span>No extra ready-up call required.</span></div>
        </div>
      )}
    </section>
  );
}

function GameSettingsCard({ snapshot, self, busy, onConfigure }: {
  snapshot: RoomSnapshot;
  self: Seat;
  busy: boolean;
  onConfigure(totalRounds: number, roundDurationMs: number): Promise<unknown>;
}) {
  const roundOptions = snapshot.mode === "practice"
    ? PRACTICE_ROUND_OPTIONS
    : ARENA_ROUND_OPTIONS;
  const humanHost = self.isHost && self.controller === "human";
  const canEdit = humanHost && !busy;
  const status = busy && humanHost
    ? "Saving room settings…"
    : !self.isHost
      ? "Only the host can change these settings."
      : self.controller === "agent"
        ? "The agent host can change settings with configure_match."
        : "You’re the host — changes update for everyone.";

  return (
    <section className={`settings-card ${canEdit ? "is-editable" : "is-locked"}`} aria-labelledby="game-settings-title">
      <header>
        <div><span className="eyebrow">Before you play</span><h3 id="game-settings-title">Game settings</h3></div>
        <span className="settings-summary" aria-label={`${snapshot.totalRounds} rounds, ${snapshot.roundDurationMs / 1000} seconds each`}>
          {snapshot.totalRounds} × {snapshot.roundDurationMs / 1000}s
        </span>
      </header>
      <fieldset disabled={!canEdit}>
        <legend>Number of rounds</legend>
        <div className="settings-options" aria-label="Number of rounds">
          {roundOptions.map((rounds) => (
            <button
              type="button"
              key={rounds}
              className={snapshot.totalRounds === rounds ? "is-selected" : ""}
              aria-pressed={snapshot.totalRounds === rounds}
              onClick={() => void onConfigure(rounds, snapshot.roundDurationMs)}
            >{rounds}</button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend>Drawing time</legend>
        <div className="settings-options" aria-label="Drawing time in seconds">
          {ROUND_DURATION_OPTIONS_MS.map((durationMs) => (
            <button
              type="button"
              key={durationMs}
              className={snapshot.roundDurationMs === durationMs ? "is-selected" : ""}
              aria-pressed={snapshot.roundDurationMs === durationMs}
              onClick={() => void onConfigure(snapshot.totalRounds, durationMs)}
            >{durationMs / 1000}s</button>
          ))}
        </div>
      </fieldset>
      <p className="settings-status" role="status">
        <span className={canEdit ? "settings-edit-mark" : "settings-lock-mark"} aria-hidden="true">{canEdit ? "✎" : "•"}</span>
        {status}
      </p>
    </section>
  );
}

function StartMatchControl({
  self,
  busy,
  enoughPlayers,
  allReady,
  startMessage,
  onCommand,
}: {
  self: Seat;
  busy: boolean;
  enoughPlayers: boolean;
  allReady: boolean;
  startMessage: string;
  onCommand(command: RoomCommand): Promise<unknown>;
}) {
  if (!self.isHost) {
    return <p className="waiting-host"><span className="pulse-dot" />Waiting for the host to start…</p>;
  }
  if (self.controller === "agent") {
    return <p className="waiting-host"><span className="pulse-dot" />The agent host can start with <code>start_match</code>.</p>;
  }
  return (
    <button
      className="primary-button jumbo"
      type="button"
      disabled={busy || !allReady || !enoughPlayers}
      onClick={() => void onCommand({ type: "start_match", origin: "human-ui" })}
    >
      {enoughPlayers && allReady ? <>Start match <ArrowIcon /></> : startMessage}
    </button>
  );
}

function InviteCard({
  roomCode,
  copiedInvite,
  onCopyInvite,
  agentFirst = false,
}: {
  roomCode: string;
  copiedInvite: InviteAudience | null;
  onCopyInvite(audience: InviteAudience): void;
  agentFirst?: boolean;
}) {
  const agentButton = (
    <button
      className={`agent-invite-button ${agentFirst ? "is-primary" : ""}`}
      type="button"
      onClick={() => onCopyInvite("agent")}
    >
      {copiedInvite === "agent" ? <CheckIcon /> : <BotIcon />}
      <span>{copiedInvite === "agent" ? "AI prompt copied" : "Invite an AI player"}</span>
    </button>
  );
  const personButton = (
    <button type="button" onClick={() => onCopyInvite("person")}>
      {copiedInvite === "person" ? <CheckIcon /> : <PeopleIcon />}
      <span>{copiedInvite === "person" ? "Person link copied" : "Invite a person"}</span>
    </button>
  );

  return (
    <section className={`invite-card ${agentFirst ? "agent-first" : ""}`} aria-label={`Invite players to room ${roomCode}`}>
      <small>Share room</small>
      <strong>{roomCode}</strong>
      <div className="invite-actions" aria-live="polite">
        {agentFirst ? <>{agentButton}{personButton}</> : <>{personButton}{agentButton}</>}
      </div>
    </section>
  );
}

function ControllerProfileIcon({ profile }: {
  profile: "human" | "agent" | "mixed" | "open";
}) {
  if (profile === "agent") return <span className="matchup-controller agent"><BotIcon /></span>;
  if (profile === "human") return <span className="matchup-controller human"><PeopleIcon /></span>;
  if (profile === "mixed") return <span className="matchup-controller mixed"><PeopleIcon /><BotIcon /></span>;
  return <span className="matchup-controller open"><PencilIcon /></span>;
}
