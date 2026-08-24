# API Architecture

Base path `/api/v1`. Interactive reference at `/docs`; machine-readable document at
`/openapi.json`.

## 1. Layering

```text
route      → declares the HTTP verb, its Zod schemas, and the permission it requires
controller → HTTP shape only: read req, call service, send envelope. No business logic.
service    → business rules, transactions, audit writes. Knows nothing about HTTP.
repository → shared query helpers: pagination, tenant scoping, soft-delete filtering
Prisma     → PostgreSQL
```

Controllers stay thin deliberately: nothing in `src/controllers/` makes a decision, so
business rules cannot drift between an HTTP caller, a future queue worker and the seed.

## 2. Modules

```text
/auth          /organizations   /branches     /users        /team
/roles         /permissions     /leads        /clients      /projects
/events        /shoots          /freelancers  /tasks        /attendance
/quotations    /invoices        /payments     /expenses     /deliveries
/files         /notifications   /reports      /audit        /settings
/data-management
```

## 3. Response envelope

Success:

```json
{ "success": true, "data": {}, "meta": { "requestId": "…", "pagination": {} } }
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [{ "field": "items.0.quantity", "message": "Must be greater than zero" }],
    "requestId": "…"
  }
}
```

Codes: `VALIDATION_ERROR` `UNAUTHENTICATED` `FORBIDDEN` `NOT_FOUND` `CONFLICT`
`UNPROCESSABLE` `RATE_LIMITED` `IDEMPOTENCY_CONFLICT` `IDEMPOTENCY_IN_PROGRESS`
`PAYLOAD_TOO_LARGE` `INTERNAL_ERROR`.

Raw Prisma and PostgreSQL text never reaches a client. `src/middleware/errorHandler.ts`
maps every failure — `P2002` → `409`, `P2025` → `404`, SQLSTATE `23514` (a CHECK
constraint) → `422` — and logs the underlying cause server-side only.

## 4. Authentication

- **Access token** — JWT, 15 minutes, `Authorization: Bearer …` or an HTTP-only cookie
- **Refresh token** — opaque 48-byte random string, 7 days, stored only as a SHA-256 hash

Refresh rotates: presenting a refresh token retires it as the new pair is issued, so it is
single-use and reuse is detectable.

The access token proves *identity only*. On every request the user, session, roles and
permissions are re-read from PostgreSQL, so a revoked session, disabled account or
permission removed a second ago takes effect immediately rather than lingering until the
token expires.

Passwords are bcrypt (cost 12) and must be 10+ characters with mixed case and a digit.
Five consecutive failures lock the account for 15 minutes. Login responses are identical
whether or not the account exists, so the endpoint cannot be used to enumerate users.
Changing a password revokes every other session. A password hash is never selected into
a response payload.

## 5. Authorization

Roles are named bundles of permissions; permissions are a separate global catalogue
(90 keys across 24 modules, `src/types/permissions.ts`). Every protected route declares
what it needs:

```ts
paymentRouter.post('/',
  requirePermission('PAYMENT_CREATE'),
  validate({ body: createPaymentSchema }),
  idempotent({ required: true }),
  controller.createPayment);
```

Seeded roles: **ADMIN** (all 90), **MANAGER** (81 — no role/permission administration,
no audit access, no organization settings), **MEMBER** (24 — read plus own tasks,
attendance and expense submission).

Frontend permission state is a display convenience for hiding buttons. It is never
trusted; authorization is decided server-side on every request.

## 6. Lists: search, filter, sort, paginate

Every list endpoint supports `search`, resource-specific filters, `sortBy`/`sortOrder`,
`page`/`limit`, and `from`/`to` date ranges.

```http
GET /api/v1/projects?search=wedding&status=CONFIRMED&page=1&limit=25
GET /api/v1/shoots?from=2026-08-01&to=2026-08-31&status=COMPLETED
GET /api/v1/payments?projectId=…&page=1&limit=25
```

`limit` is clamped to `MAX_PAGE_SIZE` server-side, and `sortBy` is matched against a
per-resource whitelist so it can never inject a column. Date ranges are half-open
`[from, to+1day)`, so `to=2026-08-31` includes every moment of that day. The page and its
total count are read in one transaction so they cannot disagree under concurrent writes.

## 7. Validation

Zod validates `body`, `params` and `query` before any database call, and *replaces* the
request parts with parsed output so handlers receive coerced, typed values. Money is
accepted as a string or number and rejected unless it has at most two decimals; dates must
be `YYYY-MM-DD`; ids must be UUIDs; enums are closed.

## 8. Transactions

Atomic, all-or-nothing operations:

| Operation | Committed together |
|---|---|
| Project creation | number allocation · project · events · opening status history · audit |
| Payment | payment · allocations · invoice recalculation · audit |
| Payment allocation | allocations · both derived caches · audit |
| Refund | original marked REFUNDED · allocations released · counter-entry · invoices recalculated · audit |
| Expense approval | status · approver stamp · notification · audit |
| Shoot assignment | assignment · notification · audit |
| Task reassignment | task · assignment history row · notification · audit |
| Status changes | entity · status-history row · audit |
| Freelancer payout | payout · backing expense · audit |

Money paths run at `SERIALIZABLE` isolation with bounded retry (`src/utils/transaction.ts`)
for the failures PostgreSQL raises specifically to say *retry me* — `40001`, `40P01`,
Prisma `P2034`. A deliberate business rejection is never retried.

## 9. Idempotency

`Idempotency-Key` is **required** on payment creation, refunds and freelancer payouts, and
accepted on invoice creation and payment allocation.

The first request claims the key by inserting a row; the unique index on
`(organization, key, endpoint)` means a concurrent duplicate loses the race rather than
booking money twice. The winner's response is stored and replayed verbatim on any retry,
with `Idempotency-Replayed: true`. A retry carrying a *different* body under the same key
is rejected with `IDEMPOTENCY_CONFLICT`. A failed attempt releases the key so the caller
can legitimately retry.

## 10. Aggregates

`/data-management/overview` and `/reports/*` are answered with PostgreSQL aggregates —
`COUNT`, `SUM`, `FILTER`, `GROUP BY`, `generate_series` — never by loading rows into Node
and totalling them in JavaScript.

`/data-management/overview` returns active projects, completed and upcoming shoots,
delivered and pending deliveries, pending and overdue tasks, revenue, approved expenses,
invoiced/paid/outstanding, per-status invoice breakdown, crew assignments by role and
status, storage posture, and per-project profitability.

Empty studios receive accurate zeroes and empty arrays. Nothing is fabricated to make the
UI look populated.

## 11. Files

PostgreSQL stores metadata only; binaries live with the storage provider (`LOCAL`, `S3`,
`R2` or `SUPABASE`).

```text
POST /files/upload-intent   → { objectKey, uploadUrl, expiresAt }
PUT  <uploadUrl>            → client uploads directly to the provider
POST /files                 → register the metadata
GET  /files/:id/download-url→ short-lived signed URL
```

The API process never proxies file bytes. Object keys are server-generated and never
derived from a client-supplied filename alone.

## 12. Security

Helmet · strict CORS allowlist (an unknown `Origin` is rejected, never reflected) ·
`express-rate-limit` (global plus a tighter limiter on credential endpoints) ·
`JSON_BODY_LIMIT` on request size · Zod validation · HTTP-only, `SameSite`, optionally
`Secure` cookies · RBAC on every route · append-only audit log · structured logs with
credentials, tokens and cookies redacted · request ids for correlation.

## 13. Health

```text
GET /health        → liveness; process is up
GET /health/ready  → readiness; executes SELECT 1 against PostgreSQL, 503 if unreachable
```
