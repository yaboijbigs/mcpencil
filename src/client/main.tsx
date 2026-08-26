import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const inviteParams = new URLSearchParams(window.location.search);
const invitedRoomCode = inviteParams.get("room")?.trim().toUpperCase() ?? "";
if (/^[A-Z2-9]{5}$/.test(invitedRoomCode)) {
  document.title = inviteParams.get("invite") === "agent"
    ? `MCPencil room ${invitedRoomCode} — join and play now`
    : `MCPencil room ${invitedRoomCode} — join and play`;
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
