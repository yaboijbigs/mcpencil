import { useEffect, useMemo, useState } from "react";
import type { CanvasEvent, GuessEvent, MatchAnalytics, RoundResult } from "../../shared/game";
import type { ReplayPayload } from "../api";
import { PrimitiveMark } from "./CanvasBoard";
import { BotIcon, CheckIcon, ReplayIcon } from "./Icons";

interface ReplayViewerProps {
  events: CanvasEvent[];
  guesses?: GuessEvent[];
  analytics: MatchAnalytics;
  result: RoundResult | null;
  replay?: ReplayPayload | null;
  loading?: boolean;
  error?: string | null;
  onRetry?(): void;
}

export function ReplayViewer({
  events,
  guesses = [],
  analytics,
  result,
  replay: replayData,
  loading = false,
  error = null,
  onRetry,
}: ReplayViewerProps) {
  const [selectedRound, setSelectedRound] = useState(
    replayData?.rounds.at(-1)?.roundIndex ?? result?.roundIndex ?? 0,
  );
  const roundEvents = useMemo(
    () =>
      replayData
        ? replayData.canvas.filter((event) => event.roundIndex === selectedRound && !event.reverted)
        : events,
    [events, replayData, selectedRound],
  );
  const selected = replayData?.rounds.find((round) => round.roundIndex === selectedRound);
  const ordered = useMemo(() => roundEvents.slice().sort((a, b) => a.createdAt - b.createdAt), [roundEvents]);
  const roundGuesses = useMemo(
    () => (replayData?.guesses ?? guesses)
      .filter((guess) => guess.roundIndex === selectedRound)
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt),
    [guesses, replayData, selectedRound],
  );
  const agentGuessCount = roundGuesses.filter((guess) => guess.origin === "webmcp").length;
  const humanGuessCount = roundGuesses.length - agentGuessCount;
  const agentDrawCallCount = new Set(
    ordered.filter((event) => event.origin === "webmcp").map((event) => event.batchId),
  ).size;
  const [visible, setVisible] = useState(ordered.length);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!replayData?.rounds.some((round) => round.roundIndex === selectedRound)) {
      const lastRound = replayData?.rounds.at(-1)?.roundIndex;
      if (lastRound !== undefined) setSelectedRound(lastRound);
    }
  }, [replayData, selectedRound]);
  useEffect(() => setVisible(ordered.length), [ordered.length, selectedRound]);
  useEffect(() => {
    if (!playing) return;
    if (visible >= ordered.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible((count) => count + 1), 140);
    return () => window.clearTimeout(timer);
  }, [ordered.length, playing, visible]);

  const replayRound = () => {
    setVisible(0);
    setPlaying(true);
  };

  if (loading && !replayData) {
    return <section className="replay-panel replay-status-panel" aria-busy="true"><span className="button-spinner" /><div><span className="eyebrow">Loading canonical event log</span><h2>Assembling every drawing and guess…</h2><p>The final scoreboard is ready; the full replay is catching up.</p></div></section>;
  }

  if (error && !replayData) {
    return <section className="replay-panel replay-status-panel" role="alert"><span className="replay-error-mark">!</span><div><span className="eyebrow">Replay unavailable</span><h2>We could not load the complete match history.</h2><p>{error}</p>{onRetry ? <button className="secondary-button" type="button" onClick={onRetry}><ReplayIcon /> Try replay again</button> : null}</div></section>;
  }

  return (
    <section className="replay-panel">
      <div className="section-heading">
        <div><span className="eyebrow">Canonical event log</span><h2>Watch the idea appear</h2></div>
        <div className="replay-actions">
          {replayData && replayData.rounds.length > 1 ? <label><span className="sr-only">Replay round</span><select value={selectedRound} onChange={(event) => setSelectedRound(Number(event.target.value))}>{replayData.rounds.map((round) => <option value={round.roundIndex} key={round.roundIndex}>Round {round.roundIndex + 1}</option>)}</select></label> : null}
          <button className="secondary-button" type="button" onClick={replayRound} disabled={!ordered.length}><ReplayIcon /> Replay round</button>
        </div>
      </div>
      <div className="replay-grid">
        <div className="replay-canvas-wrap">
          <svg viewBox="0 0 1000 700" className="replay-canvas" aria-label="Round replay">
            <rect width="1000" height="700" rx="18" fill="#fffdf7" />
            {ordered.slice(0, visible).map((event) => <PrimitiveMark key={event.id} primitive={event.primitive} origin={event.origin} />)}
          </svg>
          <div className="replay-scrubber">
            <input type="range" min="0" max={Math.max(1, ordered.length)} value={visible} onChange={(event) => { setPlaying(false); setVisible(Number(event.target.value)); }} aria-label="Replay position" />
            <span>{visible} / {ordered.length} strokes</span>
          </div>
        </div>
        <div className="analytics-grid">
          <StatCard label="Answer" value={selected?.prompt ?? result?.prompt ?? "—"} accent />
          <StatCard label="Time to guess" value={selected ? `${((selected.endedAt - selected.startedAt) / 1000).toFixed(1)}s` : result ? `${(result.elapsedMs / 1000).toFixed(1)}s` : "—"} />
          <StatCard label="Vector strokes" value={String(selected ? ordered.length : result?.strokeCount ?? analytics.totalStrokes)} />
          <StatCard label="Agent round moves" value={String(selected ? agentDrawCallCount + agentGuessCount : result?.toolCallCount ?? analytics.totalToolCalls)} />
          <StatCard label="Human actions" value={String(analytics.byOrigin["human-ui"])} />
          <StatCard label="WebMCP actions" value={String(analytics.byOrigin.webmcp)} />
          <StatCard label="All guesses" value={String(roundGuesses.length)} />
          <StatCard label="Agent guesses" value={String(agentGuessCount)} />
          <StatCard label="Human guesses" value={String(humanGuessCount)} />
        </div>
        <section className="replay-guess-history" aria-label={`Every guess from round ${selectedRound + 1}`}>
          <header><div><span className="eyebrow">Complete guess log</span><h3>Every guess</h3></div><span>{roundGuesses.length}</span></header>
          <div className="replay-guess-list">
            {roundGuesses.map((guess) => <article key={guess.id} className={guess.isCorrect ? "is-correct" : ""}>
              <span className={`replay-guess-avatar ${guess.origin === "webmcp" ? "agent" : "human"}`}>{guess.origin === "webmcp" ? <BotIcon /> : guess.displayName.slice(0, 1).toUpperCase()}</span>
              <div><strong>{guess.displayName}</strong><small>{guess.origin === "webmcp" ? "via WebMCP" : "human"} · {formatGuessElapsed(guess.createdAt, selected?.startedAt)}</small><p>{guess.guess}</p></div>
              {guess.isCorrect ? <span className="replay-correct"><CheckIcon /> Correct</span> : null}
            </article>)}
            {roundGuesses.length === 0 ? <p className="replay-no-guesses">No accepted guesses in this round.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function formatGuessElapsed(createdAt: number, startedAt?: number) {
  if (startedAt === undefined) return "time unavailable";
  return `+${(Math.max(0, createdAt - startedAt) / 1000).toFixed(1)}s`;
}

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <article className={`stat-card ${accent ? "is-accent" : ""}`}><small>{label}</small><strong>{value}</strong></article>;
}
