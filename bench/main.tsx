import { Profiler } from "react";
import ReactDOM from "react-dom/client";
import App from "../src/App";

// Time React spent rendering, summed over commits since the last reset.
const timing = { ms: 0 };
Object.assign(window, {
  __timing: {
    reset: () => (timing.ms = 0),
    read: () => Math.round(timing.ms * 10) / 10,
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <Profiler id="app" onRender={(_id, _phase, actual) => (timing.ms += actual)}>
    <App />
  </Profiler>,
);
