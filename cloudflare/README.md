# Lishogi Cloudflare migration: integration alpha

This overlay preserves the full upstream Lishogi source and adds deployment infrastructure for its primary services. It does not replace Lishogi with a new shogi game.

**The full migration is unfinished.** This is a reviewable implementation checkpoint, not a tested production release. Worker bundling and focused JavaScript tests pass. The complete Docker build, multiplayer, AI gameplay, email delivery and recovery on Cloudflare have not been verified. This environment has no Docker CLI; the attempted complete image dry run stopped for that reason. Upstream Scala tests also stopped because sbt could not open its boot-server Unix socket in this environment.

## Implemented infrastructure

| Responsibility | Component |
| --- | --- |
| HTTPS entry point and canonical host | Worker |
| Full upstream application | Lishogi Scala server |
| Online play, spectators and other WebSockets | Original lila-ws server and Redis |
| Application data | Original MongoDB APIs, single-node replica set |
| Backup and restart restoration | Private R2 bucket, MongoDB logical archives |
| AI computation | Shoginet, YaneuraOu and largeboard Fairy-Stockfish |
| Authentication email bridge | Cloudflare Email Sending |
| Runtime location | One APAC Container |

The baseline and companion source commits are pinned in `UPSTREAM.json` and `Dockerfile`. No game-rule source or existing feature module is overwritten. D1 is not used: retaining MongoDB avoids rewriting the 160 upstream files with direct ReactiveMongo imports.

The default `standard-4` instance has four vCPUs and 12 GiB memory. It stays running for background timers, tournaments and active games. Running costs must be evaluated before deployment. This version does not implement ten-minute idle shutdown or autoscaling.

## Apply to a fork

1. Fork `https://github.com/WandererXII/lishogi`. The inspected baseline is commit `5394fc3dd868de1442ea24ecd87cdf065dea2f33`.
2. Extract this overlay into the root of the fork. It adds `cloudflare/`, `.dockerignore` and `wrangler.jsonc` without overwriting the upstream application package files.
3. Set `PUBLIC_ORIGIN` in `wrangler.jsonc` to your real HTTPS origin, without a path, query or nonstandard port. Set `MAIL_FROM` to your verified sender address.
4. Enable Containers on Workers Paid. Create a **private** R2 bucket named `lishogi-backups`, or update the bucket binding to your own name.
5. Onboard your domain in **Email Service > Email Sending**. Ordinary Email Routing alone is insufficient for unrestricted authentication emails.
6. Add a Worker custom domain matching `PUBLIC_ORIGIN`.
7. Configure four distinct Worker secrets: `CONTAINER_CONTROL_TOKEN`, `PLAY_SECRET`, `USER_PASSWORD_SECRET` and `SHOGINET_KEY`. Generate the password key with `node cloudflare/generate-secret.mjs --password`; generate each other secret separately with `node cloudflare/generate-secret.mjs`. Do not commit secret values. The password key must be a Base64-encoded 32-byte AES key, not a hex token.

Keep `USER_PASSWORD_SECRET` stable across updates: it is part of password verification. Keep `PLAY_SECRET` stable to preserve sessions and signed links.

Workers Builds settings for the GitHub fork:

```text
Root directory: /
Build command: cd cloudflare && npm ci
Deploy command: cd cloudflare && npx wrangler deploy --config ../wrangler.jsonc
```

Wrangler builds the image during deployment. The image build installs and builds the upstream pnpm workspace, compiles both Scala servers and compiles both native engines. A full build can take substantial time; no prebuilt application or engine binary is included in this overlay.

For local deployment on a machine with Docker:

```bash
cd cloudflare
npm ci
npx wrangler r2 bucket create lishogi-backups
npx wrangler secret put CONTAINER_CONTROL_TOKEN --config ../wrangler.jsonc
npx wrangler secret put PLAY_SECRET --config ../wrangler.jsonc
npx wrangler secret put USER_PASSWORD_SECRET --config ../wrangler.jsonc
npx wrangler secret put SHOGINET_KEY --config ../wrangler.jsonc
npm run deploy
```

Domain placeholders are deliberately rejected at runtime. The initial request restores the last committed backup before exposing the application. It then generates configuration, starts Lishogi and lila-ws and launches the local AI worker. Startup failures return HTTP 503.

## Persistence: remaining blocker for production

MongoDB backups use `mongodump --oplog`; restore uses `mongorestore --oplogReplay`. The archive includes database changes made during capture. SHA-256 is verified before restoration. A missing or inconsistent committed archive stops startup rather than silently creating an empty database.

**R2 is a checkpoint store, not MongoDB's live durable disk.** Unexpected termination can lose changes since the last successful backup. The default interval is 60 seconds, but slow backups or storage failures can make the recovery point older. In-flight WebSocket sessions and Redis queues are not preserved. This version does not provide transaction-level durable acknowledgements, high availability or zero-data-loss recovery.

Only a successfully uploaded archive can replace the manifest. Ten rolling archives are retained. Failed uploads can leave unreferenced objects. Keep separate copies for long-term history, and keep the bucket private.

Native Container snapshots were checked but not used: their documented 30-day retention and image-version coupling do not substitute for long-term, upgrade-portable database storage.

## Remaining full-platform integrations

- Search still uses the upstream default `search.enabled = false`; a replacement for the original search service has not been ported.
- Uploaded images, image transforms and animated game GIFs still refer to original upstream helper services. Cloudflare-native replacements are pending.
- A new instance does not inherit the live Lishogi database: puzzles, articles, users, studies and existing game records are separate data.
- Payments, web push and other provider integrations retain upstream configuration; owner credentials and service replacements are pending.
- The public `/source` page needs to link to the exact published fork and companion engine sources used by the running build.

Therefore this checkpoint does **not** yet satisfy the requirement that every Lishogi feature runs solely on Cloudflare. The full application source is preserved for continued migration.

## Verify before completion

```bash
cd cloudflare
npm ci
npm test
npx wrangler deploy --dry-run --containers-rollout=none --config ../wrangler.jsonc
cd ..
bash cloudflare/verify-image.sh
```

The dry run with `--containers-rollout=none` checks the Worker bundle and configuration only. It intentionally skips building and deploying the Container and cannot establish that Lishogi starts.

`verify-image.sh` requires Docker. It builds the full image, checks application startup and a versioned asset, requests a database backup and runs the upstream Shoginet engine tests. It does not verify real Cloudflare behavior.

The next integration checks are two independent browsers completing online games; all AI difficulties; account verification, login, logout and password reset; persistent sessions; shogi-specific illegal moves, repetition, perpetual check and entering-king outcomes; tournaments; studies; spectators; and restart recovery. Recovery tests must include writes made both before and after a backup so the current data-loss window is visible.

## License and source references

Retain upstream copyright and license notices. Publish corresponding source for modified Lishogi and its bundled copyleft engines when distributing the service. `UPSTREAM.json` identifies the source repositories and commits. Do not publish secrets.

Official documentation checked on October 8, 2026:

- https://developers.cloudflare.com/containers/faq/
- https://developers.cloudflare.com/containers/guides/snapshots/
- https://developers.cloudflare.com/containers/concepts/placement/
- https://developers.cloudflare.com/containers/configuration/workers-connections/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/email-service/get-started/send-emails/
