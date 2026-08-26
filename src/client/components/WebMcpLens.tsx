import { useState } from "react";
import type { ActivityEvent } from "../../shared/game";
import type { LensInvocation } from "../hooks/useWebMcpTools";
import { BotIcon, CheckIcon, ChevronIcon, EyeIcon, InfoIcon, XIcon } from "./Icons";

interface WebMcpLensProps {
  supported: boolean;
  tools: string[];
  invocations: LensInvocation[];
  activity: ActivityEvent[];
  defaultOpen?: boolean;
}

export function WebMcpLens({ supported, tools, invocations, activity, defaultOpen = true }: WebMcpLensProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<"tools" | "trace">("tools");
  return (
    <aside className={`lens ${open ? "is-open" : "is-closed"}`} aria-label="WebMCP Lens">
      <button className="lens-heading" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="lens-orb"><EyeIcon /></span>
        <span><strong>WebMCP Lens</strong><small>{supported ? `${tools.length} live tools` : "compatibility view"}</small></span>
        <ChevronIcon className="lens-chevron" />
      </button>
      {open ? <div className="lens-body">
        {!supported ? <div className="lens-notice"><InfoIcon /><p>This browser can play as a human. Open MCPencil in a WebMCP-enabled ChatGPT browser or Chrome build to bring an agent.</p></div>
          : <div className="lens-status"><span className="pulse-dot" />Tools are attached to this page</div>}
        <div className="lens-tabs" role="tablist" aria-label="Lens view">
          <button type="button" role="tab" aria-selected={tab === "tools"} onClick={() => setTab("tools")}>Role tools</button>
          <button type="button" role="tab" aria-selected={tab === "trace"} onClick={() => setTab("trace")}>Live trace</button>
        </div>
        {tab === "tools" ? <div className="tool-list">
          {tools.length ? tools.map((tool) => <div className="tool-row" key={tool}>
            <span className={isReadTool(tool) ? "tool-kind read" : "tool-kind write"}>{isReadTool(tool) ? "READ" : "WRITE"}</span>
            <code>{tool}</code><span className="registered-mark"><CheckIcon /></span>
          </div>) : <p className="lens-empty">Tools will appear as your role changes.</p>}
          <div className="role-swap-note"><BotIcon /> Role changes atomically swap this set.</div>
        </div> : <div className="trace-list" aria-live="polite">
          {invocations.map((call) => <article className="trace-row" key={call.id}>
            <span className={`trace-state ${call.status}`}>{call.status === "ok" ? <CheckIcon /> : call.status === "error" ? <XIcon /> : <span className="mini-spinner" />}</span>
            <div><div className="trace-title"><code>{call.tool}</code><time>{call.durationMs === undefined ? "running" : `${call.durationMs}ms`}</time></div>
              <p>{call.inputSummary}</p>{call.outputSummary ? <small>{call.outputSummary} · canvas v{call.canvasVersion}</small> : null}</div>
          </article>)}
          {activity.slice().reverse().slice(0, Math.max(0, 8 - invocations.length)).map((event) => <article className="trace-row is-activity" key={event.id}>
            <span className="trace-state activity">{event.origin === "webmcp" ? <BotIcon /> : "UI"}</span>
            <div><div className="trace-title"><strong>{event.label}</strong><time>v{event.canvasVersion}</time></div>
              <p>{event.detail.toLowerCase().includes("prompt") ? "Private prompt event · content masked" : event.detail}</p></div>
          </article>)}
          {!invocations.length && !activity.length ? <p className="lens-empty">Tool calls and matching UI actions appear here.</p> : null}
        </div>}
      </div> : null}
    </aside>
  );
}

function isReadTool(tool: string) { return tool.startsWith("get_"); }
