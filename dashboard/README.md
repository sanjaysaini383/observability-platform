# TraceLens Dashboard

The React frontend for [TraceLens](../README.md) — a read-only client that polls
`query-api` every 10–15 seconds and renders traces, the service dependency graph,
latency/error metrics, and AI-generated root cause insights.

Normally you don't run this directly — it's built and served as part of the full stack
via `docker compose up` from [`infra/`](../infra). See [`../running-guide.md`](../running-guide.md)
for the full setup.

## Stack

React 19 + Vite + TypeScript + TailwindCSS 4 + Recharts (charts) + ReactFlow (service
graph). No server-side rendering — it's a pure client-side SPA behind `query-api`'s
REST endpoints.

## Local development (outside Docker)

Useful for iterating on the UI with hot reload, without rebuilding the container each
time. Requires `query-api` to already be running (via `docker compose up query-api` or
the full stack).

```bash
npm install
npm run dev       # starts Vite dev server, defaults to http://localhost:5173
```

By default the dev server talks to `http://localhost:4000` for the API. Override with
a `.env.local` file if `query-api` is running elsewhere:

```bash
# dashboard/.env.local
VITE_API_URL=http://localhost:4000
```

## Building

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

The Docker build (`Dockerfile`) runs this same build and serves `dist/` with `serve`.

## Structure

```
src/
├── pages/              Dashboard, Traces, Services, Metrics, AiInsights
├── components/
│   ├── layout/         Sidebar, Layout (app shell + branding)
│   └── ui/              Card, Badge, Table, Tabs — shadcn/ui-style primitives
├── lib/
│   ├── api.ts           fetch functions + row mappers (ClickHouse PascalCase → camelCase)
│   └── utils.ts
└── index.css            Theme tokens (colors, radius) — see project-overview.md for the palette rationale
```

See [`../project-overview.md`](../project-overview.md) §6 for a walkthrough of what each
page shows and where its data comes from.
