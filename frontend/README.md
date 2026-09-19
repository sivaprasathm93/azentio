# Sentinel AML — frontend

> Full documentation (architecture, screens, demo script, backend mapping, known gaps): [../README.md](../README.md#17-frontend-analyst-workbench).

React + TypeScript + Vite + Tailwind + shadcn-style Radix UI. TanStack Query/Table/Virtual, Zustand, React Flow, Recharts, STOMP/SockJS.

## Run it

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  — demo mode, no backend needed
```

Demo mode (`VITE_API_MODE=mock`, the default in `.env`) runs entirely in the browser on the customers/accounts in
`src/lib/api/mock/seed/*.csv`. Use the **Demo persona** switcher (bottom-left) to try Analyst / Supervisor / Admin.

## Against the Spring Boot backend

1. Set in `frontend/.env`: `VITE_API_MODE=live`, `BACKEND_USER`, `BACKEND_PASSWORD`, `VITE_API_USER` (same as `BACKEND_USER`).
   There is no sign-in screen: the Vite proxy (dev) or nginx (Docker) authenticates to the API as that account.
   Use the admin account if the Rules page should be editable.
2. `docker compose up postgres backend`, then `npm run dev`.

Full stack: set `FRONTEND_BASIC_AUTH` in the root `.env` (`printf '%s' 'admin:<password>' | base64`), then `docker compose up --build` → http://localhost:3000.

## Layout

`src/features/{alerts,cases,rules}` screens · `src/lib/api` API interface, HTTP adapter + in-browser mock · `src/lib/realtime` STOMP + demo stream · `src/hooks` TanStack Query hooks · `src/types` domain models.

`npm run typecheck` · `npm test` (smoke test over the mock data path).
