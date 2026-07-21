# ADR 0002: Controlled Seeking Alpha navigation

- Status: Accepted
- Date: 2026-07-20
- Decision owners: Repository maintainers
- Supersedes: The absolute prohibition on caller-influenced navigation in ADR 0001

## Context

ADR 0001 established a conservative service boundary: application routes require bearer authentication, the service must not become a general-purpose browser, and no endpoint accepts an arbitrary caller-provided URL.

Authenticated inspection has now identified the concrete Seeking Alpha workflows and page shapes needed by the investment-intelligence platform:

1. Scheduled Alpha Picks synchronization around the first and fifteenth of each month.
2. Event-driven Quant Rating lookups following Seeking Alpha email alerts.
3. Potential retrieval of specific Seeking Alpha news and analysis content referenced by email alerts.

Seeking Alpha email links use `email-st.seekingalpha.com/click/...` tracking paths. The middle tracking-path component encodes the intended Seeking Alpha destination. n8n can decode that component without browser navigation. The encoded destinations include analytics and potentially account-associated query values that must not be retained or logged.

Authenticated page inspection also confirmed that several pages render placeholders before client-side hydration populates real values. A locator being present is therefore insufficient evidence that extraction is complete.

## Decision

### Preserve the source-specific boundary

The service may navigate only to documented Seeking Alpha destinations. It must not accept a caller-supplied absolute URL, hostname, scheme, port, or arbitrary path.

Callers provide typed identifiers such as:

- ticker
- Seeking Alpha content kind
- numeric article or news identifier
- sanitized slug

The service validates those identifiers and constructs the destination from server-owned route templates.

This permits caller-influenced selection of a Seeking Alpha resource while preserving the prohibition on unrestricted browsing.

### Approved server-owned destinations

The initial fixed destinations are:

```text
/alpha-picks/articles
/alpha-picks/picks/current
/alpha-picks/picks/removed
/alpha-picks/performance
/account/edit_price_alerts?tab=history
```

The initial parameterized destination families are:

```text
/symbol/{ticker}
/symbol/{ticker}/ratings/quant-ratings
/alpha-picks/articles/{numeric-id}-{slug}
/news/{numeric-id}-{slug}
/article/{numeric-id}-{slug}
```

The navigation origin is fixed to `https://seekingalpha.com` in application code. The caller cannot override it.

### Identifier validation

Tickers must be normalized to uppercase and accepted only when they consist of a bounded sequence of letters, digits, periods, or hyphens. Values containing slashes, URL encoding, whitespace, query syntax, fragments, or credentials are rejected.

Content identifiers must be positive decimal integers. Slugs must use a bounded lowercase letter, digit, underscore, and hyphen character set. The numeric identifier is the durable upstream content identity; slugs and titles are descriptive and must not be used as record keys by themselves.

Validation must occur before destination construction. Constructed URLs must be parsed and checked again before navigation.

### Email tracking links

n8n may recognize and decode the observed `email-st.seekingalpha.com/click/...` format. It must validate the decoded scheme, hostname, and path before mapping the destination to typed browser-service inputs.

The browser service does not navigate to the email tracking hostname. It does not accept the original tracking URL or decoded absolute URL.

For news and analysis destinations, all query parameters are discarded. Marketing and identity parameters such as `userid`, `messageid`, `mailingid`, `serial`, `sailthru_auth_param`, and `utm_*` are never sent to the browser service or persisted.

For Quant alert history, only the functional `tab=history` behavior is retained. The observed `source` parameter did not change selected content and is discarded.

If Seeking Alpha changes the tracking format, a controlled resolver may be considered separately. It must not be implemented as a generic redirect-following endpoint.

### Redirect policy

Every top-level navigation and redirect destination must remain on the exact approved Seeking Alpha origin and match an approved path family.

An unexpected redirect to `/account/login` is classified as an expired or invalid session. It must not trigger an uncontrolled login attempt.

Off-origin top-level redirects are rejected. Page subresources may use additional Seeking Alpha-operated delivery hosts; subresource policy is distinct from top-level navigation authority and must not broaden the allowed destination routes.

### Client-side hydration

Extraction must wait for the specific content container and for its values to become valid. A successful HTTP response, page load event, or locator match alone is not sufficient.

For Quant Rating extraction:

- Navigate to `/symbol/{ticker}/ratings/quant-ratings`.
- Wait for `card-container-quant-rating`.
- Scope repeated `card-rating` elements beneath that container.
- Reject placeholder, empty, not-covered, or otherwise incomplete states.
- Validate the rating against the supported rating vocabulary.
- Parse and range-check the numeric score.
- Read price from `symbol-price` only after it is populated.
- Return a specific hydration-timeout or unsupported-state error rather than persisting placeholders.

The Summary page may be used as a fallback by locating the Ratings Summary row whose link ends in `/ratings/quant-ratings`, then reading rating and score from that row.

### Alpha Picks record identity

Alpha Picks synchronization uses these upstream identities:

- Analysis article: numeric article ID.
- Current recommendation: ticker plus picked date unless a stable upstream recommendation ID is later discovered.
- Closed recommendation: ticker plus picked date plus closed date unless a stable upstream recommendation ID is later discovered.
- Performance record: the same recommendation identity used by current and closed records.

Ticker alone is not unique because a company may be recommended and exited more than once.

New recommendations are detected by comparing synchronized records, not by relying on presentation badges. Removal is represented by membership on `/alpha-picks/picks/removed` and a closed date.

### Initial service operations

The intended source-specific operations are:

```text
POST /api/sources/seeking-alpha/session/check
POST /api/sources/seeking-alpha/quant-ratings/lookup
POST /api/sources/seeking-alpha/quant-alerts/sync
POST /api/sources/seeking-alpha/alpha-picks/sync
POST /api/sources/seeking-alpha/content/fetch
```

These names describe the intended contracts; implementation may refine them without weakening the navigation boundary.

The Quant Rating lookup accepts a ticker, not a URL. The content operation accepts typed content identity, not a URL. Alpha Picks and Quant alert-history operations use fixed destinations and accept no navigation target.

### Authentication material and logging

Seeking Alpha cookies, storage state, credentials, portfolio identifiers, email tracking tokens, and authentication parameters are secrets.

They must not appear in:

- application logs
- API responses
- error messages or stack traces returned to callers
- Git history
- OpenAPI examples
- test fixtures
- n8n workflow exports

Request logging remains limited to method, path, status, and duration. Browser errors must be normalized before logging so navigation URLs and sensitive query values are not disclosed.

### Session handling

This ADR defines how an authenticated session may be used, but it does not select the session bootstrap or persistence mechanism.

The implementation milestone must separately decide:

- manual versus automated login bootstrap
- MFA and challenge handling without bypass behavior
- encrypted storage-state persistence
- Railway persistence requirements
- session expiry and rotation
- concurrency and browser-context isolation

No extraction endpoint is production-ready until that session design is accepted and covered by tests.

## Consequences

### Positive

- Verified email and Alpha Picks workflows are supported without arbitrary URL navigation.
- Marketing and account-associated tracking parameters are removed before browser use.
- Typed inputs produce smaller, testable validation contracts.
- Client-side placeholders cannot be mistaken for valid investment data.
- Alpha Picks records can represent repeated recommendations for one ticker.
- The boundary remains compatible with future source-specific operations.

### Tradeoffs

- New Seeking Alpha page families require code and architectural review.
- Changes to tracking-link encoding require n8n mapping updates.
- Hydration-aware extraction is more complex than waiting for page load.
- Selector and page-shape drift must produce explicit operational failures.
- Session persistence remains a separate prerequisite.

## Rejected alternatives

### Accept arbitrary absolute URLs from n8n

Rejected because bearer authentication does not remove SSRF, redirect, or general-purpose proxy risk.

### Navigate through email tracking links

Rejected because decoding is deterministic, navigation would unnecessarily disclose tracking activity, and the links can contain account-associated data.

### Strip all Quant-history query parameters

Rejected because `tab=history` materially selects triggered rating and price alerts. The unrelated `source` parameter is still discarded.

### Treat ticker as the Alpha Picks primary key

Rejected because a ticker can have multiple recommendation and exit cycles.

### Extract as soon as selectors exist

Rejected because authenticated inspection demonstrated placeholder values before client-side hydration completed.

## Non-goals

This decision does not define:

- PostgreSQL schemas
- n8n workflow implementation
- Schwab market-data retrieval
- opportunity scoring
- automated trading
- session bootstrap credentials
- CAPTCHA or MFA bypass
- unrestricted Seeking Alpha search

## Revisit this decision when

- Seeking Alpha introduces a required destination outside the approved origin
- a stable upstream recommendation identifier becomes available
- email tracking can no longer be decoded deterministically
- top-level navigation requires a new authentication origin
- multiple callers require different navigation permissions
