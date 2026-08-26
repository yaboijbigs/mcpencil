import { useId, useState } from "react";
import type { ActivityEvent } from "../../shared/game";
import type {
  LensInvocation,
  ToolAuthorizationEvent,
  WebMcpProofContext,
  WebMcpToolDescriptorEvidence,
} from "../hooks/useWebMcpTools";
import { BotIcon, CheckIcon, ChevronIcon, EyeIcon, InfoIcon, XIcon } from "./Icons";

interface WebMcpLensProps {
  supported: boolean;
  /** Compatibility input for callers that have not yet adopted actionableTools. */
  tools?: string[];
  actionableTools?: string[];
  registeredTools?: WebMcpToolDescriptorEvidence[];
  context?: WebMcpProofContext;
  authorizationEvents?: ToolAuthorizationEvent[];
  invocations: LensInvocation[];
  activity: ActivityEvent[];
  defaultOpen?: boolean;
}

type TimelineItem =
  | { kind: "invocation"; createdAt: number; invocation: LensInvocation }
  | { kind: "activity"; createdAt: number; activity: ActivityEvent }
  | { kind: "authorization"; createdAt: number; authorization: ToolAuthorizationEvent };

export function WebMcpLens({
  supported,
  tools = [],
  actionableTools,
  registeredTools,
  context,
  authorizationEvents = [],
  invocations,
  activity,
  defaultOpen = true,
}: WebMcpLensProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<"tools" | "trace">("tools");
  const tabId = useId();
  const authorized = actionableTools ?? tools;
  const descriptors = registeredTools ?? authorized.map(legacyDescriptor);
  const timeline = buildTimeline(invocations, activity, authorizationEvents);
  const latestInvocation = invocations.length
    ? invocations.reduce((latest, candidate) => (candidate.startedAt > latest.startedAt ? candidate : latest))
    : null;
  const toolTabId = `${tabId}-tools-tab`;
  const traceTabId = `${tabId}-trace-tab`;
  const toolPanelId = `${tabId}-tools-panel`;
  const tracePanelId = `${tabId}-trace-panel`;

  return (
    <aside className={`lens webmcp-proof ${open ? "is-open" : "is-closed"}`} aria-label="WebMCP Proof">
      <span className="lens-clip" aria-hidden="true" />
      <button className="lens-heading" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="lens-orb"><EyeIcon /></span>
        <span>
          <strong>WebMCP Proof</strong>
          <small>
            {supported
              ? `${descriptors.length} registered · ${authorized.length} authorized now`
              : "Human interface · WebMCP optional"}
          </small>
        </span>
        <ChevronIcon className="lens-chevron" />
      </button>

      {!open && latestInvocation ? (
        <div className="lens-ticker" aria-live="polite">
          <span className={`ticker-state ${latestInvocation.status}`}>
            {latestInvocation.status === "ok" ? <CheckIcon /> : latestInvocation.status === "error" ? <XIcon /> : <span className="mini-spinner" />}
          </span>
          <code>{latestInvocation.tool}</code>
          <span className="ticker-summary">{latestInvocation.inputSummary}</span>
          <time dateTime={new Date(latestInvocation.startedAt).toISOString()}>
            {latestInvocation.durationMs === undefined ? "running" : `${latestInvocation.durationMs}ms`}
          </time>
        </div>
      ) : null}

      {open ? <div className="lens-body">
        {!supported ? <div className="lens-notice">
          <InfoIcon />
          <p>This browser is using MCPencil’s human interface. Page tools appear automatically when the room is opened in a WebMCP-capable agent browser.</p>
        </div> : <ProofContext context={context} />}

        <div className="lens-tabs" role="tablist" aria-label="WebMCP proof view">
          <button
            id={toolTabId}
            type="button"
            role="tab"
            aria-selected={tab === "tools"}
            aria-controls={toolPanelId}
            onClick={() => setTab("tools")}
          >Tool registry</button>
          <button
            id={traceTabId}
            type="button"
            role="tab"
            aria-selected={tab === "trace"}
            aria-controls={tracePanelId}
            onClick={() => setTab("trace")}
          >Evidence log</button>
        </div>

        {tab === "tools" ? <div className="tool-list" id={toolPanelId} role="tabpanel" aria-labelledby={toolTabId}>
          <section className="proof-tool-section" aria-labelledby={`${tabId}-registered-title`}>
            <div className="proof-section-heading">
              <h3 id={`${tabId}-registered-title`}>Registered on this page</h3>
              <span>{descriptors.length}</span>
            </div>
            {descriptors.length ? descriptors.map((descriptor) => (
              <ToolDescriptorRow
                key={descriptor.name}
                descriptor={descriptor}
                authorized={authorized.includes(descriptor.name)}
              />
            )) : <p className="lens-empty">{supported ? "Tool descriptors are attaching to the page." : "No page tool descriptors are exposed in this browser."}</p>}
          </section>

          <section className="proof-tool-section actionable-tool-set" aria-labelledby={`${tabId}-authorized-title`}>
            <div className="proof-section-heading">
              <h3 id={`${tabId}-authorized-title`}>Authorized for this role and phase</h3>
              <span>{authorized.length}</span>
            </div>
            {authorized.length ? <ul className="authorized-tool-list">
              {authorized.map((name) => <li key={name}><CheckIcon /><code>{name}</code></li>)}
            </ul> : <p className="lens-empty">No tool actions are authorized for this role and phase yet.</p>}
          </section>

          <div className="role-swap-note"><BotIcon /> Role and phase changes update authorization without replacing the page registry.</div>
        </div> : <div
          className="trace-list"
          id={tracePanelId}
          role="tabpanel"
          aria-labelledby={traceTabId}
          aria-live="polite"
        >
          {timeline.map((item) => item.kind === "invocation"
            ? <InvocationEvidence key={`call-${item.invocation.id}`} call={item.invocation} />
            : item.kind === "authorization"
              ? <AuthorizationEvidence key={`authorization-${item.authorization.id}`} event={item.authorization} />
              : <ActivityEvidence key={`activity-${item.activity.id}`} event={item.activity} />)}
          {timeline.length === 0 ? <p className="lens-empty">Tool calls, results, authorization changes, and matching UI actions appear here.</p> : null}
        </div>}
      </div> : null}
    </aside>
  );
}

function ProofContext({ context }: { context?: WebMcpProofContext }) {
  if (!context) return <div className="lens-status"><span className="pulse-dot" />Page registry connected</div>;
  const round = context.round === null || context.totalRounds === null
    ? null
    : `${context.round} / ${context.totalRounds}`;
  return (
    <div className="proof-context" aria-label="Current WebMCP authorization context">
      <span className="pulse-dot" aria-hidden="true" />
      <dl>
        <div><dt>Phase</dt><dd>{formatLabel(context.phase)}</dd></div>
        <div><dt>Role</dt><dd>{formatLabel(context.role)}</dd></div>
        <div><dt>Controller</dt><dd>{context.controller === null ? "Not seated" : formatLabel(context.controller)}</dd></div>
        {round ? <div><dt>Round</dt><dd>{round}</dd></div> : null}
      </dl>
    </div>
  );
}

function ToolDescriptorRow({
  descriptor,
  authorized,
}: {
  descriptor: WebMcpToolDescriptorEvidence;
  authorized: boolean;
}) {
  const annotations = annotationLabels(descriptor.annotations);
  return (
    <article className={`tool-row proof-tool-row ${authorized ? "is-actionable" : "is-withheld"}`}>
      <div className="proof-tool-copy">
        <code>{descriptor.name}</code>
        <small>{descriptor.title}</small>
      </div>
      <span className="registered-mark" title="Registered on this page"><CheckIcon /></span>
      <span className={`authorization-mark ${authorized ? "is-granted" : "is-withheld"}`}>
        {authorized ? "Authorized now" : "Withheld now"}
      </span>
      <div className="tool-annotations" aria-label="Published WebMCP annotations">
        {annotations.length
          ? annotations.map((annotation) => <code key={annotation}>{annotation}</code>)
          : <span>No annotation hints published</span>}
      </div>
    </article>
  );
}

function InvocationEvidence({ call }: { call: LensInvocation }) {
  const annotationText = annotationLabels(call.annotations);
  const canvasVersion = call.result?.canvasVersion ?? call.canvasVersion;
  const batchId = call.batchId ?? call.result?.batchId;
  return (
    <article className="trace-row is-invocation">
      <span className={`trace-state ${call.status}`}>
        {call.status === "ok" ? <CheckIcon /> : call.status === "error" ? <XIcon /> : <span className="mini-spinner" />}
      </span>
      <div>
        <div className="trace-title">
          <code>{call.tool}</code>
          <time dateTime={new Date(call.startedAt).toISOString()}>{call.durationMs === undefined ? "running" : `${call.durationMs}ms`}</time>
        </div>
        <p><strong className="evidence-label">Call</strong> {call.inputSummary}</p>
        <p><strong className="evidence-label">Result</strong> {call.status === "running" ? "Waiting for a result" : call.outputSummary ?? "Completed"}</p>
        <ul className="trace-meta" aria-label="Invocation evidence">
          <li>{call.provenance}</li>
          <li>canvas v{canvasVersion}</li>
          {batchId ? <li title={batchId}>batch {shortId(batchId)}</li> : null}
          {call.result?.revision === undefined ? null : <li>revision {call.result.revision}</li>}
          {call.result?.attemptCount === undefined ? null : <li>{call.result.attemptCount} attempts</li>}
          {call.result?.promptMasked ? <li>private prompt masked</li> : null}
          {annotationText.map((annotation) => <li key={annotation}>{annotation}</li>)}
        </ul>
      </div>
    </article>
  );
}

function AuthorizationEvidence({ event }: { event: ToolAuthorizationEvent }) {
  return (
    <article className="trace-row is-authorization">
      <span className={`trace-state authorization ${event.change}`}>{event.change === "granted" ? <CheckIcon /> : <XIcon />}</span>
      <div>
        <div className="trace-title">
          <code>{event.tool}</code>
          <time dateTime={new Date(event.createdAt).toISOString()}>{formatTime(event.createdAt)}</time>
        </div>
        <p>Authorization {event.change} · {formatLabel(event.role)} during {formatLabel(event.phase)}</p>
      </div>
    </article>
  );
}

function ActivityEvidence({ event }: { event: ActivityEvent }) {
  const promptActivity = isPromptActivity(event);
  const provenance = event.origin ?? (event.kind === "role-change" ? "room state" : "system");
  const badge = event.origin === "webmcp" ? <BotIcon /> : event.origin === "human-ui" ? "UI" : "SYS";
  return (
    <article className="trace-row is-activity">
      <span className={`trace-state activity ${event.origin ?? "system"}`} aria-label={`${provenance} activity`}>{badge}</span>
      <div>
        <div className="trace-title">
          <strong>{promptActivity ? "Private prompt activity" : event.label}</strong>
          <time dateTime={new Date(event.createdAt).toISOString()}>{formatTime(event.createdAt)}</time>
        </div>
        <p>{promptActivity ? "Private prompt event · content masked" : event.detail}</p>
        <ul className="trace-meta"><li>{provenance}</li><li>canvas v{event.canvasVersion}</li></ul>
      </div>
    </article>
  );
}

function buildTimeline(
  invocations: LensInvocation[],
  activity: ActivityEvent[],
  authorizationEvents: ToolAuthorizationEvent[],
): TimelineItem[] {
  return [
    ...invocations.map((invocation): TimelineItem => ({ kind: "invocation", createdAt: invocation.startedAt, invocation })),
    ...activity.map((event): TimelineItem => ({ kind: "activity", createdAt: event.createdAt, activity: event })),
    ...authorizationEvents.map((event): TimelineItem => ({ kind: "authorization", createdAt: event.createdAt, authorization: event })),
  ].sort((left, right) => right.createdAt - left.createdAt).slice(0, 18);
}

function annotationLabels(annotations?: WebMCP.ToolAnnotations) {
  if (!annotations) return [];
  const labels: string[] = [];
  if (annotations.readOnlyHint !== undefined) labels.push(`readOnlyHint: ${annotations.readOnlyHint}`);
  if (annotations.untrustedContentHint !== undefined) labels.push(`untrustedContentHint: ${annotations.untrustedContentHint}`);
  return labels;
}

function isPromptActivity(event: ActivityEvent) {
  return `${event.label} ${event.detail}`.toLocaleLowerCase().includes("prompt");
}

function legacyDescriptor(name: string): WebMcpToolDescriptorEvidence {
  return { name, title: name, description: "WebMCP tool registered by MCPencil." };
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function formatLabel(value: string) {
  return value.replaceAll("-", " ").replace(/^./, (character) => character.toLocaleUpperCase());
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
