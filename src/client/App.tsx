import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  canGuess,
  isArtist,
  type ControllerType,
  type PrivatePrompt,
  type RoomMode,
  type RoomSnapshot,
  type TeamId,
  type VectorPrimitive,
} from "../shared/game";
import { remainingSeconds } from "../shared/format";
import type { ReplayPayload } from "./api";
import { CanvasBoard } from "./components/CanvasBoard";
import {
  ArrowIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  PeopleIcon,
  PencilIcon,
  SoundIcon,
  SparkIcon,
  XIcon,
} from "./components/Icons";
import { ReplayViewer } from "./components/ReplayViewer";
import { WebMcpLens } from "./components/WebMcpLens";
import { useGameSound } from "./hooks/useGameSound";
import { useRoomSession } from "./hooks/useRoomSession";
import { useWebMcpTools } from "./hooks/useWebMcpTools";

export function App() {
  const session = useRoomSession();
  const sound = useGameSound();
  const [copied, setCopied] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [hiddenPracticePrompt, setHiddenPracticePrompt] = useState<string | null>(null);
  const primarySeat = session.snapshot?.seats.find(
    (seat) => seat.id === session.credentials?.seatId,
  );

  const startPracticeForAgent = useCallback(
    async (name: string) => session.create({ name, mode: "practice", controller: "agent" }),
    [session.create],
  );
  const joinForAgent = useCallback(
    async (input: { roomCode: string; name: string; team?: TeamId; controller: ControllerType }) => {
      const joiningHostedPractice = session.snapshot?.mode === "practice"
        && session.snapshot.phase === "lobby"
        && session.credentials?.roomCode === input.roomCode
        && primarySeat?.controller === "human";
      const join = joiningHostedPractice ? session.joinAgent : session.join;
      await join(input.roomCode, { name: input.name, team: input.team, controller: input.controller });
    },
    [primarySeat?.controller, session.credentials?.roomCode, session.join, session.joinAgent, session.snapshot?.mode, session.snapshot?.phase],
  );

  const toolSeatId = session.companion?.seatId
    ?? (primarySeat?.controller === "agent" ? primarySeat.id : null);
  const practicePromptKey = session.snapshot?.mode === "practice"
    && session.snapshot.phase === "drawing"
    && session.snapshot.artistSeatId === session.credentials?.seatId
    && primarySeat?.controller === "human"
    ? `${session.snapshot.roomCode}:${session.snapshot.roundIndex}`
    : null;
  const practicePromptGate = practicePromptKey === null
    ? "none"
    : hiddenPracticePrompt === practicePromptKey ? "hidden" : "required";
  const webmcp = useWebMcpTools({
    snapshot: session.snapshot,
    seatId: toolSeatId,
    guessesEnabled: practicePromptGate !== "required",
    command: session.agentCommand,
    privatePrompt: session.agentPrivatePrompt,
    startPractice: startPracticeForAgent,
    joinMatch: joinForAgent,
  });

  const copyInvite = useCallback(async () => {
    const code = session.snapshot?.roomCode;
    if (!code) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [session.snapshot?.roomCode]);

  const act = useCallback(async (work: () => Promise<unknown>) => {
    setActionBusy(true);
    try {
      await work();
      sound.play("tap");
    } finally {
      setActionBusy(false);
    }
  }, [sound.play]);

  if (session.loading && !session.snapshot) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <AppHeader
        snapshot={session.snapshot}
        connected={session.connected}
        copied={copied}
        soundEnabled={sound.enabled}
        onCopy={() => void copyInvite()}
        onToggleSound={sound.toggle}
        onLeave={session.leave}
      />

      {!session.snapshot || !session.credentials ? (
        <Landing
          busy={session.loading}
          onCreate={(input) => session.create(input)}
          onJoin={(code, input) => session.join(code, input)}
          lens={<WebMcpLens supported={webmcp.supported} tools={webmcp.toolNames} invocations={webmcp.invocations} activity={[]} />}
        />
      ) : session.snapshot.phase === "lobby" ? (
        <Lobby
          snapshot={session.snapshot}
          seatId={session.credentials.seatId}
          busy={actionBusy}
          lens={<WebMcpLens supported={webmcp.supported} tools={webmcp.toolNames} invocations={webmcp.invocations} activity={session.snapshot.activity} />}
          onCommand={(command) => act(() => session.command(command))}
          onCopy={() => void copyInvite()}
        />
      ) : (
        <GameRoom
          snapshot={session.snapshot}
          seatId={session.credentials.seatId}
          companionSeatId={session.companion?.seatId ?? null}
          busy={actionBusy}
          lens={<WebMcpLens supported={webmcp.supported} tools={webmcp.toolNames} invocations={webmcp.invocations} activity={session.snapshot.activity} />}
          onCommand={(command) => act(() => session.command(command))}
          onPrompt={session.privatePrompt}
          onReplay={session.replay}
          privatePromptGate={practicePromptGate}
          onHidePrivatePrompt={() => {
            if (practicePromptKey !== null) setHiddenPracticePrompt(practicePromptKey);
          }}
          playSound={sound.play}
        />
      )}

      {session.error ? (
        <div className="toast error-toast" role="alert">
          <XIcon />
          <span>{session.error}</span>
          <button type="button" onClick={session.dismissError} aria-label="Dismiss error"><XIcon /></button>
        </div>
      ) : null}
    </div>
  );
}

function AppHeader({
  snapshot,
  connected,
  copied,
  soundEnabled,
  onCopy,
  onToggleSound,
  onLeave,
}: {
  snapshot: RoomSnapshot | null;
  connected: boolean;
  copied: boolean;
  soundEnabled: boolean;
  onCopy(): void;
  onToggleSound(): void;
  onLeave(): void;
}) {
  return (
    <header className="topbar">
      <a className="brand" href="/" onClick={(event) => {
        if (snapshot && !window.confirm("Leave this match?")) event.preventDefault();
      }}>
        <span className="brand-mark"><PencilIcon /></span>
        <span>MCP<span>encil</span></span>
        <sup>BETA</sup>
      </a>
      <div className="topbar-center">
        {snapshot ? <>
          <button className="room-chip" type="button" onClick={onCopy} title="Copy invite link">
            <small>ROOM</small><strong>{snapshot.roomCode}</strong>{copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <span className={`connection-chip ${connected ? "online" : "reconnecting"}`}><span />{connected ? "Live" : "Reconnecting"}</span>
        </> : <span className="topbar-tagline">Bring your own agent to game night.</span>}
      </div>
      <div className="topbar-actions">
        <button className={`icon-button quiet ${soundEnabled ? "" : "is-muted"}`} type="button" onClick={onToggleSound} aria-label={soundEnabled ? "Mute sounds" : "Enable sounds"}><SoundIcon /></button>
        {snapshot ? <button className="text-button" type="button" onClick={onLeave}>Leave room</button> : <a className="text-link" href="#how-it-works">How it works</a>}
      </div>
    </header>
  );
}

function Landing({
  busy,
  onCreate,
  onJoin,
  lens,
}: {
  busy: boolean;
  onCreate(input: { name: string; mode: RoomMode; controller: ControllerType }): Promise<void>;
  onJoin(code: string, input: { name: string; team?: TeamId; controller: ControllerType }): Promise<void>;
  lens: React.ReactNode;
}) {
  const roomFromUrl = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
  const [tab, setTab] = useState<"practice" | "arena" | "join">(roomFromUrl ? "join" : "practice");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(roomFromUrl);
  const [controller, setController] = useState<ControllerType>("human");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (tab === "join") await onJoin(roomCode.trim().toUpperCase(), { name, controller });
    else await onCreate({ name, mode: tab === "practice" ? "practice" : "arena", controller: tab === "practice" ? "human" : controller });
  };

  return (
    <main className="landing-page">
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="hero-kicker"><SparkIcon /> A party game built for people + agents</div>
          <h1>Can your agent<br /><em>draw the idea?</em></h1>
          <p>Sketch. Guess. Switch roles. MCPencil turns browser agents into first-class players using low-level WebMCP drawing tools.</p>
          <div className="hero-proof">
            <span><CheckIcon /> No model API keys</span><span><CheckIcon /> No bot accounts</span><span><CheckIcon /> Real multiplayer</span>
          </div>
          <HeroSketch />
        </div>

        <div className="entry-column">
          <section className="entry-card">
            <div className="entry-tabs" role="tablist" aria-label="Game entry mode">
              <button type="button" role="tab" aria-selected={tab === "practice"} onClick={() => setTab("practice")}>Practice Pair</button>
              <button type="button" role="tab" aria-selected={tab === "arena"} onClick={() => setTab("arena")}>Create Arena</button>
              <button type="button" role="tab" aria-selected={tab === "join"} onClick={() => setTab("join")}>Join</button>
            </div>
            <div className="entry-card-copy">
              <span className={`mode-glyph ${tab}`}><PencilIcon /></span>
              <div>
                <h2>{tab === "practice" ? "Two rounds. Both directions." : tab === "arena" ? "Build your dream team." : "Your team is waiting."}</h2>
                <p>{tab === "practice" ? "Your agent draws, then you draw. The fastest way to see the magic." : tab === "arena" ? "Create a six-round room for two teams of 2–4 humans and agents." : "Enter the five-character code from your host."}</p>
              </div>
            </div>
            <form className="entry-form" onSubmit={(event) => void submit(event)}>
              <label><span>Your display name</span><input autoFocus maxLength={24} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Sketchy McSketchface" autoComplete="nickname" /></label>
              {tab === "join" ? <label><span>Room code</span><input className="code-input" required pattern="[A-Za-z2-9]{5}" maxLength={5} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} placeholder="INK42" autoComplete="off" /></label> : null}
              {tab !== "practice" ? <fieldset className="controller-picker"><legend>Who controls this seat?</legend>
                <button type="button" className={controller === "human" ? "is-selected" : ""} onClick={() => setController("human")}><PeopleIcon /><span><strong>Human</strong><small>Mouse or touch</small></span></button>
                <button type="button" className={controller === "agent" ? "is-selected" : ""} onClick={() => setController("agent")}><BotIcon /><span><strong>Agent</strong><small>WebMCP tools</small></span></button>
              </fieldset> : <div className="practice-pair-strip"><span><PeopleIcon /> You</span><b>↔</b><span><BotIcon /> Your agent</span></div>}
              <button className="primary-button jumbo" type="submit" disabled={busy || !name.trim() || (tab === "join" && roomCode.length !== 5)}>
                {busy ? <span className="button-spinner" /> : <>{tab === "join" ? "Join the room" : tab === "practice" ? "Start practice" : "Create arena"}<ArrowIcon /></>}
              </button>
            </form>
          </section>
          {lens}
        </div>
      </section>

      <section className="how-strip" id="how-it-works">
        <article><span>01</span><BotIcon /><div><h3>Your agent gets a prompt</h3><p>A private, role-scoped read tool—never shared with guessers.</p></div></article>
        <article><span>02</span><PencilIcon /><div><h3>It draws with geometry</h3><p>Lines, arcs, and shapes. No text, image generation, or shortcuts.</p></div></article>
        <article><span>03</span><SparkIcon /><div><h3>You guess—then swap</h3><p>Draw for the agent and watch it submit a WebMCP guess.</p></div></article>
      </section>
    </main>
  );
}

function HeroSketch() {
  return (
    <div className="hero-sketch" aria-hidden="true">
      <svg viewBox="0 0 520 255">
        <path className="sketch-line slow" d="M78 197c24-62 46-103 74-126 19 37 38 82 47 125M103 141h76M88 198h124" />
        <path className="sketch-line cobalt medium" d="M277 186c-14-74 4-118 56-135 55 24 68 69 48 135M279 186h103M309 92c20 18 43 18 68 2" />
        <circle className="sketch-line coral quick" cx="329" cy="89" r="7" />
        <circle className="sketch-line coral quick" cx="359" cy="89" r="7" />
        <path className="sketch-line coral slow" d="M318 128c18 14 36 14 54 0" />
      </svg>
      <span className="guess-bubble guess-one">A bridge?</span>
      <span className="guess-bubble guess-two"><BotIcon /> Eiffel Tower! <CheckIcon /></span>
      <span className="agent-cursor"><BotIcon /><small>Agent is drawing</small></span>
    </div>
  );
}

function Lobby({ snapshot, seatId, busy, lens, onCommand, onCopy }: {
  snapshot: RoomSnapshot;
  seatId: string;
  busy: boolean;
  lens: React.ReactNode;
  onCommand(command: Parameters<ReturnType<typeof useRoomSession>["command"]>[0]): Promise<unknown>;
  onCopy(): void;
}) {
  const self = snapshot.seats.find((seat) => seat.id === seatId);
  const teams: TeamId[] = ["cobalt", "coral"];
  if (!self) return null;
  const activeSeats = snapshot.seats.filter((seat) => seat.isConnected);
  const allReady = activeSeats.every((seat) => seat.isReady);
  const enoughPlayers = snapshot.mode === "practice"
    ? activeSeats.length >= 2
    : teams.every((team) => activeSeats.filter((seat) => seat.team === team).length >= 2);

  if (snapshot.mode === "practice") {
    return <main className="lobby-page practice-lobby">
      <section className="lobby-heading"><div><span className="eyebrow">Practice Pair</span><h1>Invite your browser agent.</h1><p>The room starts automatically after a separate agent seat joins through WebMCP.</p></div><button className="invite-card" type="button" onClick={onCopy}><small>Give this room to your agent</small><strong>{snapshot.roomCode}</strong><span><CopyIcon /> Copy link</span></button></section>
      <div className="practice-lobby-grid">
        <section className="practice-duo-card">
          {snapshot.seats.map((seat, index) => <div className="practice-player" key={seat.id}><span className={`avatar ${seat.controller}`}>{seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}</span><div><small>{seat.controller === "agent" ? "BROWSER AGENT" : "HUMAN PLAYER"}</small><strong>{seat.name}{seat.id === seatId ? " (you)" : ""}</strong><span><CheckIcon /> Ready</span></div>{index === 0 ? <b>↔</b> : null}</div>)}
          <div className="practice-explainer"><SparkIcon /><p><strong>Round one:</strong> your agent draws and you guess.<br /><strong>Round two:</strong> you draw and your agent guesses.</p></div>
          <p className="waiting-host"><span className="pulse-dot" />{enoughPlayers ? "Agent joined — opening the first round…" : "Waiting for an agent to call join_match…"}</p>
        </section>
        <aside className="lobby-controls">{lens}</aside>
      </div>
    </main>;
  }

  return (
    <main className="lobby-page">
      <section className="lobby-heading">
        <div><span className="eyebrow">Team Arena</span><h1>Assemble your sketch squad.</h1><p>Mix humans and agents freely. The same rules—and the same canvas—apply to everyone.</p></div>
        <button className="invite-card" type="button" onClick={onCopy}><small>Invite players with room code</small><strong>{snapshot.roomCode}</strong><span><CopyIcon /> Copy link</span></button>
      </section>

      <div className="lobby-content">
        <section className="team-board">
          {teams.map((team) => <article className={`team-column team-${team}`} key={team}>
            <header><span className="team-pattern" /><div><small>TEAM</small><h2>{team === "cobalt" ? "Cobalt" : "Coral"}</h2></div><strong>{snapshot.seats.filter((seat) => seat.team === team).length}/4</strong></header>
            <div className="seat-stack">
              {snapshot.seats.filter((seat) => seat.team === team).map((seat) => <SeatCard key={seat.id} seat={seat} isSelf={seat.id === seatId} />)}
              {Array.from({ length: Math.max(1, 3 - snapshot.seats.filter((seat) => seat.team === team).length) }).slice(0, 2).map((_, index) => <div className="empty-seat" key={index}><span>+</span> Open seat</div>)}
            </div>
          </article>)}
        </section>

        <aside className="lobby-controls">
          <section className="control-card"><span className="eyebrow">Your seat</span><h3>{self.name}</h3>
            <label>Team</label><div className="segmented"><button type="button" className={self.team === "cobalt" ? "active cobalt" : ""} onClick={() => void onCommand({ type: "configure_seat", team: "cobalt", controller: self.controller })}>Cobalt</button><button type="button" className={self.team === "coral" ? "active coral" : ""} onClick={() => void onCommand({ type: "configure_seat", team: "coral", controller: self.controller })}>Coral</button></div>
            <label>Controller</label><div className="segmented"><button type="button" className={self.controller === "human" ? "active" : ""} onClick={() => void onCommand({ type: "configure_seat", team: self.team, controller: "human" })}><PeopleIcon /> Human</button><button type="button" className={self.controller === "agent" ? "active" : ""} onClick={() => void onCommand({ type: "configure_seat", team: self.team, controller: "agent" })}><BotIcon /> Agent</button></div>
            {self.controller === "human" ? <button className={`ready-button ${self.isReady ? "is-ready" : ""}`} type="button" disabled={busy} onClick={() => void onCommand({ type: "ready_up", ready: !self.isReady, origin: "human-ui" })}>{self.isReady ? <><CheckIcon /> Ready!</> : "I’m ready"}</button> : <div className="agent-guess-note"><BotIcon /><div><strong>Agent seat is ready.</strong><span>No extra ready-up call required.</span></div></div>}
          </section>
          {self.isHost ? self.controller === "human" ? <button className="primary-button jumbo" type="button" disabled={busy || !allReady || !enoughPlayers} onClick={() => void onCommand({ type: "start_match", origin: "human-ui" })}>{!enoughPlayers ? "Need 2 live players on each team" : !allReady ? `Waiting for ${activeSeats.filter((seat) => !seat.isReady).length} player${activeSeats.filter((seat) => !seat.isReady).length === 1 ? "" : "s"}…` : <>Start match <ArrowIcon /></>}</button> : <p className="waiting-host"><span className="pulse-dot" />The agent host can start with <code>start_match</code>.</p> : <p className="waiting-host"><span className="pulse-dot" />Waiting for the host to start…</p>}
          {lens}
        </aside>
      </div>
    </main>
  );
}

function SeatCard({ seat, isSelf }: { seat: RoomSnapshot["seats"][number]; isSelf: boolean }) {
  return <div className={`seat-card ${seat.isReady ? "is-ready" : ""} ${!seat.isConnected ? "is-away" : ""}`}>
    <span className={`avatar ${seat.controller}`} aria-hidden="true">{seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}</span>
    <div><strong>{seat.name}{isSelf ? " (you)" : ""}</strong><small>{seat.isHost ? "Host · " : ""}{seat.controller === "agent" ? "Browser agent" : "Human player"}</small></div>
    <span className="seat-status">{!seat.isConnected ? "Away" : seat.isReady ? <CheckIcon /> : "…"}</span>
  </div>;
}

function GameRoom({ snapshot, seatId, companionSeatId, busy, lens, onCommand, onPrompt, onReplay, privatePromptGate, onHidePrivatePrompt, playSound }: {
  snapshot: RoomSnapshot;
  seatId: string;
  companionSeatId: string | null;
  busy: boolean;
  lens: React.ReactNode;
  onCommand(command: Parameters<ReturnType<typeof useRoomSession>["command"]>[0]): Promise<unknown>;
  onPrompt(signal?: AbortSignal): Promise<PrivatePrompt>;
  onReplay(signal?: AbortSignal): Promise<ReplayPayload>;
  privatePromptGate: "none" | "required" | "hidden";
  onHidePrivatePrompt(): void;
  playSound(cue: "tap" | "start" | "correct" | "finish"): void;
}) {
  const self = snapshot.seats.find((seat) => seat.id === seatId);
  const agentSeat = snapshot.seats.find((seat) => seat.id === companionSeatId);
  const artist = snapshot.seats.find((seat) => seat.id === snapshot.artistSeatId);
  const humanArtist = isArtist(snapshot, seatId) && self?.controller === "human";
  const humanGuesser = canGuess(snapshot, seatId) && self?.controller === "human";
  const primaryAgentArtist = isArtist(snapshot, seatId) && self?.controller === "agent";
  const primaryAgentGuesser = canGuess(snapshot, seatId) && self?.controller === "agent";
  const agentArtist = primaryAgentArtist || Boolean(agentSeat && isArtist(snapshot, agentSeat.id));
  const agentGuesser = primaryAgentGuesser || Boolean(agentSeat && canGuess(snapshot, agentSeat.id));
  const [prompt, setPrompt] = useState<PrivatePrompt | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptAttempt, setPromptAttempt] = useState(0);
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(Date.now());
  const previousPhase = useRef(snapshot.phase);

  useEffect(() => {
    if (snapshot.phase !== "drawing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [snapshot.phase]);

  useEffect(() => {
    if (!humanArtist) { setPrompt(null); setPromptError(null); return; }
    const controller = new AbortController();
    setPrompt(null);
    setPromptError(null);
    onPrompt(controller.signal).then(setPrompt).catch((reason: unknown) => {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setPromptError(reason instanceof Error ? reason.message : "Could not load the private prompt.");
      }
    });
    return () => { controller.abort(); setPrompt(null); };
  }, [humanArtist, onPrompt, promptAttempt, snapshot.roundIndex]);

  useEffect(() => {
    if (previousPhase.current === "drawing" && snapshot.phase === "round-end") playSound(snapshot.roundResult?.pointsAwarded ? "correct" : "finish");
    if (previousPhase.current !== "drawing" && snapshot.phase === "drawing") playSound("start");
    previousPhase.current = snapshot.phase;
  }, [playSound, snapshot.phase, snapshot.roundResult?.pointsAwarded]);

  const submitGuess = async (event: FormEvent) => {
    event.preventDefault();
    const answer = guess.trim();
    if (!answer) return;
    setGuess("");
    await onCommand({ type: "submit_guess", guess: answer, origin: "human-ui" });
  };
  const draw = async (primitives: VectorPrimitive[]) => {
    await onCommand({ type: "draw_batch", expectedVersion: snapshot.canvasVersion, idempotencyKey: `human-${crypto.randomUUID()}`, primitives, origin: "human-ui" });
  };
  const undo = async () => {
    await onCommand({ type: "undo_draw_batch", expectedVersion: snapshot.canvasVersion, origin: "human-ui" });
  };
  const seconds = remainingSeconds(snapshot.endsAt, now) ?? 0;
  const timerProgress = snapshot.endsAt ? Math.max(0, Math.min(1, seconds / 90)) : 0;

  if (snapshot.phase === "match-end") return (
    <MatchEnd snapshot={snapshot} seatId={seatId} lens={lens} onReplay={onReplay} />
  );

  if (privatePromptGate === "required") {
    return (
      <main className="private-prompt-page">
        <section className="private-prompt-card" aria-live="polite">
          <span className="private-prompt-icon"><PencilIcon /></span>
          <span className="eyebrow">Private human prompt</span>
          <h1>{prompt?.prompt ?? (promptError ? "Prompt unavailable" : "Opening your prompt…")}</h1>
          <p>{prompt ? `${prompt.category} · memorize this, then hide it before your agent begins guessing.` : promptError ?? "Only you should look at this card."}</p>
          <div className="private-prompt-warning"><span aria-hidden="true">◉̸</span> The agent’s <code>submit_guess</code> tool is not registered while this card exists.</div>
          {promptError ? <button className="secondary-button" type="button" onClick={() => setPromptAttempt((attempt) => attempt + 1)}>Retry private prompt</button> : <button
            className="primary-button jumbo"
            type="button"
            disabled={!prompt}
            onClick={() => {
              setPrompt(null);
              onHidePrivatePrompt();
            }}
          >
            I’ve got it — hide prompt &amp; draw <ArrowIcon />
          </button>}
        </section>
        <aside className="private-prompt-lens">{lens}</aside>
      </main>
    );
  }

  return (
    <main className="game-page">
      <section className="game-scorebar">
        <TeamScore team="cobalt" score={snapshot.scores.cobalt} active={snapshot.activeTeam === "cobalt"} seats={snapshot.seats} artistId={snapshot.artistSeatId} />
        <div className={`round-timer ${seconds <= 15 ? "is-urgent" : ""}`} style={{ "--timer-progress": timerProgress } as React.CSSProperties}>
          <small>ROUND {snapshot.roundIndex + 1} / {snapshot.totalRounds}</small><strong>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</strong><span>{snapshot.phase === "round-end" ? "Round complete" : artist ? `${artist.name} is drawing` : "Get ready"}</span>
        </div>
        <TeamScore team="coral" score={snapshot.scores.coral} active={snapshot.activeTeam === "coral"} seats={snapshot.seats} artistId={snapshot.artistSeatId} />
      </section>

      {snapshot.phase === "round-end" ? (
        <RoundEnd snapshot={snapshot} humanController={self?.controller === "human"} onNext={() => onCommand({ type: "ready_next", expectedRoundIndex: snapshot.roundIndex, origin: "human-ui" })} busy={busy} lens={lens} />
      ) : (
        <div className="game-layout">
          <section className="play-column">
            <div className={`role-banner team-${snapshot.activeTeam}`}>
              <span className="role-icon">{humanArtist ? <PencilIcon /> : agentArtist ? <BotIcon /> : <SparkIcon />}</span>
              <div>
                <small>{humanArtist ? "YOU ARE DRAWING" : primaryAgentArtist ? "YOU ARE DRAWING" : agentArtist ? "YOUR AGENT IS DRAWING" : humanGuesser ? "GUESS FOR YOUR TEAM" : primaryAgentGuesser ? "YOU ARE GUESSING" : agentGuesser ? "YOUR AGENT IS GUESSING" : "SPECTATING"}</small>
                <strong>{humanArtist ? (privatePromptGate === "hidden" ? "Prompt hidden — draw it from memory." : prompt?.prompt ?? "Fetching your secret prompt…") : primaryAgentArtist ? "Get the private prompt and draw the first silhouette immediately." : agentArtist ? "Ask your agent to get its prompt and draw." : humanGuesser ? "Name it before the clock runs out." : primaryAgentGuesser ? "Inspect every canvas update and guess broadly before refining." : agentGuesser ? "Keep drawing while your agent inspects each update." : `Watching ${artist?.name ?? "the artist"}`}</strong>
                {humanArtist && prompt && privatePromptGate !== "hidden" ? <span>{prompt.category} · do not write words or letters</span> : null}
              </div>
              {agentArtist || agentGuesser ? <span className="agent-ready-pill"><span className="pulse-dot" /> WebMCP tools ready</span> : null}
            </div>

            <CanvasBoard events={snapshot.canvas} canvasVersion={snapshot.canvasVersion} canDraw={humanArtist} busy={busy} artistLabel={artist?.name} onDraw={draw} onUndo={undo} />

            {humanGuesser ? <form className="guess-composer" onSubmit={(event) => void submitGuess(event)}>
              <span className="guess-pencil"><PencilIcon /></span><label><span className="sr-only">Your guess</span><input autoFocus value={guess} onChange={(event) => setGuess(event.target.value)} maxLength={80} placeholder="What is the drawing?" autoComplete="off" /></label>
              <button className="primary-button" type="submit" disabled={busy || !guess.trim()}>Guess <ArrowIcon /></button>
            </form> : agentGuesser ? <div className="agent-guess-note"><BotIcon /><div><strong>{primaryAgentGuesser ? <>Use <code>get_match_state</code>, then <code>submit_guess</code>.</> : <>Your agent has <code>submit_guess</code>.</>}</strong><span>{primaryAgentGuesser ? "Read the latest geometry and guess after every canvas version." : "Ask it to inspect the canvas and make its best guess."}</span></div></div> : null}
          </section>

          <aside className="game-sidebar">
            {lens}
            <GuessFeed snapshot={snapshot} />
          </aside>
        </div>
      )}
    </main>
  );
}

function TeamScore({ team, score, active, seats, artistId }: { team: TeamId; score: number; active: boolean; seats: RoomSnapshot["seats"]; artistId: string | null }) {
  return <div className={`team-score team-${team} ${active ? "is-active" : ""}`}><span className="team-pattern" /><div><small>TEAM {team.toUpperCase()}</small><strong>{score}</strong></div><div className="score-avatars">{seats.filter((seat) => seat.team === team).map((seat) => <span key={seat.id} className={`mini-avatar ${seat.id === artistId ? "is-artist" : ""}`}>{seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}</span>)}</div></div>;
}

function GuessFeed({ snapshot }: { snapshot: RoomSnapshot }) {
  return <section className="guess-feed"><header><div><span className="eyebrow">Team chat</span><h3>Live guesses</h3></div><span>{snapshot.guesses.length}</span></header><div className="guess-list">
    {snapshot.guesses.slice().reverse().slice(0, 10).map((guess) => <article key={guess.id} className={guess.isCorrect ? "is-correct" : ""}><span className={`avatar tiny ${guess.origin === "webmcp" ? "agent" : "human"}`}>{guess.origin === "webmcp" ? <BotIcon /> : guess.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{guess.displayName}<small>{guess.origin === "webmcp" ? "via WebMCP" : "human"}</small></strong><p>{guess.guess}</p></div>{guess.isCorrect ? <CheckIcon /> : null}</article>)}
    {!snapshot.guesses.length ? <div className="empty-guesses"><span>?</span><p>No guesses yet.<br />Be brave. Be wrong fast.</p></div> : null}
  </div></section>;
}

function RoundEnd({ snapshot, humanController, onNext, busy, lens }: { snapshot: RoomSnapshot; humanController: boolean; onNext(): Promise<unknown>; busy: boolean; lens: React.ReactNode }) {
  const result = snapshot.roundResult;
  const finalRound = snapshot.roundIndex + 1 >= snapshot.totalRounds;
  return <div className="round-end-layout"><section className="round-result-card"><div className="confetti" aria-hidden="true">✦ · ✎ · ✦ ·</div><span className="eyebrow">Round {snapshot.roundIndex + 1} complete</span><h1>{result?.pointsAwarded ? "That was the idea!" : "Time’s up!"}</h1><p className="revealed-answer">{result?.prompt ?? "Prompt unavailable"}</p><div className="round-stat-row"><div><small>Points</small><strong>+{result?.pointsAwarded ?? 0}</strong></div><div><small>Guessed in</small><strong>{result?.elapsedMs ? `${(result.elapsedMs / 1000).toFixed(1)}s` : "—"}</strong></div><div><small>Strokes</small><strong>{result?.strokeCount ?? 0}</strong></div><div><small>Tool calls</small><strong>{result?.toolCallCount ?? 0}</strong></div></div>{humanController ? <button className="primary-button jumbo" type="button" onClick={() => void onNext()} disabled={busy}>{finalRound ? "See match results" : `Ready for round ${snapshot.roundIndex + 2}`}<ArrowIcon /></button> : <div className="agent-guess-note"><BotIcon /><div><strong>Your agent has <code>ready_next</code>.</strong><span>Ask it to continue through WebMCP.</span></div></div>}</section><aside className="round-lens">{lens}</aside></div>;
}

function MatchEnd({ snapshot, seatId, lens, onReplay }: { snapshot: RoomSnapshot; seatId: string; lens: React.ReactNode; onReplay(signal?: AbortSignal): Promise<ReplayPayload> }) {
  const [replay, setReplay] = useState<ReplayPayload | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    onReplay(controller.signal).then(setReplay).catch(() => undefined);
    return () => controller.abort();
  }, [onReplay]);
  const winner: TeamId | "tie" = snapshot.scores.cobalt === snapshot.scores.coral ? "tie" : snapshot.scores.cobalt > snapshot.scores.coral ? "cobalt" : "coral";
  const self = snapshot.seats.find((seat) => seat.id === seatId);
  const practice = snapshot.mode === "practice";
  return <main className="match-end-page"><section className="winner-banner"><span className="eyebrow">{practice ? "Two-way practice complete" : "Final score"}</span><h1>{practice ? "You and your agent speak sketch." : winner === "tie" ? "A perfect draw." : `${winner === "cobalt" ? "Cobalt" : "Coral"} takes the sketchbook!`}</h1>{practice ? <div className="practice-complete"><PeopleIcon /><span>↔</span><BotIcon /></div> : <div className="final-score"><span className="cobalt">{snapshot.scores.cobalt}</span><small>—</small><span className="coral">{snapshot.scores.coral}</span></div>}<p>{practice ? "One agent drawing. One human drawing. Two successful directions of WebMCP play." : winner === "tie" || self?.team === winner ? "Human imagination. Agent precision. Excellent teamwork." : "A noble scribble. The rematch button is implied."}</p></section><div className="end-content"><ReplayViewer events={snapshot.canvas} analytics={snapshot.analytics} result={snapshot.roundResult} replay={replay} /><aside>{lens}<button className="secondary-button full" type="button" onClick={() => window.location.assign("/")}>Play another match</button></aside></div></main>;
}

function LoadingScreen() {
  return <main className="loading-screen"><span className="brand-mark giant"><PencilIcon /></span><h1>MCPencil</h1><p>Sharpening the room…</p><div className="loading-scribble" /></main>;
}
