import { useEffect, useRef, useState, type ReactNode } from "react";
import { flipDirection, type FlipbookView, type FlipDirection } from "../flipbook";

const COVER_OPENED_KEY = "mcpencil.cover-opened.v1";

interface TurnState {
  /** Monotonic counter so consecutive turns remount and replay the animation. */
  turnCount: number;
  direction: FlipDirection;
  fromLabel: string;
  fromFolio: string;
}

type CoverState = "closed" | "opening" | "open";

function coverAlreadyOpened(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return true;
    return sessionStorage.getItem(COVER_OPENED_KEY) === "1";
  } catch {
    return true;
  }
}

function rememberCoverOpened() {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(COVER_OPENED_KEY, "1");
  } catch {
    // Private browsing without storage: the cover simply replays next visit.
  }
}

export function FlipbookShell({
  view,
  children,
}: {
  view: FlipbookView;
  children: ReactNode;
}) {
  const lastViewRef = useRef(view);
  const [turn, setTurn] = useState<TurnState | null>(null);
  const [cover, setCover] = useState<CoverState>(() =>
    view.key === "landing" && !coverAlreadyOpened() ? "closed" : "open",
  );

  useEffect(() => {
    const from = lastViewRef.current;
    if (from.key === view.key) return;
    lastViewRef.current = view;
    setTurn((current) => ({
      turnCount: (current?.turnCount ?? 0) + 1,
      direction: flipDirection(from, view),
      fromLabel: from.label,
      fromFolio: from.folio,
    }));
  }, [view]);

  useEffect(() => {
    if (cover !== "closed") return;
    const timer = setTimeout(() => setCover("opening"), 420);
    return () => clearTimeout(timer);
  }, [cover]);

  return (
    <div className="flipbook-stage" data-page-tone={view.tone} data-cover={cover}>
      <DeskProps />

      <div className="flipbook-pad">
        <div className="flipbook-backboard" aria-hidden="true" />
        <div className="flipbook-page-stack" aria-hidden="true">
          <i /><i /><i />
        </div>

        <section className="flipbook-sheet" aria-label={`${view.label} sketchpad page`}>
          <div className="flipbook-folio-strip" aria-hidden="true">
            <span className="folio-label">{view.label}</span>
            <strong className="folio-number">{view.folio}</strong>
          </div>
          <div className="flipbook-page-body">{children}</div>
          <div className="flipbook-page-curl" aria-hidden="true" />
        </section>

        {turn ? (
          <div
            className="flipbook-turn-leaf"
            key={turn.turnCount}
            data-direction={turn.direction}
            aria-hidden="true"
          >
            <span className="turn-leaf-front">
              <GhostScribble />
              <span className="turn-leaf-meta">
                <em>{turn.fromLabel}</em>
                <b>{turn.fromFolio}</b>
              </span>
            </span>
            <span className="turn-leaf-back" />
            <span className="turn-leaf-shade" />
          </div>
        ) : null}

        <div className="flipbook-binding" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
        </div>

        <div
          className="flipbook-cover"
          aria-hidden="true"
          data-state={cover}
          onAnimationEnd={(event) => {
            if (event.animationName === "cover-open") {
              rememberCoverOpened();
              setCover("open");
            }
          }}
        >
          <span className="flipbook-cover-elastic" />
          <div className="flipbook-cover-label">
            <small>Browser sketchbook · No. 01</small>
            <strong>MCP<span>encil</span></strong>
            <em>Humans and agents.<br />Same page.</em>
            <b>Opening the pad…</b>
          </div>
        </div>

        <span className="flipbook-page-tab" aria-hidden="true">{view.tone}</span>
      </div>
    </div>
  );
}

/** Faint generic pencil ghosting on the back of the turning page. Never real content. */
function GhostScribble() {
  return (
    <svg className="turn-leaf-ghost" viewBox="0 0 400 280" aria-hidden="true">
      <path d="M60 90c40-36 90-42 128-16 34 24 40 68 12 96-24 24-64 24-84 2" />
      <path d="M240 190c30-8 60-6 96 8M244 210c26-4 50-2 78 6" />
      <circle cx="300" cy="96" r="34" />
      <path d="M74 208l50 14m-44 6 38 10" />
    </svg>
  );
}

function DeskProps() {
  return (
    <div className="desk-props" aria-hidden="true">
      <svg className="desk-prop desk-pencil" viewBox="0 0 200 34">
        <path d="M8 21 26 9l152 3 8 8-10 8-152 1-16-8Z" fill="#f2bd35" stroke="#17191d" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M26 9l-1 19" stroke="#17191d" strokeWidth="2" />
        <path d="M8 21 26 9l4 4-14 12-8-4Z" fill="#f8e2b6" stroke="#17191d" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="13" cy="20" r="2.6" fill="#17191d" />
        <path d="M178 12h14a6 6 0 0 1 0 12h-14z" fill="#ef654f" stroke="#17191d" strokeWidth="2.4" />
      </svg>
      <svg className="desk-prop desk-coffee" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(64, 34, 8, 0.35)" strokeWidth="9" />
        <circle cx="60" cy="60" r="41" fill="none" stroke="rgba(64, 34, 8, 0.18)" strokeWidth="4" />
      </svg>
      <svg className="desk-prop desk-eraser" viewBox="0 0 90 46">
        <rect x="4" y="8" width="82" height="32" rx="7" fill="#ef654f" stroke="#17191d" strokeWidth="2.6" />
        <rect x="4" y="8" width="30" height="32" rx="7" fill="#3157d5" stroke="#17191d" strokeWidth="2.6" />
      </svg>
      <svg className="desk-prop desk-shavings" viewBox="0 0 120 60">
        <path d="M12 40c10-16 22-18 30-8s2 22-8 24m32-44c14-8 26-2 28 10s-10 22-20 18" fill="none" stroke="rgba(70, 40, 10, 0.5)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <svg className="desk-prop desk-sticky" viewBox="0 0 110 110">
        <path d="M8 12 100 6l4 88-74 10L8 12Z" fill="#fde28a" stroke="rgba(120, 86, 10, 0.4)" strokeWidth="2" />
        <path d="M26 38c18-8 40-8 58-2M28 58c16-6 36-6 52-2M32 78c12-4 26-4 38-1" fill="none" stroke="rgba(105, 74, 6, 0.5)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}
