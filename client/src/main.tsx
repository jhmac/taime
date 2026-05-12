import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isNativePlatform, getPlatform } from "@/lib/capacitor";

if (isNativePlatform()) {
  document.documentElement.classList.add(`capacitor-${getPlatform()}`);

  import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: Style.Default }).catch(() => {});
    if (getPlatform() === "android") {
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

// When the service worker controller changes (new SW activated after a
// deployment), reload immediately so the page loads fresh JS/CSS bundles.
// sw.js calls self.skipWaiting() on install, meaning the new SW activates
// as soon as it finishes installing — without waiting for the old page to
// close.  Without this listener the page keeps running stale cached chunks
// even after the SW has been replaced, which is why the "Reload" button in
// the update toast appeared to do nothing.
if ('serviceWorker' in navigator) {
  let _swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!_swRefreshing) {
      _swRefreshing = true;
      window.location.reload();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
