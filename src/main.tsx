import React from "react";
import ReactDOM from "react-dom/client";
// CSS first: theme tokens must be in the DOM before any module reads them
// via getComputedStyle (src/lib/theme.ts).
import "./index.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
