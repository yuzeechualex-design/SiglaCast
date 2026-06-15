import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import DesktopTitleBar from "./components/DesktopTitleBar.jsx";
import "./styles.css";

// Disable browser right-click context menu across the entire app
document.addEventListener("contextmenu", (e) => e.preventDefault());

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <DesktopTitleBar />
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
