import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Workspace } from "./workspace/Workspace";
import "./styles.css";
import { initializeLanguage } from "./i18n";

initializeLanguage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/workspace') ? <Workspace /> : <App />}
  </React.StrictMode>,
);
