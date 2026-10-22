import React from "react";
import ReactDOM from "react-dom/client";
// First, so the theme is on <html> before anything paints.
import "./state/theme";
import "./state/motion";
import App from "./App";
import { MiniPlayer } from "./components/MiniPlayer";
import { PlayerProvider } from "./state/player";
import { isMini } from "./state/windows";
import "./styles/index.css";

if (isMini) document.documentElement.classList.add("mini-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isMini ? (
      // The mini player's window: the same player, which leaves the history to the main window.
      <PlayerProvider record={false}>
        <MiniPlayer />
      </PlayerProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
