import { useEffect, useMemo, useState } from "react";
import type { CanvasEvent, GuessEvent, MatchAnalytics, RoundResult } from "../../shared/game";
import type { ReplayPayload } from "../api";
import { summarizeReplayRound } from "../replayStats";
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
  const roundSummary = useMemo(
    () => summarizeReplayRound(roundEvents, roundGuesses, selectedRound),
    [roundEvents, roundGuesses, selectedRound],
  );
  const matchAnalytics = replayData?.analytics ?? analytics;
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
    return <section className="replay-panel replay-status-panel" aria-busy="true"><span className="button-spinner" /><div><span className="eyebrow">Opening the match sketchbook</span><h2>Gathering every mark and guess…</h2><p>The score is ready. The server-authoritative replay is catching up.</p></div></section>;
  }

  if (error && !replayData) {
    return <section className="replay-panel replay-status-panel" role="alert"><span className="replay-error-mark">!</span><div><span className="eyebrow">Replay unavailable</span><h2>We could not load the complete match history.</h2><p>{error}</p>{onRetry ? <button className="secondary-button" type="button" onClick={onRetry}><ReplayIcon /> Try replay again</button> : null}</div></section>;
  }

  return (
    <section className="replay-panel match-sketchbook">
      <div className="section-heading replay-heading">
        <div className="replay-heading-copy">
          <span className="eyebrow">Match sketchbook · Round {selectedRound + 1}</span>
          <h2>Replay the handoff</h2>
          <p>Every mark and guess keeps its human or WebMCP provenance.</p>
        </div>
        <div className="replay-actions">
          {replayData && replayData.rounds.length > 1 ? <label className="replay-round-picker"><span>Round</span><select aria-label="Replay round" value={selectedRound} onChange={(event) => setSelectedRound(Number(event.target.value))}>{replayData.rounds.map((round) => <option value={round.roundIndex} key={round.roundIndex}>Round {round.roundIndex + 1}</option>)}</select></label> : null}
          <button className="secondary-button" type="button" onClick={replayRound} disabled={!ordered.length}><ReplayIcon /> Replay round</button>
        </div>
      </div>
      <div className="replay-grid">
        <div className="replay-canvas-column">
          <div className="replay-canvas-wrap">
            <span className="replay-tape" aria-hidden="true" />
            <svg viewBox="0 0 1000 700" className="replay-canvas" role="img" aria-labelledby={`replay-title-${selectedRound}`}>
              <title id={`replay-title-${selectedRound}`}>Round {selectedRound + 1} drawing replay</title>
              <rect width="1000" height="700" rx="18" fill="#fffdf7" />
              {ordered.slice(0, visible).map((event) => <PrimitiveMark key={event.id} primitive={event.primitive} origin={event.origin} />)}
            </svg>
            <div className="replay-scrubber">
              <input type="range" min="0" max={Math.max(1, ordered.length)} value={visible} disabled={!ordered.length} onChange={(event) => { setPlaying(false); setVisible(Number(event.target.value)); }} aria-label="Replay position" />
              <span>{visible} / {ordered.length} marks</span>
            </div>
          </div>
          <div className="replay-origin-key" aria-label="Drawing provenance">
            <span className="provenance-chip is-agent"><BotIcon /> WebMCP agent <strong>{roundSummary.agentDrawingMarks} marks</strong></span>
            <span className="provenance-chip is-human"><span aria-hidden="true">H</span> Human UI <strong>{roundSummary.humanDrawingMarks} marks</strong></span>
          </div>
        </div>
        <aside className="replay-scorecard" aria-label={`Round ${selectedRound + 1} scorecard`}>
          <header><span>Round card</span><strong>#{selectedRound + 1}</strong></header>
          <div className="analytics-grid">
            <StatCard label="Answer" value={selected?.prompt ?? result?.prompt ?? "—"} accent />
            <StatCard label="Time to solve" value={selected ? `${(Math.max(0, selected.endedAt - selected.startedAt) / 1000).toFixed(1)}s` : result ? `${(result.elapsedMs / 1000).toFixed(1)}s` : "—"} note="this round" />
            <StatCard label="Vector marks" value={String(replayData ? roundSummary.vectorMarks : (result?.strokeCount ?? roundSummary.vectorMarks))} note="this round" />
            <StatCard label="All guesses" value={String(roundSummary.allGuesses)} note="this round" />
            <StatCard label="Agent drawing moves" value={String(roundSummary.agentDrawingMoves)} note={`${roundSummary.agentDrawingMarks} vector marks`} provenance="agent" />
            <StatCard label="Agent guesses" value={String(roundSummary.agentGuesses)} note="via WebMCP" provenance="agent" />
            <StatCard label="Human UI actions" value={String(roundSummary.humanUiActions)} note="draw moves + guesses" provenance="human" />
            <StatCard label="Server-recorded WebMCP actions" value={String(matchAnalytics.totalToolCalls)} note="accepted room mutations · whole match" provenance="agent" />
          </div>
          <p className="replay-scorecard-note">Round provenance comes from accepted canvas and guess events. Tool calls come from the server activity log.</p>
        </aside>
        <section className="replay-guess-history" aria-label={`Every guess from round ${selectedRound + 1}`}>
          <header><div><span className="eyebrow">Guess cards · Round {selectedRound + 1}</span><h3>Every attempt, in order</h3></div><span aria-label={`${roundGuesses.length} guesses`}>{roundGuesses.length}</span></header>
          <div className="replay-guess-list">
            {roundGuesses.map((guess) => <article key={guess.id} className={`${guess.isCorrect ? "is-correct " : ""}origin-${guess.origin}`}>
              <span className={`replay-guess-avatar ${guess.origin === "webmcp" ? "agent" : "human"}`}>{guess.origin === "webmcp" ? <BotIcon /> : guess.displayName.slice(0, 1).toUpperCase()}</span>
              <div><strong>{guess.displayName}</strong><small className="guess-provenance">{guess.origin === "webmcp" ? "WebMCP agent" : "Human UI"} · {formatGuessElapsed(guess.createdAt, selected?.startedAt)}</small><p>{guess.guess}</p></div>
              {guess.isCorrect ? <span className="replay-correct"><CheckIcon /> Correct</span> : null}
            </article>)}
            {roundGuesses.length === 0 ? <p className="replay-no-guesses">No guesses were submitted in this round.</p> : null}
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

function StatCard({
  label,
  value,
  accent = false,
  note,
  provenance,
}: {
  label: string;
  value: string;
  accent?: boolean;
  note?: string;
  provenance?: "agent" | "human";
}) {
  return <article className={`stat-card ${accent ? "is-accent" : ""} ${provenance ? `is-${provenance}` : ""}`}><small>{label}</small><strong>{value}</strong>{note ? <span>{note}</span> : null}</article>;
}
