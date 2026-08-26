import type { ReactNode } from "react";
import {
  ARENA_ROUND_OPTIONS,
  FREE_FOR_ALL_MAX_PLAYERS,
  FREE_FOR_ALL_MIN_PLAYERS,
  PRACTICE_ROUND_OPTIONS,
  ROUND_DURATION_OPTIONS_MS,
  type ControllerType,
  type RoomCommand,
  type RoomSnapshot,
  type Seat,
  type TeamId,
} from "../../shared/game";
import type { InviteAudience } from "../invite";
import { getMissingSketchDuetController, getModeDefinition } from "../modes";
import {
  ArrowIcon,
  BotIcon,
  CheckIcon,
  PeopleIcon,
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

  if (snapshot.mode === "free-for-all") {
    return (
      <FreeForAllLobby
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
  const missingController = getMissingSketchDuetController(snapshot.seats);
  const inviteAudiences: readonly InviteAudience[] = missingController === null
    ? []
    : missingController === "agent"
      ? ["agent"]
      : ["person"];

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
          audiences={inviteAudiences}
        />
      </section>

      <div className="practice-lobby-grid">
        <section className="practice-duo-card" aria-labelledby="practice-loop-title">
          <header>
            <span className="eyebrow">Your two-way match</span>
            <h2 id="practice-loop-title">Two roles. One shared sketchbook.</h2>
          </header>

          <div className="practice-seat-row">
            {snapshot.seats.map((seat, index) => (
              <span className="practice-seat-slot" key={seat.id}>
                {index > 0 ? <b className="practice-duo-arrow" aria-hidden="true">↔</b> : null}
                <PracticeSeat seat={seat} isSelf={seat.id === self.id} />
              </span>
            ))}
            {snapshot.seats.length < 2 ? (
              <span className="practice-seat-slot">
                {snapshot.seats.length > 0 ? <b className="practice-duo-arrow" aria-hidden="true">↔</b> : null}
                <OpenPracticeSeat controller={missingController ?? "agent"} />
              </span>
            ) : null}
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
            {pairReady
              ? "Pair complete — opening the first round…"
              : missingController === null
                ? "Waiting for your duet partner to reconnect…"
                : `Waiting for a ${missingController === "agent" ? "browser agent to call play_mcpencil" : "human player to join"}…`}
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

function FreeForAllLobby({
  snapshot,
  self,
  busy,
  lens,
  onCommand,
  copiedInvite,
  onCopyInvite,
}: Omit<LobbyExperienceProps, "seatId"> & { self: Seat }) {
  const definition = getModeDefinition("free-for-all");
  const activeSeats = snapshot.seats.filter((seat) => seat.isConnected);
  const allReady = activeSeats.length > 0 && activeSeats.every((seat) => seat.isReady);
  const enoughPlayers = activeSeats.length >= FREE_FOR_ALL_MIN_PLAYERS
    && activeSeats.length <= FREE_FOR_ALL_MAX_PLAYERS;
  const waitingCount = activeSeats.filter((seat) => !seat.isReady).length;
  const playersNeeded = Math.max(0, FREE_FOR_ALL_MIN_PLAYERS - activeSeats.length);
  const openSeats = Math.max(0, FREE_FOR_ALL_MAX_PLAYERS - snapshot.seats.length);
  const startMessage = !enoughPlayers
    ? `Need ${playersNeeded} more player${playersNeeded === 1 ? "" : "s"}`
    : !allReady
      ? `Waiting for ${waitingCount} player${waitingCount === 1 ? "" : "s"} to ready up`
      : `${activeSeats.length} players ready · ${activeSeats.length} rounds`;

  return (
    <main className="lobby-page free-for-all-lobby">
      <section className="lobby-heading mode-lobby-heading">
        <div>
          <span className="eyebrow">{definition.lobby.eyebrow} · Individual</span>
          <h1>{definition.lobby.title}</h1>
          <p>{definition.lobby.description}</p>
        </div>
        <InviteCard
          roomCode={snapshot.roomCode}
          copiedInvite={copiedInvite}
          onCopyInvite={onCopyInvite}
        />
      </section>

      <div className="lobby-content free-for-all-lobby-content">
        <section className="free-for-all-roster" aria-labelledby="free-for-all-roster-title">
          <header>
            <div>
              <span className="eyebrow">The starting lineup</span>
              <h2 id="free-for-all-roster-title">Every player gets the pencil once.</h2>
            </div>
            <strong>{activeSeats.length}/{FREE_FOR_ALL_MAX_PLAYERS}</strong>
          </header>
          <div className="free-for-all-roster-grid">
            {snapshot.seats.map((seat) => (
              <FreeForAllSeatCard key={seat.id} seat={seat} isSelf={seat.id === self.id} />
            ))}
            {Array.from({ length: openSeats }, (_, index) => (
              <div className="empty-seat free-for-all-open-seat" key={index}>
                <span>+</span> Open player spot
              </div>
            ))}
          </div>
          <div className="free-for-all-rules-note">
            <SparkIcon />
            <p><strong>{activeSeats.length || "Player-count"} {activeSeats.length === 1 ? "round" : "rounds"}:</strong> the artist and first correct guesser earn equal points. Highest individual score wins.</p>
          </div>
        </section>

        <aside className="lobby-controls">
          <SeatControls
            self={self}
            busy={busy}
            onCommand={onCommand}
            showTeam={false}
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
            <small>Bring 3–8 connected players. Every human readies up; agent seats are ready automatically.</small>
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

function FreeForAllSeatCard({ seat, isSelf }: { seat: Seat; isSelf: boolean }) {
  return (
    <article className={`free-for-all-seat-card ${seat.isReady ? "is-ready" : ""} ${!seat.isConnected ? "is-away" : ""}`}>
      <span className={`avatar ${seat.controller}`} aria-hidden="true">
        {seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <strong>{seat.name}{isSelf ? " (you)" : ""}</strong>
        <small>{seat.isHost ? "Host · " : ""}{seat.controller === "agent" ? "Browser agent" : "Human player"}</small>
      </div>
      <span className="seat-status">
        {!seat.isConnected ? "Away" : seat.isReady ? <><CheckIcon /><span className="sr-only">Ready</span></> : "Not ready"}
      </span>
    </article>
  );
}

function PracticeSeat({ seat, isSelf }: { seat: Seat; isSelf: boolean }) {
  return (
    <article className={`practice-polaroid is-${seat.controller} ${!seat.isConnected ? "is-away" : ""}`}>
      <span className="tape" aria-hidden="true" />
      <span className="polaroid-photo" aria-hidden="true">
        {seat.controller === "agent" ? <BotIcon /> : <b>{seat.name.slice(0, 1).toUpperCase()}</b>}
      </span>
      <div className="polaroid-caption">
        <strong>{seat.name}{isSelf ? " (you)" : ""}</strong>
        <small>{seat.controller === "agent" ? "Browser agent" : "Human player"}</small>
        <span className="polaroid-status">{seat.isConnected ? <><CheckIcon /> Here</> : "Disconnected"}</span>
      </div>
    </article>
  );
}

function OpenPracticeSeat({ controller }: { controller: ControllerType }) {
  return (
    <article className="practice-polaroid open-practice-seat">
      <span className="tape" aria-hidden="true" />
      <span className="polaroid-photo" aria-hidden="true">
        {controller === "agent" ? <BotIcon /> : <PeopleIcon />}
      </span>
      <div className="polaroid-caption">
        <strong>Open seat</strong>
        <small>{controller === "agent" ? "Browser agent" : "Human player"}</small>
        <span className="polaroid-status is-waiting">Waiting to join…</span>
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

function SeatControls({ self, busy, onCommand, showTeam = true }: {
  self: Seat;
  busy: boolean;
  onCommand(command: RoomCommand): Promise<unknown>;
  showTeam?: boolean;
}) {
  return (
    <section className="control-card" aria-labelledby="seat-controls-title">
      <span className="eyebrow">Your seat</span>
      <h3 id="seat-controls-title">{self.name}</h3>
      {showTeam ? <>
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
      </> : null}
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
  const freeForAll = snapshot.mode === "free-for-all";
  const livePlayerCount = snapshot.seats.filter((seat) => seat.isConnected).length;
  const displayedRoundCount = freeForAll ? livePlayerCount : snapshot.totalRounds;
  const displayedRoundLabel = `${displayedRoundCount} ${displayedRoundCount === 1 ? "round" : "rounds"}`;
  const displayedPlayerLabel = `${livePlayerCount} ${livePlayerCount === 1 ? "player" : "players"}`;
  const humanHost = self.isHost && self.controller === "human";
  const canEdit = humanHost && !busy;
  const status = busy && humanHost
    ? "Saving room settings…"
    : !self.isHost
      ? "Only the host can change these settings."
      : self.controller === "agent"
        ? "The agent host can change settings with configure_match."
        : freeForAll
          ? "Rounds follow the roster — you can set the drawing clock."
          : "You’re the host — changes update for everyone.";

  return (
    <section className={`settings-card ${canEdit ? "is-editable" : "is-locked"}`} aria-labelledby="game-settings-title">
      <header>
        <div><span className="eyebrow">Before you play</span><h3 id="game-settings-title">House rules</h3></div>
        <span className="settings-summary" aria-label={`${displayedRoundLabel}, ${snapshot.roundDurationMs / 1000} seconds each`}>
          {freeForAll ? displayedPlayerLabel : snapshot.totalRounds} × {snapshot.roundDurationMs / 1000}s
        </span>
      </header>
      {!freeForAll ? <fieldset disabled={!canEdit}>
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
      </fieldset> : (
        <div className="automatic-rounds-note">
          <span aria-hidden="true">↻</span>
          <p><strong>{livePlayerCount} {livePlayerCount === 1 ? "round" : "rounds"}</strong><small>One drawing turn per player</small></p>
        </div>
      )}
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
  audiences = ["person", "agent"],
}: {
  roomCode: string;
  copiedInvite: InviteAudience | null;
  onCopyInvite(audience: InviteAudience): void;
  agentFirst?: boolean;
  audiences?: readonly InviteAudience[];
}) {
  const agentButton = audiences.includes("agent") ? (
    <button
      className={`agent-invite-button ${agentFirst ? "is-primary" : ""}`}
      type="button"
      onClick={() => onCopyInvite("agent")}
    >
      {copiedInvite === "agent" ? <CheckIcon /> : <BotIcon />}
      <span>{copiedInvite === "agent" ? "AI prompt copied" : "Invite an AI player"}</span>
    </button>
  ) : null;
  const personButton = audiences.includes("person") ? (
    <button type="button" onClick={() => onCopyInvite("person")}>
      {copiedInvite === "person" ? <CheckIcon /> : <PeopleIcon />}
      <span>{copiedInvite === "person" ? "Person link copied" : "Invite a person"}</span>
    </button>
  ) : null;

  return (
    <section className={`invite-card ${agentFirst ? "agent-first" : ""}`} aria-label={`Invite players to room ${roomCode}`}>
      <small>Share room</small>
      <strong>{roomCode}</strong>
      {audiences.length > 0 ? (
        <div className="invite-actions" aria-live="polite">
          {agentFirst ? <>{agentButton}{personButton}</> : <>{personButton}{agentButton}</>}
        </div>
      ) : <p className="invite-complete"><CheckIcon /> Duet complete</p>}
    </section>
  );
}
