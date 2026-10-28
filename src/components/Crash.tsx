// A render error anywhere in a window: instead of a blank window, what broke, with Reload, the
// log folder and Report a problem. The error goes to the log file first (state/problems.ts).
import { Component, type ErrorInfo, type ReactNode } from "react";
import { logProblem, openLogFolder, reportProblem } from "../state/problems";
import { notify, toast } from "../state/toast";
import { isSetup } from "../state/windows";
import { t } from "../i18n";

type State = { error: string | null };

export class Crash extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const stack = error instanceof Error ? error.stack : String(error);
    logProblem(`[webview] render failed: ${stack}\n${info.componentStack ?? ""}`);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="crash state" role="alert">
        <span className="state-icon danger" aria-hidden>
          !
        </span>
        <h3>{t("Something broke in Quackify")}</h3>
        <p className="muted">{t("The music keeps going. Reloading the window usually brings it back.")}</p>
        <code className="crash-detail">{error}</code>
        <div className="state-actions">
          <button className="pill-btn white" onClick={() => location.reload()}>
            {t("Reload")}
          </button>
          {/* The installer's window has neither the log nor the opener (setup.rs). */}
          {!isSetup && (
            <>
              <button className="pill-btn" onClick={() => reportProblem(error).catch(toast)}>
                {t("Report a problem")}
              </button>
              <button className="pill-btn" onClick={() => openLogFolder().catch(toast)}>
                {t("Open log folder")}
              </button>
            </>
          )}
          <button
            className="pill-btn"
            onClick={() => navigator.clipboard.writeText(error).then(() => notify(t("Details copied"), { kind: "info" }), toast)}
          >
            {t("Copy details")}
          </button>
        </div>
      </div>
    );
  }
}
