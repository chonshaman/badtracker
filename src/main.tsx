import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./ui/AppShell";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/smash-tracker" replace />} />
        <Route path="/:slug" element={<AppShell mode="player" />} />
        <Route path="/:slug/session/:sessionId" element={<AppShell mode="player" />} />
        <Route path="/:slug/admin" element={<AppShell mode="admin" />} />
        <Route path="*" element={<Navigate to="/smash-tracker" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
