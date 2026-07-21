# ADR 0001: Secure service boundary

- Status: Accepted
- Date: 2026-07-20
- Decision owners: Repository maintainers

## Context

`market-intelligence-browser` is a private browser automation service deployed on Railway. Its intended consumer is a controlled set of n8n investment-intelligence workflows. The first planned source is authenticated Seeking Alpha pages.

Browser automation is a privileged capability. An endpoint that accepts arbitrary URLs could be abused as a general-purpose scraping proxy or used to reach unintended network resources. Authenticated sessions and extracted investment data also require a clear boundary between trusted workflow callers and public traffic.

The original template exposed demonstration e-commerce scraping, generic scraping, caller-provided URL navigation, and external-site smoke tests. It also wrote production logs to container files. Those behaviors do not fit this service's purpose or Railway's operational model.

## Decision

### Authentication boundary

All application routes under `/api/*` require HTTP bearer-token authentication.

The service reads the expected token from the `SERVICE_API_KEY` environment variable. A trusted caller sends the same secret in this header:

```http
Authorization: Bearer <SERVICE_API_KEY>
```

Missing and incorrect credentials receive the same `401 Unauthorized` response. The comparison uses fixed-length SHA-256 digests with a timing-safe equality check. Neither the API key nor the `Authorization` header may be logged.

`SERVICE_API_KEY` is mandatory when `NODE_ENV=production`. Production startup fails before the server begins listening if the variable is absent or empty.

### Public endpoints

`GET /health` remains public and lightweight so Railway and operational monitors can verify that the process is available without possessing application credentials.

Swagger UI and the OpenAPI document may remain public because they contain interface documentation, not authenticated data. Every application operation documented under `/api/*` must declare bearer authentication.

### Browser capability boundary

The service must not expose an endpoint that accepts a caller-provided URL or otherwise acts as a general-purpose browser or scraping proxy.

The foundation exposes only `POST /api/browser/smoke`. It launches and closes Chromium without creating a page, navigating, authenticating to a source, or extracting content.

Future source integrations must use server-owned, source-specific destinations and narrowly defined request and response contracts. Adding a new source or broadening navigation behavior requires an explicit architectural review and, when the trust boundary changes, a new ADR.

### Secret ownership and lifecycle

Railway stores `SERVICE_API_KEY` as a service environment variable. n8n stores the matching value as a credential or protected environment variable and injects it into outbound requests.

The secret must not be committed to Git, placed in workflow exports, embedded in source code, included in URLs, or written to logs. Rotation is performed by generating a new random secret, updating Railway and n8n in a coordinated change, redeploying the service, verifying calls, and retiring the old value.

This milestone uses one shared service key. Per-workflow credentials, multiple active keys, scoped permissions, expiration, and automated rotation are deferred until operational requirements justify them.

### Logging and deployment

Production logs are structured and written to stdout/stderr so Railway captures them in Deploy Logs. The service does not rely on container log files for persistence.

The application continues to bind to the configured `HOST` and `PORT`. Railway remains responsible for deployment, TLS termination, service variables, and network exposure.

## Consequences

### Positive

- Only callers that possess the shared secret can invoke browser capabilities.
- The public health check remains compatible with Railway monitoring.
- The service cannot currently be used to navigate to arbitrary caller-selected destinations.
- Authentication and request logs do not disclose the shared secret.
- Missing production configuration fails early and visibly.
- Browser smoke tests do not depend on external sites.

### Tradeoffs

- A single shared key identifies the trusted service boundary, not an individual workflow or user.
- Railway and n8n configuration must be kept synchronized during initial setup and rotation.
- Updating the Railway variable causes a deployment or restart, and calls using the old n8n value will fail until both sides match.
- Anyone who obtains the key has the same API access as n8n, so access to Railway variables and n8n credentials must be restricted.

## Non-goals

This decision does not implement:

- Seeking Alpha login or extraction
- Browser-session persistence
- Per-source selectors or parsing
- Arbitrary URL navigation
- User-level authorization or multiple API-key scopes
- Automated secret rotation
- Changes to Railway or n8n configuration

## Validation

The implementation is covered by tests for:

- public health access
- missing bearer credentials
- incorrect bearer credentials
- valid bearer credentials
- Chromium launch and cleanup without page creation or navigation
- production startup rejection when `SERVICE_API_KEY` is missing

## Revisit this decision when

- more than one independent caller needs access
- different callers require different permissions
- zero-downtime key rotation is required
- Railway private networking fully removes public ingress
- a source integration requires navigation behavior that changes the current trust boundary
