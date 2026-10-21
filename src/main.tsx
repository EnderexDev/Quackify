import React from "react";
import ReactDOM from "react-dom/client";
// First, so the theme is on <html> before anything paints.
import "./state/theme";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
