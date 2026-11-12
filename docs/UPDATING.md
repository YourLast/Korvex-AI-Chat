# Updating

Every release is a Docker image: `ghcr.io/yourlast/korvex-ai-chat:<version>` and `:latest`.
When a new version is out, the admin panel shows a banner.

## Update

```bash
docker compose pull
docker compose up -d
```

The app migrates its database by itself when it starts. Your data stays in the `korvex-data` volume.

## Automatic updates

Run the two commands above on a schedule, for example with cron once a night:

```cron
30 3 * * * cd /path/to/korvex-ai-chat && docker compose pull -q && docker compose up -d
```

## Roll back

1. Pin the previous version in `compose.yaml` (`image: ghcr.io/yourlast/korvex-ai-chat:0.1.0`).
2. If the newer version added database migrations, undo them first, while the newer version is still running:

   ```bash
   docker compose exec app node scripts/db-rollback.mjs <migration tag>
   ```

   It makes a backup next to the database (`/data/korvex.db.bak_…`) and undoes that migration and every later one.
   Migration tags are the file names in `drizzle/`, for example `0029_providers`.
3. `docker compose up -d`.

## Without Docker

```bash
git pull
npm ci
npm run build
# restart the app (systemd, pm2, …)
```
