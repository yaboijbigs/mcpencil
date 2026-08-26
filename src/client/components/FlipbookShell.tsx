import { useRef, type ReactNode } from "react";
import type { FlipbookView } from "../flipbook";

export function FlipbookShell({
  view,
  children,
}: {
  view: FlipbookView;
  children: ReactNode;
}) {
  const openingView = useRef(view.key);
  const shouldTurnPage = openingView.current !== view.key;

  return (
    <div className="flipbook-stage" data-page-tone={view.tone}>
      <div className="flipbook-page-stack" aria-hidden="true" />
      <div className="flipbook-binding" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
      </div>

      <section className="flipbook-sheet" aria-label={`${view.label} sketchpad page`}>
        <div className="flipbook-folio-strip" aria-hidden="true">
          <span>{view.label}</span>
          <strong>{view.folio}</strong>
        </div>
        <div className="flipbook-page-body">{children}</div>
        <div className="flipbook-page-curl" aria-hidden="true" />
      </section>

      {shouldTurnPage ? (
        <div className="flipbook-turn-leaf" key={view.key} aria-hidden="true">
          <span>Turning to</span>
          <strong>{view.label}</strong>
          <small>{view.folio}</small>
        </div>
      ) : null}

      <div className="flipbook-cover" aria-hidden="true">
        <span className="flipbook-cover-spine" />
        <div className="flipbook-cover-label">
          <small>Browser sketchbook · No. 01</small>
          <strong>MCP<span>encil</span></strong>
          <em>Humans and agents.<br />Same page.</em>
          <b>Lift the cover to play →</b>
        </div>
        <span className="flipbook-cover-elastic" />
      </div>

      <span className="flipbook-page-tab" aria-hidden="true">{view.tone}</span>
    </div>
  );
}
