import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isAgentInviteUrl, roomCodeFromUrl } from "./invite";
import "./styles.css";
import "./overhaul.css";

const currentUrl = new URL(window.location.href);
const invitedRoomCode = roomCodeFromUrl(currentUrl) ?? "";
if (/^[A-Z2-9]{5}$/.test(invitedRoomCode)) {
  const isAgentInvite = isAgentInviteUrl(currentUrl);
  document.title = isAgentInvite
    ? `MCPencil room ${invitedRoomCode} — WebMCP: call play_mcpencil now`
    : `MCPencil room ${invitedRoomCode} — join and play`;
  if (isAgentInvite) {
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) {
      description.content = `AI invitation for MCPencil room ${invitedRoomCode}. Call the page-exposed play_mcpencil WebMCP tool with {} and follow each nextAction until match-end.`;
    }
  }
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("MCPencil could not find its root element.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
