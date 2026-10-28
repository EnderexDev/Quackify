import React from "react";
import ReactDOM from "react-dom/client";
// First, so the theme is on <html> before anything paints.
import "./state/theme";
import "./state/motion";
import "./util/noBrowserMenu";
import { useLang } from "./i18n";
import App from "./App";
import { MiniPlayer } from "./components/MiniPlayer";
import { Setup } from "./components/Setup";
import { PlayerProvider } from "./state/player";
import { isMini, isSetup } from "./state/windows";
import { startUpdateChecks } from "./state/update";
import "./styles/index.css";

if (isMini) document.documentElement.classList.add("mini-window");
// The main window asks for updates; the mini player and the installer leave it to it.
else if (!isSetup) startUpdateChecks();

/** The mini player's window: the same player, which leaves the history to the main window; it
 * starts over when the language changes, like the main window's shell. */
function Mini() {
  const language = useLang();
  return (
    <PlayerProvider record={false}>
      <MiniPlayer key={language} />
    </PlayerProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSetup ? <Setup /> : isMini ? <Mini /> : <App />}
  </React.StrictMode>,
);
