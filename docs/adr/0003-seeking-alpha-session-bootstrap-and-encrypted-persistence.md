# ADR 0003: Seeking Alpha session bootstrap and encrypted persistence

- Status: Accepted
- Date: 2026-07-21
- Decision owners: Repository maintainers

## Context

ADR 0001 established the service authentication boundary. ADR 0002 approved a limited set of
server-owned Seeking Alpha destinations but made session bootstrap and persistence a prerequisite
for extraction work.

The Railway service needs an authenticated Seeking Alpha browser session without storing account
credentials or automating an interactive authentication challenge. The session may contain cookies
and origin storage that provide the same access as the account. It must therefore be treated as a
secret, survive Railway deployments, accept rolling cookie refreshes, and be replaceable without
turning the service into a credential or browser proxy.

Seeking Alpha does not publish a dependable authenticated-session lifetime. The design must observe
session validity rather than assume a fixed expiration period.

## Decision

### Manual, local authentication bootstrap

Initial authentication is performed with the repository's local `session:bootstrap` command. The
command launches a headed Chromium browser at the fixed Seeking Alpha login page. A maintainer
completes login interactively and confirms completion in the terminal. The command then captures the
Playwright storage state in memory and sends it directly to the service.

The command does not accept, store, or automate a Seeking Alpha username or password. Google login,
MFA, CAPTCHA, passkeys, bot challenges, and other interactive checks are not automated or bypassed.
A direct Seeking Alpha username and password may be used manually, but automated credential-based
recovery is deferred unless operational evidence shows that manual replacement is unreasonably
frequent.

The command accepts only a service origin. It constructs the administrative path itself and rejects
credentials, queries, and fragments. Transfer must use HTTPS; plain HTTP is allowed only for a local
loopback service during development. The storage state is not written to a local application file.

### Separate, temporary import boundary

Session import uses:

```text
POST /api/admin/sources/seeking-alpha/session/import
```

The operation is protected by `SEEKING_ALPHA_SESSION_ADMIN_KEY`, not `SERVICE_API_KEY`. Because one
HTTP `Authorization` header cannot carry two independent bearer credentials, this narrow route is
mounted before the general `/api` bearer middleware and authenticates exclusively with the admin
key.

Import is also controlled by `SEEKING_ALPHA_SESSION_IMPORT_ENABLED`, which defaults to `false`.
When disabled, the route returns `404` and cannot be invoked. The intended replacement sequence is:

1. Set a temporary admin key and enable import in Railway.
2. Deploy, then run the local bootstrap command against Railway's public HTTPS origin.
3. Verify the session through the normal protected check operation.
4. Disable import and remove the admin key from Railway.

The regular service key cannot import a session. The import response contains only `importedAt`; it
never returns storage state, cookies, or account data.

### Encrypted, persistent storage

The local command minimizes the captured state to Seeking Alpha cookie domains and the exact approved
origin before transfer. The server independently rejects cookies and origin storage outside those
boundaries, validates the submitted value as bounded Playwright storage state, and encrypts it with
AES-256-GCM before the application performs its first managed filesystem write. The encrypted JSON
envelope contains:

```text
version
algorithm
iv
authTag
ciphertext
```

Version 1 uses a fresh 96-bit random IV, authenticated additional data tied to this application and
envelope version, and a 256-bit key supplied as base64. The encrypted payload contains the storage
state, `importedAt`, and optional `lastVerifiedAt` values.

The service writes a new mode-`0600` temporary file in the destination directory, atomically renames
it over the prior envelope, and reapplies mode `0600`. Partial writes therefore do not replace the
last usable session. It never logs or returns plaintext, encryption material, or envelope contents.
Plaintext necessarily exists in process memory while Playwright uses it; Chromium may also use its
own ephemeral runtime storage. No application-managed plaintext session file is created.

`SEEKING_ALPHA_SESSION_PATH` must point at a mounted Railway volume in production. At startup, the
service creates the parent directory if needed and verifies it with an actual restrictive-mode write
probe whenever session use or import is enabled. Startup fails if persistence is misconfigured or
unwritable.

Railway mounts a volume after the image is built and initially owns the mount as root, which hides
the `/data` ownership established in the image. The container therefore starts through a fixed,
root-owned entrypoint that may change ownership and mode only for the dedicated `/data` volume. It
sets `/data` to UID/GID `1001` with mode `0700`, applies a restrictive umask, and immediately replaces
itself with the application process through `gosu`. Node and Chromium consequently run as the
non-root `nodejs` user. Running the entire service with `RAILWAY_RUN_UID=0` is rejected because it
would unnecessarily expand the browser process's privileges.

`SEEKING_ALPHA_SESSION_ENCRYPTION_KEY` is a sealed Railway variable and must decode to exactly 32
bytes. It must be backed up separately in an approved secret store: a volume backup is unusable
without the key. There is no transparent key rotation in version 1. To rotate, disable source use,
deploy with a new key and temporary import access, bootstrap a fresh session, verify it, and disable
import again.

### Runtime isolation and refreshed state

Each authenticated operation creates a fresh non-persistent Playwright browser context initialized
from the decrypted state. Contexts are never shared between operations. After a successful
authenticated operation, the service captures the refreshed state and replaces the encrypted
envelope while retaining `importedAt` and updating `lastVerifiedAt`.

All Seeking Alpha browser operations pass through one bounded process-local queue. Only one operation
runs at a time. The queue admits one active operation plus
`SEEKING_ALPHA_MAX_QUEUE_SIZE` waiting operations and enforces
`SEEKING_ALPHA_MIN_NAVIGATION_INTERVAL_MS` between starts. Concurrent equivalent session checks
share the same in-flight result. Imports use the same queue so an older active check cannot overwrite
a newly imported session.

This version runs one service replica. A process-local queue does not coordinate multiple replicas;
horizontal scaling requires a distributed lease before it is enabled.

### Verification and state contract

Normal callers use `SERVICE_API_KEY` with:

```text
POST /api/sources/seeking-alpha/session/check
```

The check loads the encrypted state into a new context and navigates only to the fixed approved
Quant-alert history page. A route guard blocks unexpected top-level navigation before it completes.
Login redirects and login forms are classified as expired; recognized challenge paths and content
are classified as requiring manual intervention.

The response exposes only these states and nonsensitive timestamps:

| State | Meaning | HTTP status |
| --- | --- | --- |
| `VALID` | The approved authenticated page loaded; refreshed state was persisted | `200` |
| `MISSING` | No encrypted session envelope exists | `200` |
| `EXPIRED` | Login is required | `200` |
| `CHALLENGE_REQUIRED` | Manual challenge handling is required | `200` |
| `UNAVAILABLE` | Source disabled, queue full, circuit open, persistence failed, or upstream failed | `503` |

The data also includes a bounded machine-readable `reason`. Raw Playwright errors, URLs, HTML,
cookies, account identifiers, and credentials are not returned. Browser and persistence exceptions
are normalized before logging.

Authentication, challenge, access-denial, and rate-limit outcomes are not retried. There are no
automatic retries in the session check. After three consecutive genuine upstream or browser
failures, a process-local circuit opens for 15 minutes. A valid, expired, or challenge result resets
that failure count. Future extraction operations must honor `Retry-After` and may add only tightly
bounded retries for demonstrably transient network failures.

An n8n workflow may call the check once daily and before scheduled source work. `EXPIRED` and
`CHALLENGE_REQUIRED` stop source work and trigger a maintainer notification. An invalid third-party
session does not make the process unhealthy, so public `GET /health` remains independent.

### Configuration

The finalized configuration is:

```text
SEEKING_ALPHA_ENABLED=false
SEEKING_ALPHA_SESSION_PATH=/data/seeking-alpha-session.enc
SEEKING_ALPHA_SESSION_ENCRYPTION_KEY=<base64 32-byte key>
SEEKING_ALPHA_SESSION_ADMIN_KEY=<temporary independent bearer key>
SEEKING_ALPHA_SESSION_IMPORT_ENABLED=false
SEEKING_ALPHA_MAX_QUEUE_SIZE=10
SEEKING_ALPHA_MIN_NAVIGATION_INTERVAL_MS=5000
SEEKING_ALPHA_NAVIGATION_TIMEOUT_MS=30000
```

The encryption key is required when session use or import is enabled. The admin key is required only
when import is enabled. Production configuration remains invalid without `SERVICE_API_KEY`.

## Consequences

### Positive

- Railway never needs Seeking Alpha account credentials.
- Session replacement requires both an independently scoped secret and an explicit temporary switch.
- Persistent session material is confidential and authenticated at rest.
- Root-owned Railway volume initialization does not require Node or Chromium to run as root.
- Rolling cookie refreshes survive deployments without sharing browser contexts.
- Expiry and challenges become explicit operational states rather than retry loops.
- Navigation pacing, queue bounds, deduplication, and circuit breaking limit accidental upstream load.

### Tradeoffs

- A maintainer must perform interactive reauthentication when the session expires or is challenged.
- Losing the encryption key makes the persisted session unrecoverable.
- Enabling import requires a Railway configuration change and deployment.
- The service relies on page and challenge signals that may drift and require maintenance.
- One-replica operation is required until concurrency coordination is distributed.

## Rejected alternatives

### Store Seeking Alpha credentials in Railway and automate login

Rejected for the initial implementation because it expands the secret set and cannot safely handle
interactive challenges without encouraging bypass behavior.

### Persist plaintext Playwright storage state

Rejected because volume access or backup disclosure would directly expose the authenticated session.

### Protect import with `SERVICE_API_KEY`

Rejected because normal workflow callers do not need authority to replace account authentication
material.

### Leave the import endpoint continuously enabled

Rejected because session replacement is rare and should require an explicit operational window.

### Reuse one long-lived browser context

Rejected because state and failures would leak across operations and safe recovery would be harder.

### Assume a fixed session lifetime

Rejected because the upstream lifetime is not published and rolling state may extend it.

## Non-goals

This decision does not implement:

- Seeking Alpha data extraction
- automated login or credential recovery
- challenge, CAPTCHA, MFA, or passkey bypass
- a distributed queue or multi-replica session lease
- automated encryption-key rotation
- returning session material through any API

## Validation

The implementation is covered by tests for:

- independent admin and service bearer boundaries
- import disabled by default
- schema validation before persistence
- rejection of non-Seeking Alpha cookie and origin state
- encryption without plaintext leakage in the envelope
- authenticated-encryption tamper detection
- atomic encrypted replacement and decryption
- missing-session behavior without browser launch
- isolated-context verification and refreshed-state persistence
- normalized browser failures without secret-bearing error output
- serialized operation order and bounded queue behavior

Live authenticated checks are manual and opt-in. Production session material is not used in CI.

## Revisit this decision when

- manual session replacement becomes operationally frequent
- Seeking Alpha changes its authentication or challenge flow
- the service needs more than one replica
- multiple source accounts or administrative roles are required
- transparent encryption-key rotation is required
- volume or browser-runtime guarantees materially change
