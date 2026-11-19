# Templates for home-server app stores

| Folder | Platform | What it runs |
|---|---|---|
| [casaos/](casaos/) | CasaOS, ZimaOS (App Store v2 format) | The app, the local model (Ollama), web search (SearXNG), voice input (speaches) |
| [unraid/](unraid/) | Unraid (Community Applications template) | The app; Ollama, SearXNG and speaches by their own templates |
| [coolify/](coolify/) | Coolify (Docker Compose Empty) | The same stack as CasaOS |

Steps: [docs/DEPLOY.md](../docs/DEPLOY.md#home-servers-casaos-zimaos-unraid-coolify).
The image tag in these files is the version of this release (`ghcr.io/yourlast/korvex-ai-chat:0.1.31`); Unraid uses `latest`.
