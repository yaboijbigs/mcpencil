import { useState, type FormEvent, type ReactNode } from "react";
import type {
  ControllerType,
  RoomMode,
  TeamId,
} from "../../shared/game";
import {
  buildRoomInvites,
  isAgentInviteUrl,
  roomCodeFromUrl,
} from "../invite";
import { GAME_MODES, getModeDefinition } from "../modes";
import {
  ArrowIcon,
  BotIcon,
  CheckIcon,
  PeopleIcon,
  PencilIcon,
  SparkIcon,
} from "./Icons";

export interface LandingExperienceProps {
  busy: boolean;
  onCreate(input: {
    name: string;
    mode: RoomMode;
    controller: ControllerType;
  }): Promise<void>;
  onJoin(code: string, input: {
    name: string;
    team?: TeamId;
    controller: ControllerType;
  }): Promise<void>;
  lens: ReactNode;
}

export function LandingExperience({
  busy,
  onCreate,
  onJoin,
  lens,
}: LandingExperienceProps) {
  const currentUrl = new URL(window.location.href);
  const roomFromUrl = roomCodeFromUrl(currentUrl) ?? "";
  const hasValidRoomInvite = /^[A-Z2-9]{5}$/.test(roomFromUrl);
  const isAgentInvite = hasValidRoomInvite && isAgentInviteUrl(currentUrl);
  const [selectedMode, setSelectedMode] = useState<RoomMode>("practice");
  const [createName, setCreateName] = useState("");
  const [createController, setCreateController] = useState<ControllerType>("human");
  const [joinName, setJoinName] = useState("");
  const [roomCode, setRoomCode] = useState(roomFromUrl);
  const [joinController, setJoinController] = useState<ControllerType>("human");
  const mode = getModeDefinition(selectedMode);

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    await onCreate({
      name: createName.trim(),
      mode: selectedMode,
      controller: selectedMode === "practice" ? "human" : createController,
    });
  };

  const submitJoin = async (event: FormEvent) => {
    event.preventDefault();
    await onJoin(roomCode.trim().toUpperCase(), {
      name: joinName.trim(),
      controller: joinController,
    });
  };

  if (isAgentInvite) {
    const personUrl = buildRoomInvites(
      roomFromUrl,
      window.location.origin,
      window.location.pathname,
    ).person.url;
    return (
      <AgentHandoff
        roomCode={roomFromUrl}
        personUrl={personUrl}
        lens={lens}
      />
    );
  }

  return (
    <main className="landing-page landing-experience">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <span className="eyebrow hero-kicker"><SparkIcon /> A drawing game for people + agents</span>
          <h1 id="landing-title">
            Draw. Guess.<br />
            <em>Swap roles</em> with your agent.
          </h1>
          <p>Open a shared sketchbook on the web, then let humans and browser agents play by the same rules.</p>
          <div className="landing-hero-actions">
            <a
              className="primary-button jumbo"
              href="#create-game"
              onClick={() => setSelectedMode("practice")}
            >
              Start Practice Pair <ArrowIcon />
            </a>
            <a className="text-link" href="#game-modes">Compare all three modes</a>
          </div>
          <div className="landing-proof" aria-label="Game highlights">
            <span><CheckIcon /> No model API key</span>
            <span><CheckIcon /> Real multiplayer rooms</span>
            <span><CheckIcon /> Role-safe WebMCP tools</span>
          </div>
        </div>
        <HeroDoodle />
      </section>

      <section className="mode-section" id="game-modes" aria-labelledby="mode-section-title">
        <header className="section-heading">
          <span className="eyebrow">Three ways to play</span>
          <h2 id="mode-section-title">Choose the table you want to set.</h2>
          <p>Each mode changes who plays, how turns rotate, and what a win means.</p>
        </header>
        <div className="mode-card-grid" role="group" aria-labelledby="mode-section-title">
          {GAME_MODES.map((definition, index) => {
            const selected = definition.id === selectedMode;
            return (
              <article
                className={`mode-card mode-${definition.tone} ${selected ? "is-selected" : ""}`}
                key={definition.id}
                aria-labelledby={`mode-${definition.id}-title`}
              >
                <span className="tape" aria-hidden="true" />
                <span className="mode-card-topline">
                  <span className="mode-number">0{index + 1}</span>
                  {definition.recommended ? <span className="recommended-badge">{definition.recommendation}</span> : null}
                  {selected ? <span className="picked-stamp" aria-hidden="true">Picked</span> : null}
                </span>
                <ModeDoodle mode={definition.id} />
                <span className="mode-card-copy">
                  <strong id={`mode-${definition.id}-title`}>{definition.name}</strong>
                  <small>{definition.tagline}</small>
                  <span>{definition.description}</span>
                </span>
                <dl className="mode-facts">
                  <div><dt>Players</dt><dd>{definition.players}<small>{definition.playerBreakdown}</small></dd></div>
                  <div><dt>Style</dt><dd>{definition.competition}<small>{definition.format}</small></dd></div>
                  <div><dt>Rounds</dt><dd>{definition.rounds.join(", ")}<small>{definition.setup}</small></dd></div>
                </dl>
                <span className="mode-loop" aria-label={`${definition.name} role loop`}>
                  <span>{definition.roleLoop[0]}</span>
                  <b aria-hidden="true">→</b>
                  <span>{definition.roleLoop[1]}</span>
                </span>
                <button
                  className="mode-card-select"
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedMode(definition.id)}
                >
                  {selected ? `${definition.name} selected` : `Choose ${definition.name}`}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className={`create-game-panel mode-${mode.tone}`} id="create-game" aria-labelledby="create-game-title">
        <div className="create-game-summary">
          <span className="eyebrow">Set up {mode.name}</span>
          <h2 id="create-game-title">{mode.tagline}</h2>
          <p>{mode.goal}. Choose the exact round count and drawing clock with everyone in the lobby.</p>
          <div className="selected-mode-loop">
            <span>{mode.roleLoop[0]}</span><ArrowIcon /><span>{mode.roleLoop[1]}</span>
          </div>
        </div>
        <form className="create-game-form" onSubmit={(event) => void submitCreate(event)}>
          <span className="tape tape-right" aria-hidden="true" />
          <label className="field">
            <span>Your display name</span>
            <input
              maxLength={24}
              required
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Sketchy McSketchface"
              autoComplete="nickname"
            />
          </label>
          {selectedMode === "practice" ? (
            <div className="practice-pair-strip" aria-label="One human and one browser agent">
              <span><PeopleIcon /> You</span><b aria-hidden="true">↔</b><span><BotIcon /> Your agent</span>
            </div>
          ) : (
            <ControllerPicker
              name="create-controller"
              value={createController}
              onChange={setCreateController}
            />
          )}
          <button className="primary-button jumbo" type="submit" disabled={busy || !createName.trim()}>
            {busy ? <span className="button-spinner" /> : <>{mode.createLabel} <ArrowIcon /></>}
          </button>
        </form>
      </section>

      <section className={`join-section ${hasValidRoomInvite ? "has-room-invite" : ""}`} id="join-room" aria-labelledby="join-room-title">
        <div className="join-section-copy">
          <span className="eyebrow">Already have a code?</span>
          <h2 id="join-room-title">Join a room.</h2>
          <p>{hasValidRoomInvite ? `Room ${roomFromUrl} is waiting for you.` : "Use the five-character code from any Practice, Arena, or Exhibition host."}</p>
        </div>
        <form className="join-form" onSubmit={(event) => void submitJoin(event)}>
          <label className="field">
            <span>Your display name</span>
            <input
              autoFocus={hasValidRoomInvite}
              maxLength={24}
              required
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="Your name"
              autoComplete="nickname"
            />
          </label>
          <label className="field">
            <span>Room code</span>
            <input
              className="code-input"
              required
              pattern="[A-Za-z2-9]{5}"
              maxLength={5}
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))}
              placeholder="INK42"
              autoComplete="off"
            />
          </label>
          <ControllerPicker
            name="join-controller"
            value={joinController}
            onChange={setJoinController}
            compact
          />
          <button className="secondary-button join-button" type="submit" disabled={busy || !joinName.trim() || roomCode.length !== 5}>
            Join this room <ArrowIcon />
          </button>
        </form>
      </section>

      <section className="agent-play-section" id="how-it-works" aria-labelledby="agent-play-title">
        <header className="section-heading">
          <span className="eyebrow">Two-way WebMCP play</span>
          <h2 id="agent-play-title">The tools follow the role.</h2>
          <p>Only the actions a player can legally take are available at that moment.</p>
        </header>
        <div className="role-direction-grid">
          <article>
            <span className="direction-number">01</span>
            <span className="direction-glyph agent"><BotIcon /></span>
            <h3>Agent draws. Human guesses.</h3>
            <p>The agent reads its private prompt and builds the shared canvas from low-level geometry.</p>
          </article>
          <article>
            <span className="direction-number">02</span>
            <span className="direction-glyph human"><PeopleIcon /></span>
            <h3>Human draws. Agent guesses.</h3>
            <p>The agent interprets the live, role-safe canvas state and submits candidates through WebMCP.</p>
          </article>
        </div>
        <div className="webmcp-proof-strip">
          <div><span className="eyebrow">Live proof</span><h3>See the page tools change with the game.</h3></div>
          {lens}
        </div>
      </section>
    </main>
  );
}

function ControllerPicker({
  name,
  value,
  onChange,
  compact = false,
}: {
  name: string;
  value: ControllerType;
  onChange(controller: ControllerType): void;
  compact?: boolean;
}) {
  return (
    <fieldset className={`controller-picker ${compact ? "is-compact" : ""}`}>
      <legend>Who controls this seat?</legend>
      <label className={value === "human" ? "is-selected" : ""}>
        <input type="radio" name={name} value="human" checked={value === "human"} onChange={() => onChange("human")} />
        <PeopleIcon /><span><strong>Human</strong><small>Mouse or touch</small></span>
      </label>
      <label className={value === "agent" ? "is-selected" : ""}>
        <input type="radio" name={name} value="agent" checked={value === "agent"} onChange={() => onChange("agent")} />
        <BotIcon /><span><strong>Agent</strong><small>WebMCP tools</small></span>
      </label>
    </fieldset>
  );
}

function AgentHandoff({ roomCode, personUrl, lens }: {
  roomCode: string;
  personUrl: string;
  lens: ReactNode;
}) {
  return (
    <main className="landing-page agent-handoff-page">
      <section className="agent-invite-alert" role="alert" aria-labelledby="agent-invite-title">
        <span className="agent-invite-icon" aria-hidden="true"><BotIcon /></span>
        <div>
          <span className="eyebrow">AI player invitation · Room {roomCode}</span>
          <h2 id="agent-invite-title">Navigation complete. Switch to this page’s WebMCP tools.</h2>
          <p>Browser navigation brought you here; joining and gameplay happen through MCPencil’s page-exposed tools.</p>
        </div>
      </section>
      <section className="agent-handoff-grid">
        <article className="agent-handoff-card" aria-labelledby="agent-handoff-heading">
          <span className="tape" aria-hidden="true" />
          <span className="agent-handoff-glyph" aria-hidden="true"><BotIcon /></span>
          <span className="eyebrow">Required first game action</span>
          <h1 id="agent-handoff-heading">Call the page tool now.</h1>
          <code className="agent-handoff-command">play_mcpencil({"{}"})</code>
          <ol>
            <li>Use the page-exposed <code>play_mcpencil</code> WebMCP tool to join and ready the AI seat.</li>
            <li>Perform drawing, guessing, readiness, and continuation through MCPencil WebMCP tools—not page clicks or DOM automation.</li>
            <li>Follow every returned <code>nextAction</code> until the state says <code>phase: match-end</code>.</li>
          </ol>
          <p className="agent-handoff-fallback">If <code>play_mcpencil</code> is not available, this browser surface does not expose WebMCP. Report that limitation instead of substituting UI automation.</p>
          <a className="text-link" href={personUrl}>I’m a person — open the human join page</a>
        </article>
        <aside className="agent-handoff-lens">{lens}</aside>
      </section>
    </main>
  );
}

function ModeDoodle({ mode }: { mode: RoomMode }) {
  if (mode === "practice") {
    return (
      <svg className="mode-doodle" viewBox="0 0 240 112" aria-hidden="true">
        <circle cx="48" cy="54" r="22" />
        <path d="M25 98c2-22 11-32 23-32s21 10 23 32" />
        <rect x="166" y="31" width="48" height="48" rx="12" />
        <path d="M190 18v13m-7-13h14m-20 37h.1m26 0h.1m-26 10h26" />
        <path d="M86 46h58m-10-9 10 9-10 9M144 72H86m10-9-10 9 10 9" />
      </svg>
    );
  }
  if (mode === "arena") {
    return (
      <svg className="mode-doodle" viewBox="0 0 240 112" aria-hidden="true">
        <path d="M120 14v84M106 28h28M106 84h28" />
        <circle cx="46" cy="35" r="15" /><circle cx="82" cy="76" r="15" />
        <circle cx="194" cy="35" r="15" /><circle cx="158" cy="76" r="15" />
        <path d="M28 66c3-13 9-19 18-19s15 6 18 19M64 107c3-13 9-19 18-19s15 6 18 19" />
        <rect x="176" y="48" width="36" height="29" rx="8" /><path d="M194 40v8m-7-8h14" />
        <rect x="140" y="88" width="36" height="19" rx="8" />
      </svg>
    );
  }
  return (
    <svg className="mode-doodle" viewBox="0 0 240 112" aria-hidden="true">
      <path d="m120 9 15 28 31 5-22 22 5 31-29-14-29 14 5-31-22-22 31-5 15-28Z" />
      <path d="M20 92h200M34 92l18-45m154 45-18-45M54 47h132" />
      <circle cx="77" cy="68" r="13" /><path d="M58 96c3-11 9-16 19-16s16 5 19 16" />
      <rect x="148" y="55" width="30" height="27" rx="7" /><path d="M163 48v7m-6-7h12m-14 20h.1m16 0h.1" />
    </svg>
  );
}

function HeroDoodle() {
  return (
    <div className="landing-hero-doodle" aria-hidden="true">
      <svg viewBox="0 0 520 360">
        <path className="doodle-paper" d="M62 42 452 28l18 278L78 330 62 42Z" />
        <path className="doodle-line cobalt slow" d="M142 255c17-83 37-136 73-175 33 43 56 99 72 172M166 184h96M126 257h180" />
        <path className="doodle-line coral medium" d="M342 205c-12-49 1-84 39-104 42 19 56 54 41 104m-80 0h82" />
        <circle className="doodle-line coral quick" cx="362" cy="148" r="6" />
        <circle className="doodle-line coral quick" cx="399" cy="148" r="6" />
        <path className="doodle-line coral quick" d="M354 172c18 14 36 14 54 0" />
        <path className="doodle-arrow" d="m318 74 24-20 26 14m-26-14 5 31" />
      </svg>
      <span className="doodle-note note-human"><PeopleIcon /> “A tower?”</span>
      <span className="doodle-note note-agent"><BotIcon /> “Eiffel Tower!” <CheckIcon /></span>
      <span className="doodle-pencil"><PencilIcon /></span>
    </div>
  );
}
