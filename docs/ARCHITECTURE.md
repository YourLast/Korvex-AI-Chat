# Architecture

Korvex AI Chat is one Next.js application (App Router, Node.js runtime) with a SQLite database. The browser talks only to
this app; the app talks to model servers over the OpenAI-compatible API (or the Anthropic API for Claude models).

## Stack

- **Next.js 16** (React 19). Server code lives in `src/lib` and `src/app/api`; pages in `src/app/(app)`.
- **Vercel AI SDK** (`ai`, `@ai-sdk/openai-compatible`) for streaming chat turns; a small SSE parser for agent turns with tools.
- **SQLite** through `better-sqlite3` and **Drizzle ORM**. Migrations are in `drizzle/`, applied at start. Rollback scripts are in `drizzle/rollback/`.
- **argon2id** password hashes (`@node-rs/argon2`), cookie sessions.
- **pdf.js** for PDF viewing and text extraction, **xlsx** for spreadsheets, **KaTeX** and **highlight.js** in Markdown.

## A chat turn

1. The browser posts a message to `/api/chat`. The server stores it and creates a **job** (`src/lib/jobs.ts`).
2. The job runs in the server process, not in the request: a turn survives a closed tab, a reload or a second device.
   Progress goes to every open tab of the user through one SSE connection (`/api/events`, `src/lib/bus.ts`, `src/lib/live.ts`).
3. The job builds the model request (`src/lib/turn.ts`): system prompt, user memory, chat history, attached files.
4. The request goes to the model (`src/lib/upstream.ts`). Model servers differ in small ways — headers, extra body fields,
   extra usage fields, "busy, retry later" signals; those are described by a **dialect** (`src/lib/dialect.ts`).
   The default dialect is plain OpenAI-compatible.
5. With tools enabled, the turn is an **agent loop** (`src/lib/agentLoop.ts`): the model calls tools from the registry
   (`src/lib/tools/*`: chats, files, memory, web search, code), steps are shown in the feed, risky actions wait for the user.
6. The answer, reasoning and token usage are saved; the user gets a Web Push notification if no tab shows the chat (`src/lib/notify.ts`).

Timeouts are by silence, not by total time (`src/lib/jobTimeout.ts`): a long answer lives as long as the model keeps streaming.

## Main modules

| Area | Where |
|---|---|
| Models and reasoning levels | `models.config.json`, `src/lib/models.ts`, `src/lib/levels.ts` |
| Jobs, queue, retries | `src/lib/jobs.ts`, `src/lib/agentLoop.ts` (`UpRetry`) |
| Files: upload, text, viewer, previews | `src/app/api/files`, `src/lib/extract.ts`, `src/lib/extractNode.ts`, `src/lib/preview.ts`, `src/components/fileview` |
| Files made by the model | `src/lib/outfiles.ts`, `src/lib/outRoute.ts` (`/out/<token>/<name>`, owner only) |
| User memory and the intro talk | `src/lib/memory.ts`, `src/lib/curator.ts`, `src/lib/intro.ts` |
| Chat titles | `src/lib/titles.ts` |
| Search in chats (SQLite FTS5) | `src/lib/search.ts`, `src/lib/textsearch.ts` |
| Automations (cron) | `src/lib/automations.ts`, `src/lib/scheduler.ts`, `src/lib/cron.ts` |
| Compare two models side by side | `src/lib/pairs.ts`, `src/lib/compare.ts`, `src/components/PairTurn.tsx` |
| Voice input | `src/lib/recorder.ts`, `src/app/api/transcribe` (any OpenAI-compatible speech-to-text server) |
| Accounts, invites, roles, limits | `src/lib/auth.ts`, `src/lib/invites.ts`, `src/lib/moderation.ts`, `src/lib/week.ts`, `src/lib/seat.ts` |
| Admin panel | `src/app/(app)/admin`, `src/app/api/admin` |
| OpenAI-compatible API for your users | `src/app/v1`, `src/lib/apikeys.ts` |
| Claude models (Anthropic API) | `src/lib/anthropic/*` |
| Code mode (GitHub + sandbox) | `src/lib/code/*`, `src/lib/github/*` — needs Docker on the host, off unless configured |
| Translations (RU / EN / SR) | `src/lib/i18n/dict/*` |

## Settings

Server settings are environment variables (see `.env.example`), read through `src/lib/cfg.ts`.
Models are listed in `models.config.json` (see `models.config.example.json`).

## Extension points

`src/ext/` is a registry that lets a private build add its own pieces without changing the core: a model dialect, extra tools,
extra translations, model icons, hooks on login and chat deletion, its own file reader. In this repository the registry is empty
(`src/ext/index.ts`, `src/ext/client.ts`, …), and the core works without it.

## Zero-downtime restarts

`scripts/next-server.mjs` starts the app with `SO_REUSEPORT`. A new process can take the port while the old one finishes its
running jobs and exits (`src/lib/instance.ts`); the processes share the database.

## Tests

`npm test` runs the Vitest suite in `tests/`. Tests never call the network: model servers are local mocks (`tests/e2e/mock_*.mjs`).
