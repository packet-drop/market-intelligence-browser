# Market Intelligence Browser

A narrowly scoped Playwright service for authenticated browser automation used by investment-intelligence workflows. It is designed for deployment on Railway and is not a general-purpose URL browser or scraping proxy.

The service implements manual Seeking Alpha session bootstrap and encrypted persistence. It does not
automate login or extract Seeking Alpha content yet.

Architecture decisions are recorded in [`docs/adr`](docs/adr):

- [ADR 0001: Secure service boundary](docs/adr/0001-secure-service-boundary.md)
- [ADR 0002: Controlled Seeking Alpha navigation](docs/adr/0002-controlled-seeking-alpha-navigation.md)
- [ADR 0003: Seeking Alpha session bootstrap and encrypted persistence](docs/adr/0003-seeking-alpha-session-bootstrap-and-encrypted-persistence.md)

Implementation milestones are recorded in [`docs/plans`](docs/plans). The current roadmap is [Milestone 2: Authenticated Seeking Alpha integration](docs/plans/milestone-2-authenticated-seeking-alpha-integration.md).

## Current API

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Lightweight process health check |
| `POST` | `/api/browser/smoke` | Bearer token | Launch and close Chromium without opening a page or navigating |
| `POST` | `/api/sources/seeking-alpha/session/check` | Service bearer token | Verify the encrypted Seeking Alpha session |
| `POST` | `/api/admin/sources/seeking-alpha/session/import` | Admin bearer token; disabled by default | Import locally bootstrapped Playwright storage state |
| `GET` | `/docs` | Public | Swagger UI |
| `GET` | `/openapi.json` | Public | OpenAPI document |

No endpoint accepts a caller-provided URL.

## Configuration

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `HOST` | `0.0.0.0` | Express bind host; preserves Railway container behavior |
| `PORT` | `3000` | Express port; Railway may supply this value |
| `SERVICE_API_KEY` | none | Bearer token for `/api/*`; required at production startup |
| `LOG_LEVEL` | `info` | Structured Winston log level |
| `CORS_ORIGIN` | `*` | Allowed origin, or a comma-separated list |
| `PLAYWRIGHT_HEADLESS` | `true` | Whether Chromium launches headlessly |
| `SEEKING_ALPHA_ENABLED` | `false` | Enable authenticated Seeking Alpha operations |
| `SEEKING_ALPHA_SESSION_PATH` | `/data/seeking-alpha-session.enc` | Encrypted envelope path on a persistent volume |
| `SEEKING_ALPHA_SESSION_ENCRYPTION_KEY` | none | Base64-encoded 32-byte AES key; required when use or import is enabled |
| `SEEKING_ALPHA_SESSION_ADMIN_KEY` | none | Temporary import bearer key, distinct from `SERVICE_API_KEY` |
| `SEEKING_ALPHA_SESSION_IMPORT_ENABLED` | `false` | Temporarily expose the admin import operation |
| `SEEKING_ALPHA_MAX_QUEUE_SIZE` | `10` | Maximum waiting Seeking Alpha operations, in addition to one active operation |
| `SEEKING_ALPHA_MIN_NAVIGATION_INTERVAL_MS` | `5000` | Minimum delay between top-level Seeking Alpha operation starts |
| `SEEKING_ALPHA_NAVIGATION_TIMEOUT_MS` | `30000` | Session-verification navigation timeout |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX` | `60` | Requests allowed per window |

Generate a long random value for `SERVICE_API_KEY`. Do not commit it or print it in logs. Production startup fails with a clear configuration error when it is missing.

## Local development

```bash
npm ci
npm run dev
```

Call the protected smoke endpoint:

```bash
curl -X POST http://localhost:3000/api/browser/smoke \
  -H "Authorization: Bearer $SERVICE_API_KEY"
```

A successful response uses the common response envelope:

```json
{
  "success": true,
  "data": {
    "browser": "chromium",
    "launched": true,
    "headless": true,
    "version": "..."
  },
  "meta": {
    "durationMs": 123,
    "timestamp": "2026-07-20T00:00:00.000Z"
  }
}
```

Missing or incorrect tokens return the same `401 Unauthorized` envelope and are never logged. Errors use the same envelope with `success: false`.

## Seeking Alpha session bootstrap

Attach a Railway volume at `/data`. Generate and separately back up a session encryption key:

```bash
openssl rand -base64 32
```

Set `SEEKING_ALPHA_ENABLED=true`, the generated `SEEKING_ALPHA_SESSION_ENCRYPTION_KEY`, and a
temporary `SEEKING_ALPHA_SESSION_ADMIN_KEY` in Railway. Set
`SEEKING_ALPHA_SESSION_IMPORT_ENABLED=true` only for the import window, then deploy.

Set the same temporary admin key only in your local environment and run the headed bootstrap against
Railway's public HTTPS origin:

```bash
npm run session:bootstrap -- https://your-service.example
```

Complete login manually in Chromium and press Enter in the terminal. Verify the session through
`POST /api/sources/seeking-alpha/session/check` using `SERVICE_API_KEY`. Then set
`SEEKING_ALPHA_SESSION_IMPORT_ENABLED=false`, remove `SEEKING_ALPHA_SESSION_ADMIN_KEY` from Railway,
and redeploy. Do not send the bootstrap to Railway's private hostname; the local machine must use the
public HTTPS origin.

## Validation commands

```bash
npm run build
npm test
npm run test:e2e
npm run lint
npm run typecheck
npm run format:check
npm audit --omit=dev
```

The unit tests mock Playwright where appropriate. The e2e smoke test requires the matching Chromium revision to be installed (`npx playwright install chromium`) but does not require external network access while it runs.

## Railway and container behavior

- Express listens on `HOST` and `PORT`.
- `/health` stays public for Railway health checks.
- Production logs are structured JSON on stdout/stderr for Railway Deploy Logs; the service does not depend on container log files.
- The Docker image installs the Chromium revision matching Playwright and runs as a non-root user.
- Railway mounts `/data` as root. The container entrypoint restricts that dedicated volume to the
  application user, then drops to UID/GID `1001` before starting Node or Chromium. Do not set
  `RAILWAY_RUN_UID=0`; the entrypoint performs the narrowly scoped initialization itself.
- Set `NODE_ENV=production` and `SERVICE_API_KEY` in Railway variables before deploying.
- Mount a persistent volume at `/data` before enabling Seeking Alpha session support.
- Keep the session encryption key in Railway variables and in a separate approved secret backup.

## Scripts

```text
npm run dev          Start the TypeScript development server
npm run session:bootstrap  Interactively bootstrap and securely import a Seeking Alpha session
npm run build        Compile TypeScript to dist/
npm start            Run the compiled service
npm test             Run Jest tests
npm run test:e2e     Run Playwright API tests
npm run lint         Run ESLint
npm run typecheck    Type-check without emitting files
npm run format:check Check formatting
```

## License

MIT
