# Changelog

Notable changes. Every release also has automatic notes on the [Releases](https://github.com/YourLast/Korvex-AI-Chat/releases) page.

## v0.1.6

- A long wait that is not the answer's own work — a model server's queue of heavy requests or its maintenance — now extends
  the 4-hour limit of an answer by up to 8 hours (`KX_HOLD_MAX_H`), not 4: a server with a long queue answers itself.

## v0.1.5

- **MCP tools.** Remote MCP servers (Streamable HTTP) in **Admin → MCP**: the address and an optional key header (stored
  encrypted), **Check** reads the tools, single tools can be turned off. Models with tools get them next to web search and
  memory; who — **Admin → Access** (without a setting, admins only); the chat asks the person before tools that are not
  read only. See [MCP tools](README.md#mcp-tools).

## v0.1.4

- **Fix: uploads with an RFC 5987 file name.** A form whose file part says `filename*=UTF-8''…` (Python `requests`, some 1C
  versions) was rejected as a whole; now the name is read as UTF-8 and the upload goes through — for the organization upload
  address, chat uploads and voice input.

## v0.1.3

- **Fix: tools work with every model.** In v0.1.2 web search, user memory and chat tools ran only for Claude models: the image
  did not turn on the tool loop. Now it is on by default (`KX_AGENT_TOOLS=1`) for every model with tools, the built-in local
  model included; `KX_AGENT_TOOLS=0` turns it off (a faster first answer on a slow CPU, without web search).
- **Home-server app stores.** Ready templates in [deploy/](deploy/): CasaOS and ZimaOS (the full stack: the app, the local
  model, web search, voice input), Unraid (the app; Ollama, SearXNG and speaches by their own templates) and Coolify
  (Docker Compose Empty). Steps — [docs/DEPLOY.md](docs/DEPLOY.md#home-servers-casaos-zimaos-unraid-coolify).
- **Organization upload address** (Organizations mode → an organization's settings): documents arrive into its library without
  a person — by an organization key (`POST /api/orgs/<id>/ingest` with `Authorization: Bearer kxo_…`, for 1C or bank exports on a
  schedule) or by e-mail through your mail collector (`POST /api/orgs/mail-ingest`; the address is `KX_ORG_MAIL` plus the
  organization's tag, the collector's secret is `KX_COLLECTOR_KEY_SHA256`). The same parsing as uploads from the chat, allowed
  senders, repeats of the same letter are not stored twice, 500 files per organization per day; `KX_ORG_INGEST=0` turns it off.
- With only an Ollama address and a local model set (`KX_OLLAMA_URL`, `KX_LOCAL_MODEL`), chat titles and user memory use the
  local model too: one setting is enough on Unraid or on a cloud host with your own Ollama.

## v0.1.2

- **License.** Starting with v0.1.2, the license adds an attribution condition: if you run Korvex AI Chat for other people,
  keep a visible line "Powered by Korvex AI Chat" with a link to this repository (see [LICENSE](LICENSE)). Everything else
  you can change to your own brand. To remove the line as well, write to hello@korvexai.site.
  v0.1.0 and v0.1.1 remain under the plain Apache License 2.0.
- **Works without API keys.** `docker compose up -d` also starts Ollama with a small local model (IBM Granite 4 Micro, Apache 2.0, 2.1 GB,
  runs on the CPU): it downloads on the first start, the chat shows the progress, and it appears in **Admin → Models** by
  itself. `compose.gpu.yaml` runs it on an NVIDIA GPU; `KX_LOCAL_MODEL` picks another model.
- **Web search out of the box:** SearXNG in `docker compose`. Or Brave Search or Tavily with an API key — choose in
  **Admin → Features**.
- **ARM64 images** (Mac with Apple silicon, ARM servers) next to x86-64.
- **English everywhere** for a non-Russian interface: the admin panel, server messages, the steps of tools in the chat and the
  texts sent to the model (chat titles, user memory, agent rules, tool results). Small local models answer in the language of
  the prompt, so this matters for them most.
- **Invite link groups.** For everyone who signed up with a link: the deepest thinking level without giving more rights, a weekly
  limit of their own, and an "Organizations" mode — **Admin → the link → Group settings**.
- **Organizations mode** (for accounting firms): a switcher in the side menu (only the chosen organization's chats; a new chat
  goes into it), a documents panel by the message box (type and period filters, "select all for the period" puts them into the
  message at once), batch upload of files, folders and zip archives into an organization's library; the type and date of bank
  statements, UPD, acts, invoices and 1C exports are detected automatically (1C exchange files in Windows-1251 too).
- The line under the message box now reads "The assistant can make mistakes · Powered by Korvex" (with your brand name
  in the first part); on phones, "Powered by Korvex AI Chat" is at the bottom of the side menu. **Admin → Brand** explains it.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists every npm package in the Docker image with its license, plus
  libvips (LGPL-3.0-or-later) with links to its source, fonts and icons; license texts are in `licenses/`.
  Both are in the repository and in the image.
- Removed the `buffers` package (no license) from the dependency tree.

## v0.1.1

- Deploy to Render, Railway and Fly.io; [docs/DEPLOY.md](docs/DEPLOY.md) explains why there is no Vercel version yet.

## v0.1.0

- First public release.
