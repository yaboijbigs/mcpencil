import { useEffect, useMemo, useState } from "react";
import type { CanvasEvent, MatchAnalytics, RoundResult } from "../../shared/game";
import type { ReplayPayload } from "../api";
import { PrimitiveMark } from "./CanvasBoard";
import { ReplayIcon } from "./Icons";

interface ReplayViewerProps {
  events: CanvasEvent[];
  analytics: MatchAnalytics;
  result: RoundResult | null;
  replay?: ReplayPayload | null;
}

export function ReplayViewer({ events, analytics, result, replay: replayData }: ReplayViewerProps) {
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
  const [visible, setVisible] = useState(ordered.length);
  const [playing, setPlaying] = useState(false);

  useEffect(() => setVisible(ordered.length), [ordered.length]);
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
          <StatCard label="Agent tool calls" value={String(selected ? new Set(ordered.filter((event) => event.origin === "webmcp").map((event) => event.batchId)).size : result?.toolCallCount ?? analytics.totalToolCalls)} />
          <StatCard label="Human actions" value={String(analytics.byOrigin["human-ui"])} />
          <StatCard label="WebMCP actions" value={String(analytics.byOrigin.webmcp)} />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <article className={`stat-card ${accent ? "is-accent" : ""}`}><small>{label}</small><strong>{value}</strong></article>;
}
