# Backend logging

**Status:** implemented (Aug 21, 2026)  
**Scope:** Express API in `server/`  
**Related:** [AGENTS.md](../AGENTS.md) · [PROGRESS.md](../progress/PROGRESS.md) · `server/.env.example`

## Table of contents

1. [Purpose](#1-purpose)
2. [Files and wiring](#2-files-and-wiring)
3. [Configuration](#3-configuration)
4. [Log levels](#4-log-levels)
5. [Output format](#5-output-format)
6. [Automatic logs](#6-automatic-logs)
7. [How to log from application code](#7-how-to-log-from-application-code)
8. [What not to log](#8-what-not-to-log)
9. [Viewing logs](#9-viewing-logs)
10. [Tests](#10-tests)
11. [Future upgrades](#11-future-upgrades)

---

## 1. Purpose

The API uses a small, zero-dependency structured logger so operators can:

- Trace HTTP requests (method, path, status, duration, authenticated user).
- Diagnose validation failures and unexpected 500s with stack traces.
- See process lifecycle events (start, graceful shutdown, crash hooks).

There is no separate logging SaaS wired yet. Logs go to stdout/stderr so Docker and process managers can collect them.

---

## 2. Files and wiring

| Path | Role |
|---|---|
| `server/src/config/logger.js` | Logger factory and default `service: delphic-api` instance |
| `server/src/config/env.js` | Exposes `logLevel` from `LOG_LEVEL` |
| `server/src/middleware/requestLogger.js` | Access log on every response (`finish`) |
| `server/src/middleware/errorHandler.js` | Logs Zod validation and thrown errors |
| `server/src/app.js` | Registers `requestLogger` after `express.json()` |
| `server/src/index.js` | Startup / shutdown / `uncaughtException` / `unhandledRejection` |
| `server/tests/logger.test.js` | Unit coverage for write + child bindings |

Request flow:

```text
Client → helmet/cors/json → requestLogger → routes → 404 handler → errorHandler
```

`requestLogger` attaches a `res.on('finish')` listener. By the time the response finishes, `req.user` is usually set if the route used auth middleware, so `user_id` and `role` appear on those lines.

---

## 3. Configuration

Set in `server/.env` (local) or compose/host environment (Docker):

| Variable | Values | Default behavior when unset |
|---|---|---|
| `LOG_LEVEL` | `error`, `warn`, `info`, `debug` | `debug` in development; `info` when `NODE_ENV=production`; `error` when `NODE_ENV=test` |
| `NODE_ENV` | `development`, `production`, `test`, … | Controls pretty vs JSON formatting and the default level above |

Examples:

```env
# Local verbose
NODE_ENV=development
LOG_LEVEL=debug

# Docker / production (compose sets NODE_ENV=production)
LOG_LEVEL=info

# Quieter production
LOG_LEVEL=warn
```

Docker Compose passes optional `LOG_LEVEL` from the root `.env`:

```yaml
LOG_LEVEL: ${LOG_LEVEL:-info}
```

Root `.env.example` and `server/.env.example` both document the variable.

---

## 4. Log levels

Higher verbosity includes lower levels (numerically: error=0 … debug=3).

| Level | Typical use |
|---|---|
| `error` | Unhandled failures, HTTP 5xx, process crashes |
| `warn` | HTTP 4xx access lines, validation failures, expected client/business errors with `err.status` |
| `info` | Successful HTTP access, `server_started`, `server_shutdown` |
| `debug` | Future fine-grained diagnostics (available for modules; not required for every call) |

If `LOG_LEVEL=warn`, `info` and `debug` lines are dropped.

---

## 5. Output format

### Development (non-production)

Human-readable single line:

```text
2026-08-21T07:00:00.000Z INFO  http_request {"service":"delphic-api","method":"GET","path":"/api/v1/users/me","status":200,"duration_ms":12,"user_id":1,"role":"admin"}
```

### Production (`NODE_ENV=production`)

One JSON object per line (stdout/stderr), suitable for log aggregators:

```json
{"ts":"2026-08-21T07:00:00.000Z","level":"info","msg":"http_request","service":"delphic-api","method":"GET","path":"/api/v1/users/me","status":200,"duration_ms":12,"user_id":1,"role":"admin"}
```

Streams:

- `error` → `console.error`
- `warn` → `console.warn`
- `info` / `debug` → `console.log`

Errors passed as `err` or `error` in the meta object are serialized to `{ name, message, stack, code, status }` so stacks appear in JSON without circular references.

---

## 6. Automatic logs

### HTTP access (`msg: http_request`)

Emitted when the response finishes, unless:

- `NODE_ENV=test` (suite stays quiet), or
- path is `/api/v1/health` (avoids probe noise).

Fields: `method`, `path`, `status`, `duration_ms`, optional `user_id`, optional `role`.

Severity by status:

- status ≥ 500 → `error`
- status ≥ 400 → `warn`
- otherwise → `info`

### Validation (`msg: validation_failed`)

Zod failures in `errorHandler`: `warn` with method, path, and issue count. Response remains HTTP 422 with the standard envelope.

### Thrown errors

| Condition | Message | Level |
|---|---|---|
| `err.status` ≥ 500 or missing (defaults to 500) | `unhandled_error` | `error` |
| Client/business error with 4xx `err.status` | `request_error` | `warn` |

### Process lifecycle (`index.js`)

| Event | Message | Notes |
|---|---|---|
| Listen success | `server_started` | Includes `port`, `env`, `log_level` |
| SIGTERM / SIGINT | `server_shutdown` | Closes HTTP server; forced exit after 10s |
| Uncaught exception | `uncaught_exception` | Exits process with code 1 |
| Unhandled rejection | `unhandled_rejection` | Logged; process is not force-killed (so Node can keep serving until you decide policy) |

---

## 7. How to log from application code

Import the shared instance (preferred):

```js
const logger = require('../../config/logger');

logger.info('account_created', { account_id: account.id, user_id: req.user.id });
logger.warn('stage_rejected', { entity: 'requirement', id, from, to });
logger.error('export_failed', { report: 'recruiter-performance', err });
logger.debug('seat_transition_detail', { seat_id, payload });
```

Child loggers add stable bindings (module name, request id later):

```js
const log = logger.child({ module: 'accounts' });
log.info('locked', { account_id: id });
```

Conventions:

- Prefer a short snake_case `msg` event name (`account_created`, not a long English sentence).
- Put structured fields in the second argument object.
- Pass exceptions as `{ err }` so stacks serialize correctly.
- Do not replace HTTP error responses with logs only — still throw or call `fail()` so clients get the API envelope.

---

## 8. What not to log

Do not write any of the following into log meta or messages:

- Passwords, password hashes, JWT access/refresh tokens, or full `Authorization` headers.
- Raw uploaded file contents.
- Unnecessary PII beyond what operators already need (prefer numeric `user_id` over email unless debugging auth).

Access logs intentionally omit request bodies.

---

## 9. Viewing logs

### Docker Compose

```bash
docker compose logs -f server
```

Filter roughly:

```bash
docker compose logs server | findstr http_request
```

(On bash: `docker compose logs -f server | grep http_request`.)

### Local `npm run dev:server`

Logs print in the same terminal as nodemon.

### Confirm level after boot

Look for `server_started` and the `log_level` field in that line.

---

## 10. Tests

- Access logging and most info logs are suppressed under `NODE_ENV=test`.
- `server/tests/logger.test.js` covers error serialization and child bindings.
- Full suite: `cd server && npm test` (includes logger tests).

---

## 11. Future upgrades

Not required for current sprint; document for later:

- Correlation / request IDs (`X-Request-Id` middleware + child logger per request).
- Shipping JSON logs to a central store (Loki, CloudWatch, Datadog, etc.).
- Swapping the thin wrapper for `pino` if volume or performance needs grow.
- Domain audit trails remain in `stage_history` (database), not in stdout logs — do not conflate the two.
