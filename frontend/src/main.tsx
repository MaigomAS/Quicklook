import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const viewMode = params.get("view") === "monitor" ? "monitor" : "dashboard";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App viewMode={viewMode} />
  </React.StrictMode>
);
