# Changelog

Notable changes. Every release also has automatic notes on the [Releases](https://github.com/YourLast/Korvex-AI-Chat/releases) page.

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
