# Market Intelligence Browser

A narrowly scoped Playwright service for authenticated browser automation used by investment-intelligence workflows. It is designed for deployment on Railway and is not a general-purpose URL browser or scraping proxy.

This foundation milestone intentionally implements no Seeking Alpha login, session storage, selectors, or data extraction.

Architecture decisions are recorded in [`docs/adr`](docs/adr). See [ADR 0001: Secure service boundary](docs/adr/0001-secure-service-boundary.md) for the authentication and browser-capability boundaries.

## Current API

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Lightweight process health check |
| `POST` | `/api/browser/smoke` | Bearer token | Launch and close Chromium without opening a page or navigating |
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
- Set `NODE_ENV=production` and `SERVICE_API_KEY` in Railway variables before deploying.

## Scripts

```text
npm run dev          Start the TypeScript development server
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
