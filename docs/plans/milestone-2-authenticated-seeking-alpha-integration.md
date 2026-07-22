# Milestone 2: Authenticated Seeking Alpha integration

## Objective

Build the authenticated, source-specific Seeking Alpha integration on top of the secure browser-service foundation.

This is an umbrella milestone. Implement each phase in a separate branch and pull request so session security, extraction behavior, and page-shape drift remain independently reviewable.

ADR 0002 defines the navigation boundary and verified page inventory. ADR 0003 defines session
bootstrap, encrypted persistence, verification, recovery, isolation, and concurrency.

## Verified page inventory

### Quant Rating

- Summary: `/symbol/{ticker}`
  - page container: `symbol-page`
  - header: `symbol-page-info-section`
  - price: `symbol-price`
  - rating row links to `/symbol/{ticker}/ratings/quant-ratings`
- Dedicated rating page: `/symbol/{ticker}/ratings/quant-ratings`
  - Quant container: `card-container-quant-rating`
  - scoped rating elements: `card-rating`
  - price: `symbol-price`
- Values are client-side hydrated and initially render placeholders.

### Quant alert history

- Fixed destination: `/account/edit_price_alerts?tab=history`
- `tab=history` is functional.
- `source` is attribution-only and must be discarded.
- Rows link to `/symbol/{ticker}/ratings/quant-ratings`.

### Alpha Picks

- Analysis: `/alpha-picks/articles`
- Article: `/alpha-picks/articles/{numeric-id}-{slug}`
- Current: `/alpha-picks/picks/current`
- Closed: `/alpha-picks/picks/removed`
- Performance: `/alpha-picks/performance`

Observed record identity:

- article: numeric article ID
- current recommendation: ticker plus picked date
- closed recommendation: ticker plus picked date plus closed date
- ticker alone is not unique

## Security constraints

- [ ] Keep all `/api/*` operations behind `SERVICE_API_KEY`.
- [ ] Do not accept caller-supplied absolute URLs, hosts, schemes, ports, or arbitrary paths.
- [ ] Accept typed identifiers and construct URLs from server-owned templates.
- [ ] Validate tickers, numeric content IDs, and slugs before construction and again before navigation.
- [ ] Allow only exact approved Seeking Alpha top-level destinations and redirects.
- [ ] Treat redirect to `/account/login` as `SESSION_EXPIRED`.
- [ ] Do not navigate through `email-st.seekingalpha.com` tracking URLs.
- [ ] Do not log or return cookies, storage state, credentials, tracking tokens, query values, portfolio identifiers, or raw page HTML.
- [ ] Normalize browser errors before logging so sensitive URLs cannot appear in error stacks.
- [ ] Do not implement CAPTCHA, MFA, or bot-challenge bypass behavior.

## Phase 1: Session foundation

Before implementation, record the chosen bootstrap and persistence design.

- [x] Decide manual versus automated login bootstrap.
- [x] Define MFA and challenge behavior.
- [x] Define encrypted Playwright storage-state persistence.
- [x] Define Railway persistence and secret variables.
- [x] Define session expiry, verification, rotation, and recovery.
- [x] Define browser-context isolation and concurrency behavior.
- [x] Add protected `POST /api/sources/seeking-alpha/session/check`.
- [x] Return structured states such as `VALID`, `EXPIRED`, `CHALLENGE_REQUIRED`, and `UNAVAILABLE`.
- [x] Cover secret redaction and failure behavior with tests.

## Phase 2: Ticker price and Quant Rating

- [x] Add a protected, ticker-based Quant lookup operation.
- [x] Normalize and validate the ticker; do not accept a URL.
- [x] Construct `/symbol/{ticker}/ratings/quant-ratings` internally.
- [x] Wait for `card-container-quant-rating`.
- [x] Scope repeated `card-rating` lookups beneath the Quant container.
- [x] Reject placeholders, empty values, not-covered states, and incomplete hydration.
- [x] Validate the rating vocabulary.
- [x] Parse and range-check the numeric score.
- [x] Read hydrated `symbol-price`.
- [x] Return ticker, rating, score, observed price, canonical path, and observation time.
- [x] Provide explicit errors for session expiry, hydration timeout, unsupported state, and selector drift.
- [x] Add unit tests with delayed hydration and placeholder transitions.

### Phase 2 contract

`POST /api/sources/seeking-alpha/quant-ratings/lookup` accepts a strict JSON body containing only
`ticker`. The service trims and uppercases the value, then requires a 1–15 character symbol that
starts with a letter and otherwise contains letters, digits, dots, or hyphens. It constructs the
canonical path internally and rejects query parameters, unexpected redirects, and off-origin
top-level navigation.

The response normalizes the rating vocabulary to `STRONG_SELL`, `SELL`, `HOLD`, `BUY`, or
`STRONG_BUY`. The score is a number from 1 through 5, and the observed price is a positive number.
The operation returns only those values, the normalized ticker, canonical path, and observation
timestamp; it never returns HTML or a caller/upstream URL.

Phase 2 reuses the Phase 1 encrypted session store, isolated browser context, serialized operation
queue, redirect classification, circuit breaker, and refreshed-state persistence. Its bounded error
codes are:

| Code                                                                    | HTTP status | Meaning                                                        |
| ----------------------------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| `INVALID_TICKER`                                                        | `400`       | The request is not a supported ticker-only input               |
| `SESSION_MISSING`                                                       | `409`       | No encrypted session is available                              |
| `SESSION_EXPIRED`                                                       | `409`       | Seeking Alpha requires login                                   |
| `CHALLENGE_REQUIRED`                                                    | `409`       | Manual verification is required                                |
| `UNSUPPORTED_STATE`                                                     | `422`       | The ticker is explicitly not covered or not rated              |
| `SELECTOR_DRIFT`                                                        | `502`       | Required page structure or hydrated value shape changed        |
| `SOURCE_DISABLED`, `QUEUE_FULL`, `CIRCUIT_OPEN`, `UPSTREAM_UNAVAILABLE` | `503`       | The operation is unavailable without exposing upstream details |
| `HYDRATION_TIMEOUT`                                                     | `504`       | Approved selectors remained incomplete or placeholders         |

## Phase 3: Quant alert-history ingestion

- [ ] Navigate only to `/account/edit_price_alerts?tab=history`.
- [ ] Ignore and discard `source` and all tracking parameters.
- [ ] Extract triggered rating-change rows and ticker links.
- [ ] Define a stable event identity or idempotency contract.
- [ ] Return structured rows without portfolio or account details.
- [ ] Detect empty, expired-session, and selector-drift states.
- [ ] Add fixture-driven tests.

## Phase 4: Alpha Picks synchronization

### Analysis

- [ ] Extract the rendered article set from `/alpha-picks/articles`.
- [ ] Key articles by numeric ID.
- [ ] Capture title, publication date, ticker links, and classified intent.
- [ ] Classify buy, exit, downgrade-to-sell, and removed language without using title as identity.

### Current and closed recommendations

- [ ] Extract current rows from `/alpha-picks/picks/current`.
- [ ] Extract closed rows from `/alpha-picks/picks/removed`.
- [ ] Capture the verified columns.
- [ ] Use recommendation identity rather than ticker alone.
- [ ] Detect new and removed recommendations by comparing synchronized records, not presentation badges.
- [ ] Preserve multiple recommendation and exit cycles for the same ticker.

### Performance

- [ ] Extract combined performance rows from `/alpha-picks/performance`.
- [ ] Capture purchase price, sell price, return, benchmark return, and difference where available.
- [ ] Reconcile performance records with current and closed recommendation identity.

### Completeness

- [ ] Detect unexpected pagination, truncation, or record-count changes rather than silently assuming the first rendered set is complete.
- [ ] Add fixture-driven tests for duplicate tickers and repeat recommendations.

## API and response requirements

- [ ] Keep the common structured success and error envelope.
- [ ] Document bearer authentication and every new operation in OpenAPI.
- [ ] Do not return raw HTML.
- [ ] Include observation timestamps and non-sensitive canonical paths.
- [ ] Make retries and idempotency safe for n8n.
- [ ] Avoid unrelated refactoring and broad dependency upgrades.

## Validation

For each implementation pull request:

- [ ] TypeScript build
- [ ] unit tests
- [ ] relevant end-to-end tests
- [ ] lint
- [ ] typecheck
- [ ] format check
- [ ] `npm audit --omit=dev`
- [ ] explicit scan confirming secrets and raw tracking URLs are absent from fixtures and logging

Live authenticated checks must be opt-in and must not run in CI with production credentials.

### Phase 2 production validation

The opt-in production AAPL lookup on 2026-07-22 reached the approved Quant Rating destination but
rendered Seeking Alpha's in-page `PRESS & HOLD` challenge without changing the top-level URL. The
initial `SELECTOR_DRIFT` response was therefore a classification error, not evidence that the Quant
selectors had changed. The operation now recognizes both the early and client-delayed forms of this
challenge and returns `CHALLENGE_REQUIRED` without attempting to bypass it.

The authenticated production page shape remains unconfirmed while Seeking Alpha presents the
challenge. Repeat the opt-in lookup after manual verification succeeds; do not weaken challenge
detection or add automated challenge handling.

## Out of scope

- PostgreSQL schema and migrations
- n8n workflow implementation
- Schwab market-data retrieval
- technical and sector scoring
- automated trading
- unrestricted Seeking Alpha browsing or search
- challenge bypass behavior
