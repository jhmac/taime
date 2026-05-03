# Single-process Vite + Express served on one port

Taime runs the Vite dev server and the Express API in a single Node process listening on one port; in development Vite is mounted as middleware via `server/vite.ts`, and in production Express serves the built static bundle from `dist/public`. We chose this over a split frontend/backend deployment because Replit workflows expose one port, it removes CORS and proxy complexity, and it lets one `npm run dev` command boot the whole app for both web and Capacitor builds.
