# Korvex AI Chat

A self-hosted chat for any OpenAI-compatible model: background answers that survive a closed tab, chat folders and search,
file reading and preview, user memory, automations, voice input, Web Push and an admin panel with users, invites and limits.

> © 2026 Korvex · License: SEE LICENSE IN [LICENSE](LICENSE)

![Korvex AI Chat](docs/screenshot.png)

## Quick start

```bash
git clone https://github.com/YourLast/Korvex-AI-Chat.git
cd Korvex-AI-Chat
docker compose up -d
```

Open http://localhost:3000 and create the first account: it becomes the admin. No API keys needed: a small local model
(IBM Granite 4 Micro, Apache 2.0, 2.1 GB) downloads on the first start and runs on the CPU, the chat shows the download progress. Voice input
and web search work out of the box too. Images for x86-64 and ARM64 (Mac with Apple silicon, ARM servers).

After that, sign-up is closed: invite people from the admin panel, or turn sign-up on in **Admin → Features**.
In production, run it behind HTTPS and set `COOKIE_SECURE=1`.

Without Docker (Node.js 22 and your own model server):

```bash
npm ci
cp .env.example .env.local
npm run build && npm start
```

Settings are environment variables — see [.env.example](.env.example). How it works — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploy

- **Your server:** `docker compose up -d` — the app, a local model (Ollama), speech-to-text (speaches) and web search (SearXNG).
  With an NVIDIA GPU: `docker compose -f compose.yaml -f compose.gpu.yaml up -d`.
- **Home servers:** CasaOS / ZimaOS, Unraid and Coolify — ready templates in [deploy/](deploy/), steps in
  [docs/DEPLOY.md](docs/DEPLOY.md#home-servers-casaos-zimaos-unraid-coolify).
- **Cloud:** [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YourLast/Korvex-AI-Chat)
  · Railway and Fly.io — a few steps in [docs/DEPLOY.md](docs/DEPLOY.md).
- **Vercel** is not supported yet: long answers, background jobs and SQLite need a long-running server —
  see [why, and what it would take](docs/DEPLOY.md#why-not-vercel-yet).

## Models

The built-in local model is a good start, but small: for serious work add a stronger one. A bigger local model:
`KX_LOCAL_MODEL=<name from ollama.com/library>` in `.env` (for example `granite4:tiny-h`: 4.2 GB, twice as fast on a CPU);
or any API. The model needs tool support for web search and memory.

Add models in **Admin → Models**: pick a provider — any OpenAI-compatible server, OpenAI, Anthropic, OpenRouter, Ollama or
LM Studio — enter the address and the API key, press **Check connection**, then add the models you want people to use.
API keys are stored encrypted (AES-256-GCM, the key file is `data/keys/korvex.key`) and are never shown again.

You can also list models in `models.config.json` (see `models.config.example.json`); `apiKeyEnv` names the environment
variable with the key.

## MCP tools

Connect remote MCP servers in **Admin → MCP**: the address of the server (Streamable HTTP, for example
`https://mcp.example.com/mcp`) and, if it needs one, a request header with a key (`Authorization: Bearer …`, stored
encrypted). **Check** reads the server's tools; turn single tools off if the model should not use them. Models with tool
support get the tools in their answers, next to web search and memory.

- **Who.** Without a setting, only admins get a server's tools. Open them to roles, people or invite-link groups in
  **Admin → Access**.
- **Asking first.** By default the chat asks the person before every tool that the server did not mark as read only;
  per server you can ask always or never.
- **Untrusted data.** What a server returns is treated like a web page: after it, the model cannot write to the user's
  memory on its own, and messages to other chats still ask the person first.

Local stdio servers are not supported yet: they run code on the server and need an isolated sandbox.

## Admin panel

- **People** — invites (single and group links), roles, blocking, limits, activity.
- **Models** — providers and models.
- **MCP** — remote MCP servers and their tools.
- **Features** — turn off voice input, files, user memory, automations, web search, model comparison, notifications or
  sign-up for everyone. Code mode (an agent that runs commands in a sandbox) is off by default: turn it on only on an
  isolated machine.
- **Access** — who can use each model, feature or MCP server: by role, by person, or everyone who joined through an
  invite link.
- **Brand** — your product name instead of “Korvex” in every text and in how the model introduces itself, your logo,
  accent color and the line at the bottom of the sign-in page. The "Powered by Korvex" line and the [NOTICE](NOTICE) file
  stay as they are (see [Make it yours](#make-it-yours)).

## Make it yours

Rename it, add your logo and colors: the admin panel has a Brand section for that.
We only ask for one small line, "Powered by Korvex AI Chat", linking back here.
If you'd like to remove that too, just write to us at hello@korvexai.site.
We're happy to talk and will most likely say yes, though we can't promise it.

## Current limits

- Voice input needs a speech-to-text server with an OpenAI-compatible `/v1/audio/transcriptions` (set `STT_URL`).
- Previews of Office documents need a Docker image with LibreOffice; PDF, spreadsheets and text open without it.
- Web search: SearXNG in `docker compose` works out of the box; elsewhere set a SearXNG address, or a Brave Search or
  Tavily API key, in **Admin → Features**.
- The built-in local model on a CPU answers in a few seconds but is small; cloud configs (Render, Railway, Fly.io) run
  without it — add a model by API there.
- No Vercel version yet — see [docs/DEPLOY.md](docs/DEPLOY.md#why-not-vercel-yet).

## License

SEE LICENSE IN [LICENSE](LICENSE): the Apache License, Version 2.0, with one additional condition (attribution, see
[Make it yours](#make-it-yours)), and [NOTICE](NOTICE). Starting with v0.1.2, the license adds an attribution condition;
v0.1.0 and v0.1.1 remain under the plain Apache License 2.0. Changes — [CHANGELOG.md](CHANGELOG.md).

Third-party software and its licenses, including the
LGPL libvips used by the image library — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Korvex name and logo are trademarks of Korvex;
the license does not grant permission to use them beyond what is needed to describe the origin of the software.
