import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  canGuess,
  isArtist,
  type ControllerType,
  type GuessEvent,
  type PrivatePrompt,
  type RoomSnapshot,
  type TeamId,
  type VectorPrimitive,
} from "../shared/game";
import { remainingSeconds } from "../shared/format";
import type { ReplayPayload } from "./api";
import {
  buildRoomInvites,
  isAgentInviteUrl,
  separateAgentViewInstruction,
  type InviteAudience,
} from "./invite";
import { currentHumanPromptKey, humanPromptGate } from "./humanPromptGate";
import { playAnotherMatch } from "./playAgain";
import { getModeDefinition } from "./modes";
import { CanvasBoard, PrimitiveMark } from "./components/CanvasBoard";
import { FlipbookShell } from "./components/FlipbookShell";
import { LandingExperience } from "./components/LandingExperience";
import { LobbyExperience } from "./components/LobbyExperience";
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
import { describeFlipbookView } from "./flipbook";

export function App() {
  const session = useRoomSession();
  const sound = useGameSound();
  const [copiedInvite, setCopiedInvite] = useState<InviteAudience | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [hiddenHumanPrompt, setHiddenHumanPrompt] = useState<string | null>(null);
  const primarySeat = session.snapshot?.seats.find(
    (seat) => seat.id === session.credentials?.seatId,
  );

  const startPracticeForAgent = useCallback(
    async (name: string) => session.create({ name, mode: "practice", controller: "agent" }),
    [session.create],
  );
  const joinForAgent = useCallback(
    async (input: { roomCode: string; name: string; team?: TeamId; controller: ControllerType }) => {
      if (primarySeat?.controller === "human") {
        throw new Error(separateAgentViewInstruction(input.roomCode, window.location.origin));
      }
      return session.join(input.roomCode, { name: input.name, team: input.team, controller: input.controller });
    },
    [primarySeat?.controller, session.join],
  );

  const humanHostDocument = primarySeat?.controller === "human";
  const toolSeatId = primarySeat?.controller === "agent" ? primarySeat.id : null;
  const activeHumanPromptKey = currentHumanPromptKey(
    session.snapshot,
    session.credentials?.seatId ?? null,
    primarySeat?.controller ?? null,
  );
  const activeHumanPromptGate = humanPromptGate(activeHumanPromptKey, hiddenHumanPrompt);
  const flipbookView = describeFlipbookView(
    session.snapshot,
    activeHumanPromptGate,
    isAgentInviteUrl(new URL(window.location.href)),
  );

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [flipbookView.key]);

  const leaveToLanding = useCallback(
    () => playAnotherMatch(session.leave, (url) => window.location.assign(url)),
    [session.leave],
  );
  const webmcp = useWebMcpTools({
    snapshot: session.snapshot,
    seatId: toolSeatId,
    enabled: session.credentials === null || session.snapshot !== null,
    guessesEnabled: activeHumanPromptGate !== "required",
    command: session.agentCommand,
    privatePrompt: session.agentPrivatePrompt,
    startPractice: startPracticeForAgent,
    joinMatch: joinForAgent,
    humanHostDocument,
  });

  const copyInvite = useCallback(async (audience: InviteAudience) => {
    const code = session.snapshot?.roomCode;
    if (!code) return;
    const invitations = buildRoomInvites(
      code,
      window.location.origin,
      window.location.pathname,
    );
    await navigator.clipboard.writeText(invitations[audience].text);
    setCopiedInvite(audience);
    window.setTimeout(() => {
      setCopiedInvite((current) => current === audience ? null : current);
    }, 1600);
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
        copied={copiedInvite === "person"}
        soundEnabled={sound.enabled}
        onCopy={() => void copyInvite("person")}
        onToggleSound={sound.toggle}
        onLeave={leaveToLanding}
      />

      <FlipbookShell view={flipbookView}>
        {!session.snapshot || !session.credentials ? (
          <LandingExperience
            busy={session.loading}
            onCreate={(input) => session.create(input)}
            onJoin={async (code, input) => { await session.join(code, input); }}
            lens={<WebMcpLens supported={webmcp.supported} tools={webmcp.toolNames} actionableTools={webmcp.actionableTools} registeredTools={webmcp.registeredTools} context={webmcp.proofContext} authorizationEvents={webmcp.authorizationEvents} invocations={webmcp.invocations} activity={[]} />}
          />
        ) : session.snapshot.phase === "lobby" ? (
          <LobbyExperience
            snapshot={session.snapshot}
            seatId={session.credentials.seatId}
            busy={actionBusy}
            lens={<WebMcpLens supported={webmcp.supported} tools={webmcp.toolNames} actionableTools={webmcp.actionableTools} registeredTools={webmcp.registeredTools} context={webmcp.proofContext} authorizationEvents={webmcp.authorizationEvents} invocations={webmcp.invocations} activity={session.snapshot.activity} />}
            onCommand={(command) => act(() => session.command(command))}
            copiedInvite={copiedInvite}
            onCopyInvite={(audience) => void copyInvite(audience)}
          />
        ) : (
          <GameRoom
            snapshot={session.snapshot}
            seatId={session.credentials.seatId}
            busy={actionBusy}
            lens={<WebMcpLens supported={webmcp.supported} tools={webmcp.toolNames} actionableTools={webmcp.actionableTools} registeredTools={webmcp.registeredTools} context={webmcp.proofContext} authorizationEvents={webmcp.authorizationEvents} invocations={webmcp.invocations} activity={session.snapshot.activity} defaultOpen={session.snapshot.phase !== "drawing" && session.snapshot.phase !== "round-prep"} />}
            onCommand={(command) => act(() => session.command(command))}
            onPrompt={session.privatePrompt}
            onReplay={session.replay}
            onPlayAgain={leaveToLanding}
            privatePromptGate={activeHumanPromptGate}
            onHidePrivatePrompt={() => {
              if (activeHumanPromptKey !== null) setHiddenHumanPrompt(activeHumanPromptKey);
            }}
            playSound={sound.play}
          />
        )}
      </FlipbookShell>

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
  const mode = snapshot ? getModeDefinition(snapshot.mode) : null;
  return (
    <header className="topbar">
      <a className="brand" href="/" onClick={(event) => {
        if (!snapshot) return;
        event.preventDefault();
        if (window.confirm("Leave this match?")) onLeave();
      }}>
        <span className="brand-mark"><PencilIcon /></span>
        <span>MCP<span>encil</span></span>
        <sup>WebMCP game</sup>
      </a>
      <div className="topbar-center">
        {snapshot ? <>
          <span className={`mode-chip mode-${snapshot.mode}`}>{mode?.name}</span>
          <button className="room-chip" type="button" onClick={onCopy} title="Copy person invite link" aria-label={`Copy person invite link for room ${snapshot.roomCode}`}>
            <small>ROOM</small><strong>{snapshot.roomCode}</strong>{copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <span className={`connection-chip ${connected ? "online" : "reconnecting"}`}><span />{connected ? "Live" : "Reconnecting"}</span>
        </> : <span className="topbar-tagline">A drawing game where browser agents actually play.</span>}
      </div>
      <div className="topbar-actions">
        <button className={`icon-button quiet ${soundEnabled ? "" : "is-muted"}`} type="button" onClick={onToggleSound} aria-label={soundEnabled ? "Mute sounds" : "Enable sounds"}><SoundIcon /></button>
        {snapshot ? <button className="text-button leave-button" type="button" onClick={onLeave}>Leave room</button> : <nav className="topbar-nav" aria-label="Landing page"><a className="text-link" href="#game-modes">Game modes</a><a className="text-link" href="#how-it-works">How it works</a></nav>}
      </div>
    </header>
  );
}

function GameRoom({ snapshot, seatId, busy, lens, onCommand, onPrompt, onReplay, onPlayAgain, privatePromptGate, onHidePrivatePrompt, playSound }: {
  snapshot: RoomSnapshot;
  seatId: string;
  busy: boolean;
  lens: React.ReactNode;
  onCommand(command: Parameters<ReturnType<typeof useRoomSession>["command"]>[0]): Promise<unknown>;
  onPrompt(signal?: AbortSignal): Promise<PrivatePrompt>;
  onReplay(signal?: AbortSignal): Promise<ReplayPayload>;
  onPlayAgain(): void;
  privatePromptGate: "none" | "required" | "hidden";
  onHidePrivatePrompt(): void;
  playSound(cue: "tap" | "start" | "correct" | "finish"): void;
}) {
  const self = snapshot.seats.find((seat) => seat.id === seatId);
  const artist = snapshot.seats.find((seat) => seat.id === snapshot.artistSeatId);
  const isPrep = snapshot.phase === "round-prep";
  const humanArtist = isArtist(snapshot, seatId) && self?.controller === "human";
  const humanGuesser = canGuess(snapshot, seatId) && self?.controller === "human";
  const primaryAgentArtist = isArtist(snapshot, seatId) && self?.controller === "agent";
  const primaryAgentGuesser = canGuess(snapshot, seatId) && self?.controller === "agent";
  const agentArtist = primaryAgentArtist;
  const agentGuesser = primaryAgentGuesser;
  const prepHumanGuesser = isPrep
    && self?.controller === "human"
    && self.team === snapshot.activeTeam
    && self.id !== snapshot.artistSeatId;
  const prepPrimaryAgentGuesser = isPrep
    && self?.controller === "agent"
    && self.team === snapshot.activeTeam
    && self.id !== snapshot.artistSeatId;
  const prepGuesser = prepHumanGuesser || prepPrimaryAgentGuesser;
  const [prompt, setPrompt] = useState<PrivatePrompt | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptAttempt, setPromptAttempt] = useState(0);
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(Date.now());
  const previousPhase = useRef(snapshot.phase);

  useEffect(() => {
    if (snapshot.phase !== "round-prep" && snapshot.phase !== "drawing" && snapshot.phase !== "round-end") return;
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
  const roundDurationSeconds = snapshot.roundDurationMs / 1000;
  const timerScale = snapshot.phase === "round-prep" ? 8 : snapshot.phase === "round-end" ? 15 : roundDurationSeconds;
  const timerProgress = snapshot.endsAt ? Math.max(0, Math.min(1, seconds / timerScale)) : 0;
  const roleLabel = humanArtist
    ? isPrep ? "YOU HAVE THE OPENING STROKE" : "YOU ARE DRAWING"
    : primaryAgentArtist
      ? isPrep ? "DRAW NOW" : "YOU ARE DRAWING"
      : agentArtist
        ? isPrep ? "YOUR AGENT HAS THE OPENING STROKE" : "YOUR AGENT IS DRAWING"
        : prepGuesser
          ? "OPENING STROKE PREP"
          : humanGuesser
            ? "GUESS FOR YOUR TEAM"
            : primaryAgentGuesser
              ? "YOU ARE GUESSING"
              : agentGuesser
                ? "YOUR AGENT IS GUESSING"
                : "SPECTATING";
  const roleMessage = humanArtist
    ? isPrep
      ? (privatePromptGate === "hidden" ? `Draw one opening stroke — it starts the ${roundDurationSeconds}-second clock.` : prompt?.prompt ?? "Fetching your secret prompt…")
      : (privatePromptGate === "hidden" ? "Prompt hidden — draw it from memory." : prompt?.prompt ?? "Fetching your secret prompt…")
    : primaryAgentArtist
      ? isPrep
        ? `Call draw_stroke now. One primitive starts the ${roundDurationSeconds}-second clock.`
        : "Keep calling draw_stroke — one visible stroke at a time."
      : agentArtist
        ? isPrep
          ? "Ask your agent to call draw_stroke now — one primitive only."
          : "Your agent should send one draw_stroke call at a time."
        : prepGuesser
          ? `${artist?.name ?? "The artist"} is preparing one opening stroke. Guessing unlocks when it lands.`
          : humanGuesser
            ? "Name it before the clock runs out."
            : primaryAgentGuesser
              ? "Inspect the latest canvas, then call submit_guesses with broad candidates."
              : agentGuesser
                ? "Keep drawing while your agent calls submit_guesses after every meaningful update."
                : `Watching ${artist?.name ?? "the artist"}`;
  const timerLabel = snapshot.phase === "round-prep"
    ? `First stroke starts ${roundDurationSeconds}s`
    : snapshot.phase === "round-end"
      ? "Results stay up while players ready"
      : artist
        ? `${artist.name} is drawing`
        : "Get ready";

  if (snapshot.phase === "match-end") return (
    <MatchEnd snapshot={snapshot} seatId={seatId} lens={lens} onReplay={onReplay} onPlayAgain={onPlayAgain} />
  );

  if (privatePromptGate === "required") {
    return (
      <main className="private-prompt-page">
        <section className="private-prompt-card" aria-live="polite">
          <span className="tape" aria-hidden="true" />
          <span className="private-prompt-icon"><PencilIcon /></span>
          <span className="eyebrow">Psst — your secret word</span>
          <h1>{prompt?.prompt ?? (promptError ? "Prompt unavailable" : "Opening your prompt…")}</h1>
          <p>{prompt ? `${prompt.category} · memorize this, then hide it. Your first stroke starts the ${roundDurationSeconds}-second clock.` : promptError ?? "Only you should look at this card."}</p>
          <div className="private-prompt-warning"><span aria-hidden="true">◉̸</span> The agent’s <code>submit_guesses</code> tool stays disabled until your first stroke.</div>
          {promptError ? <button className="secondary-button" type="button" onClick={() => setPromptAttempt((attempt) => attempt + 1)}>Retry private prompt</button> : <button
            className="primary-button jumbo"
            type="button"
            disabled={!prompt}
            onClick={() => {
              setPrompt(null);
              onHidePrivatePrompt();
            }}
          >
            I’ve got it — draw the opening stroke <ArrowIcon />
          </button>}
        </section>
        <aside className="private-prompt-lens">{lens}</aside>
      </main>
    );
  }

  const practice = snapshot.mode === "practice";

  return (
    <main className="game-page">
      <section className="game-scorebar">
        {practice ? (
          <PracticeScoreCard score={snapshot.scores.cobalt + snapshot.scores.coral} seats={snapshot.seats} artistId={snapshot.artistSeatId} />
        ) : (
          <TeamScore team="cobalt" score={snapshot.scores.cobalt} active={snapshot.activeTeam === "cobalt"} seats={snapshot.seats} artistId={snapshot.artistSeatId} />
        )}
        <TimerDial
          seconds={seconds}
          progress={timerProgress}
          urgent={snapshot.phase === "drawing" && seconds <= 15}
          phasePrefix={snapshot.phase === "round-prep" ? "PREP · " : snapshot.phase === "round-end" ? "RESULT · " : ""}
          roundIndex={snapshot.roundIndex}
          totalRounds={snapshot.totalRounds}
          label={timerLabel}
        />
        {practice ? (
          <ArtistCard artist={artist ?? null} isPrep={isPrep} />
        ) : (
          <TeamScore team="coral" score={snapshot.scores.coral} active={snapshot.activeTeam === "coral"} seats={snapshot.seats} artistId={snapshot.artistSeatId} />
        )}
      </section>

      <LiveGuessBanner guesses={snapshot.guesses} roundIndex={snapshot.roundIndex} />

      {snapshot.phase === "round-end" ? (
        <RoundEnd snapshot={snapshot} seatId={seatId} seconds={seconds} onNext={() => onCommand({ type: "ready_next", expectedRoundIndex: snapshot.roundIndex, origin: "human-ui" })} busy={busy} lens={lens} />
      ) : (
        <div className="game-layout">
          <section className="play-column">
            <div className={`role-banner team-${snapshot.activeTeam}`}>
              <span className="role-icon">{humanArtist ? <PencilIcon /> : agentArtist ? <BotIcon /> : <SparkIcon />}</span>
              <div>
                <small>{roleLabel}</small>
                <strong>{roleMessage}</strong>
                {humanArtist && prompt && privatePromptGate !== "hidden" ? <span>{prompt.category} · do not write words or letters</span> : null}
              </div>
              {agentArtist || agentGuesser || prepPrimaryAgentGuesser ? <span className="agent-ready-pill"><span className="pulse-dot" /> WebMCP tools ready</span> : null}
            </div>

            <CanvasBoard events={snapshot.canvas} canvasVersion={snapshot.canvasVersion} canDraw={humanArtist} busy={busy} artistLabel={artist?.name} onDraw={draw} onUndo={undo} />

            {humanGuesser ? <form className="guess-composer" onSubmit={(event) => void submitGuess(event)}>
              <span className="guess-pencil"><PencilIcon /></span><label><span className="sr-only">Your guess</span><input autoFocus value={guess} onChange={(event) => setGuess(event.target.value)} maxLength={80} placeholder="What is the drawing?" autoComplete="off" /></label>
              <button className="primary-button" type="submit" disabled={busy || !guess.trim()}>Guess <ArrowIcon /></button>
            </form> : agentGuesser ? <div className="agent-guess-note"><BotIcon /><div><strong>{primaryAgentGuesser ? <>Use <code>get_match_state</code>, then <code>submit_guesses</code>.</> : <>Your agent has <code>submit_guesses</code>.</>}</strong><span>{primaryAgentGuesser ? "Send broad candidates immediately, then inspect every new canvas version." : "Ask it to inspect the canvas and submit every best guess."}</span></div></div> : prepGuesser ? <div className="guess-locked-note" role="status"><span className="pulse-dot" /><div><strong>Guessing opens with the first stroke.</strong><span>The {roundDurationSeconds}-second clock and <code>submit_guesses</code> activate together.</span></div></div> : null}
          </section>

          <aside className="game-sidebar">
            <GuessFeed snapshot={snapshot} />
            {lens}
          </aside>
        </div>
      )}
    </main>
  );
}

function TeamScore({ team, score, active, seats, artistId }: { team: TeamId; score: number; active: boolean; seats: RoomSnapshot["seats"]; artistId: string | null }) {
  return <div className={`team-score team-${team} ${active ? "is-active" : ""}`}><span className="team-pattern" /><div><small>TEAM {team.toUpperCase()}</small><strong>{score}</strong></div><div className="score-avatars">{seats.filter((seat) => seat.team === team).map((seat) => <span key={seat.id} className={`mini-avatar ${seat.id === artistId ? "is-artist" : ""}`}>{seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}</span>)}</div></div>;
}

function PracticeScoreCard({ score, seats, artistId }: { score: number; seats: RoomSnapshot["seats"]; artistId: string | null }) {
  return (
    <div className="team-score practice-score is-active">
      <span className="team-pattern" />
      <div><small>PAIR POINTS</small><strong>{score}</strong></div>
      <div className="score-avatars">
        {seats.map((seat) => (
          <span key={seat.id} className={`mini-avatar ${seat.id === artistId ? "is-artist" : ""}`}>
            {seat.controller === "agent" ? <BotIcon /> : seat.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function ArtistCard({ artist, isPrep }: { artist: RoomSnapshot["seats"][number] | null; isPrep: boolean }) {
  return (
    <div className="artist-card">
      <span className={`avatar ${artist?.controller ?? "human"}`} aria-hidden="true">
        {artist?.controller === "agent" ? <BotIcon /> : artist?.name.slice(0, 1).toUpperCase() ?? "?"}
      </span>
      <div>
        <small>{isPrep ? "OPENING STROKE" : "NOW DRAWING"}</small>
        <strong>{artist?.name ?? "…"}</strong>
        <span>{artist?.controller === "agent" ? "Browser agent" : "Human player"}</span>
      </div>
      <PencilIcon />
    </div>
  );
}

function TimerDial({ seconds, progress, urgent, phasePrefix, roundIndex, totalRounds, label }: {
  seconds: number;
  progress: number;
  urgent: boolean;
  phasePrefix: string;
  roundIndex: number;
  totalRounds: number;
  label: string;
}) {
  return (
    <div className={`round-timer ${urgent ? "is-urgent" : ""}`} style={{ "--timer-progress": progress } as React.CSSProperties}>
      <span className="timer-dial" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle className="dial-ticks" cx="50" cy="50" r="43" pathLength={60} />
          <circle className="dial-track" cx="50" cy="50" r="43" pathLength={1} />
          <circle className="dial-fill" cx="50" cy="50" r="43" pathLength={1} />
        </svg>
        <b className="dial-knob" />
      </span>
      <div className="timer-readout">
        <small>{phasePrefix}ROUND {roundIndex + 1} / {totalRounds}</small>
        <strong>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function GuessFeed({ snapshot }: { snapshot: RoomSnapshot }) {
  const listRef = useRef<HTMLDivElement>(null);
  const guesses = snapshot.guesses
    .filter((guess) => guess.roundIndex === snapshot.roundIndex)
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [guesses.map((guess) => guess.id).join(":")]);

  return <section className="guess-feed"><header><div><span className="eyebrow">Every accepted guess</span><h3>Live guesses</h3></div><span>{guesses.length}</span></header><div ref={listRef} className="guess-list" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Live guess history" tabIndex={0}>
    {guesses.map((guess) => <GuessEntry guess={guess} key={guess.id} />)}
    {!guesses.length ? <div className="empty-guesses"><span>?</span><p>No guesses yet.<br />Be brave. Be wrong fast.</p></div> : null}
  </div></section>;
}

function GuessEntry({ guess }: { guess: GuessEvent }) {
  return <article className={guess.isCorrect ? "is-correct" : ""}>
    <span className={`avatar tiny ${guess.origin === "webmcp" ? "agent" : "human"}`}>{guess.origin === "webmcp" ? <BotIcon /> : guess.displayName.slice(0, 1).toUpperCase()}</span>
    <div><strong>{guess.displayName}<small>{guess.origin === "webmcp" ? "via WebMCP" : "human"}</small></strong><p>{guess.guess}</p></div>
    {guess.isCorrect ? <span className="correct-guess-label"><CheckIcon /> Correct</span> : null}
  </article>;
}

function LiveGuessBanner({ guesses, roundIndex }: { guesses: GuessEvent[]; roundIndex: number }) {
  const roundRef = useRef(roundIndex);
  const seenRef = useRef(new Set(guesses.filter((guess) => guess.roundIndex === roundIndex).map((guess) => guess.id)));
  const [queue, setQueue] = useState<GuessEvent[]>([]);
  const [active, setActive] = useState<GuessEvent | null>(null);

  useEffect(() => {
    const roundChanged = roundRef.current !== roundIndex;
    if (roundChanged) {
      roundRef.current = roundIndex;
      seenRef.current.clear();
      setActive(null);
    }
    const arrivals = guesses
      .filter((guess) => guess.roundIndex === roundIndex && !seenRef.current.has(guess.id))
      .sort((left, right) => left.createdAt - right.createdAt);
    arrivals.forEach((guess) => seenRef.current.add(guess.id));
    if (roundChanged || arrivals.length) {
      setQueue((current) => roundChanged ? arrivals : [...current, ...arrivals]);
    }
  }, [guesses, roundIndex]);

  useEffect(() => {
    if (active || queue.length === 0) return;
    const [next, ...rest] = queue;
    setActive(next ?? null);
    setQueue(rest);
  }, [active, queue]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(null), active.isCorrect ? 3_400 : 2_450);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!active) return null;
  return <div className={`live-guess-banner ${active.origin === "webmcp" ? "is-agent" : "is-human"} ${active.isCorrect ? "is-correct" : ""}`} role="status" aria-live="assertive">
    <span className="live-guess-avatar">{active.origin === "webmcp" ? <BotIcon /> : active.displayName.slice(0, 1).toUpperCase()}</span>
    <div><small>{active.displayName} · {active.origin === "webmcp" ? "via WebMCP" : "human"}</small><strong>“{active.guess}”</strong></div>
    {active.isCorrect ? <span className="live-guess-correct"><CheckIcon /> Correct!</span> : null}
  </div>;
}

function RoundEnd({ snapshot, seatId, seconds, onNext, busy, lens }: { snapshot: RoomSnapshot; seatId: string; seconds: number; onNext(): Promise<unknown>; busy: boolean; lens: React.ReactNode }) {
  const result = snapshot.roundResult;
  const modeName = getModeDefinition(snapshot.mode).name;
  const finalRound = snapshot.roundIndex + 1 >= snapshot.totalRounds;
  const self = snapshot.seats.find((seat) => seat.id === seatId);
  const artist = snapshot.seats.find((seat) => seat.id === snapshot.artistSeatId);
  const liveSeats = snapshot.seats.filter((seat) => seat.isConnected);
  const readyCount = liveSeats.filter((seat) => seat.isReady).length;
  const guesses = snapshot.guesses
    .filter((guess) => guess.roundIndex === snapshot.roundIndex)
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt);
  const drawing = snapshot.canvas
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt);
  const selfReady = self?.isReady ?? false;
  const solved = Boolean(result?.pointsAwarded);

  return (
    <div className="round-end-layout">
      <section className="round-result-card">
        <span className="eyebrow">{modeName} · Round {snapshot.roundIndex + 1} of {snapshot.totalRounds} complete</span>
        <h1>{solved ? "That was the idea!" : "Time’s up!"}</h1>
        <p className="revealed-answer-label">The word was</p>
        <p className={`revealed-answer ${solved ? "is-solved" : "is-missed"}`}>
          <svg className="answer-circle" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M22 55C40 24 116 12 194 16c62 3 88 18 84 38-5 26-72 36-146 33C64 84 18 74 22 51" />
          </svg>
          {result?.prompt ?? "Prompt unavailable"}
        </p>
        <div className="round-stat-row">
          <div><small>Points</small><strong>+{result?.pointsAwarded ?? 0}</strong></div>
          <div><small>Guessed in</small><strong>{result?.elapsedMs ? `${(result.elapsedMs / 1000).toFixed(1)}s` : "—"}</strong></div>
          <div><small>Vector marks</small><strong>{result?.strokeCount ?? 0}</strong></div>
          <div><small>WebMCP calls</small><strong>{result?.toolCallCount ?? 0}</strong></div>
        </div>
        <div className="result-transition" role="status" aria-live="polite">
          <span className="result-countdown">{seconds > 0 ? `0:${String(seconds).padStart(2, "0")}` : "Advancing…"}</span>
          <div>
            <strong>{finalRound ? "Match results unlock after the scoreboard." : "The next round opens after the scoreboard."}</strong>
            <small>Results remain visible for at least 8 seconds · {readyCount}/{liveSeats.length} connected players ready</small>
          </div>
        </div>
        {self?.controller === "human" ? (
          <button className="primary-button jumbo next-page-button" type="button" onClick={() => void onNext()} disabled={busy || selfReady}>
            {selfReady ? <><CheckIcon /> Ready recorded</> : <>{finalRound ? "Ready for match results" : `Ready for round ${snapshot.roundIndex + 2}`}<ArrowIcon /></>}
          </button>
        ) : (
          <div className={`agent-guess-note ${selfReady ? "is-ready" : ""}`}>
            <BotIcon />
            <div>
              <strong>{selfReady ? "Agent readiness recorded." : <>Your agent has <code>ready_next</code>.</>}</strong>
              <span>{selfReady ? "The authoritative results countdown controls the transition." : "Ask it to continue through WebMCP; the results stay visible for at least 8 seconds."}</span>
            </div>
          </div>
        )}
      </section>

      <section className="sketch-review-card" aria-label={`Round ${snapshot.roundIndex + 1} finished drawing`}>
        <span className="tape" aria-hidden="true" />
        <header>
          <span className="eyebrow">Sketch review</span>
          <h2>{artist ? `Drawn by ${artist.name}` : "The finished sketch"}</h2>
        </header>
        <svg className="finished-drawing" viewBox="0 0 1000 700" role="img" aria-label={`Finished round ${snapshot.roundIndex + 1} drawing`}>
          <rect width="1000" height="700" rx="18" fill="#fffdf7" />
          {drawing.map((event) => (
            <PrimitiveMark key={event.id} primitive={event.primitive} origin={event.origin} />
          ))}
          {drawing.length === 0 ? (
            <text x="500" y="360" textAnchor="middle" fontSize="40" fill="#a39b8a" fontFamily="Caveat, cursive">
              (a perfectly blank page)
            </text>
          ) : null}
        </svg>
        <p className="sketch-review-note">
          {artist?.controller === "agent" ? <><BotIcon /> Drawn stroke-by-stroke through WebMCP</> : <><PeopleIcon /> Drawn by hand in the browser</>}
          <span>{drawing.length} {drawing.length === 1 ? "mark" : "marks"}</span>
        </p>
      </section>

      <section className="round-guess-history" aria-label={`Every guess from round ${snapshot.roundIndex + 1}`}>
        <header>
          <div><span className="eyebrow">Complete transcript</span><h2>Every guess this round</h2></div>
          <span>{guesses.length}</span>
        </header>
        <div className="round-guess-list">
          {guesses.map((guess) => <GuessEntry guess={guess} key={guess.id} />)}
          {guesses.length === 0 ? <p className="no-round-guesses">No accepted guesses this round.</p> : null}
        </div>
      </section>

      <aside className="round-lens">{lens}</aside>
    </div>
  );
}

function MatchEnd({ snapshot, seatId, lens, onReplay, onPlayAgain }: { snapshot: RoomSnapshot; seatId: string; lens: React.ReactNode; onReplay(signal?: AbortSignal): Promise<ReplayPayload>; onPlayAgain(): void }) {
  const [replay, setReplay] = useState<ReplayPayload | null>(null);
  const [replayLoading, setReplayLoading] = useState(true);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayAttempt, setReplayAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReplayLoading(true);
    setReplayError(null);
    onReplay(controller.signal).then((payload) => {
      setReplay(payload);
      setReplayLoading(false);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setReplayError(reason instanceof Error ? reason.message : "Could not load the full match replay.");
      setReplayLoading(false);
    });
    return () => controller.abort();
  }, [onReplay, replayAttempt]);
  const winner: TeamId | "tie" = snapshot.scores.cobalt === snapshot.scores.coral ? "tie" : snapshot.scores.cobalt > snapshot.scores.coral ? "cobalt" : "coral";
  const self = snapshot.seats.find((seat) => seat.id === seatId);
  const practice = snapshot.mode === "practice";
  const exhibition = snapshot.mode === "exhibition";
  const practiceTurnsEach = snapshot.totalRounds / 2;
  const practiceTurnLabel = practiceTurnsEach === 1 ? "drawing" : "drawings";
  return (
    <main className="match-end-page">
      <section className={`winner-banner ${winner !== "tie" && !practice ? `winner-${winner}` : ""}`}>
        <span className="winner-rosette" aria-hidden="true">
          <b>{practice ? "SKETCH" : "BEST IN"}</b>
          <strong>{practice ? "DUO" : "SHOW"}</strong>
        </span>
        <div className="winner-banner-copy">
          <span className="eyebrow">{practice ? `${snapshot.totalRounds}-round Practice Pair complete` : exhibition ? "Exhibition final" : "Team Arena final"}</span>
          <h1>{practice ? "You and your agent speak sketch." : winner === "tie" ? "A perfect draw." : exhibition ? `${winner === "cobalt" ? "Cobalt" : "Coral"} owns the exhibition.` : `${winner === "cobalt" ? "Cobalt" : "Coral"} takes the sketchbook!`}</h1>
          <p>{practice ? `${practiceTurnsEach} agent ${practiceTurnLabel}. ${practiceTurnsEach} human ${practiceTurnLabel}. ${snapshot.totalRounds} rounds of two-way WebMCP play.` : exhibition ? "Same canvas. Same rules. Human and agent provenance preserved." : winner === "tie" || self?.team === winner ? "Human imagination. Agent precision. Excellent teamwork." : "A noble scribble. The rematch button is implied."}</p>
        </div>
        {practice ? (
          <div className="practice-complete" aria-hidden="true"><PeopleIcon /><span>↔</span><BotIcon /></div>
        ) : (
          <div className="final-score"><span className="cobalt">{snapshot.scores.cobalt}</span><small>—</small><span className="coral">{snapshot.scores.coral}</span></div>
        )}
      </section>
      <div className="end-content">
        <ReplayViewer events={snapshot.canvas} guesses={snapshot.guesses} analytics={snapshot.analytics} result={snapshot.roundResult} replay={replay} loading={replayLoading} error={replayError} onRetry={() => setReplayAttempt((attempt) => attempt + 1)} />
        <aside>
          {lens}
          <button className="secondary-button full" type="button" onClick={onPlayAgain}>Play another match</button>
        </aside>
      </div>
    </main>
  );
}

function LoadingScreen() {
  return <main className="loading-screen"><span className="brand-mark giant"><PencilIcon /></span><h1>MCPencil</h1><p>Sharpening the room…</p><div className="loading-scribble" /></main>;
}
