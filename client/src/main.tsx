import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { Capacitor } from "@capacitor/core";

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add(`capacitor-${Capacitor.getPlatform()}`);

  import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: Style.Default }).catch(() => {});
    if (Capacitor.getPlatform() === "android") {
      StatusBar.setBackgroundColor({ color: "#FFFBF5" }).catch(() => {});
    }
  }).catch(() => {});
}

// When a dynamic import (lazy chunk) fails to load — typically because a new
// deployment replaced the chunk file on the server — Vite fires this event.
// We reload the page so the browser fetches fresh HTML with current chunk refs.
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
