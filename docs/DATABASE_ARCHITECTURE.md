# Database Architecture

PostgreSQL 14+ is the single source of truth for the entire CRM. This document
explains what the schema models, why it is shaped that way, and which invariants
the database itself guarantees.

- **51 models**, 41 enums
- **126 foreign keys**, 39 CHECK constraints, 31 unique indexes, 17 partial indexes
- Migration: `prisma/migrations/20260824102855_init_postgresql_crm/`

## 1. Domain shape

```text
Organization
  └── Branch
        └── User ── Role ── Permission
              │
              ├── Lead ──► Client ──► Project
              │                          ├── Event ──► Shoot ──► ShootAssignment ──► User | Freelancer
              │                          ├── Task  ──► TaskAssignment / TaskStatusHistory / WorkSession
              │                          ├── Delivery ──► DeliveryItem / DeliveryStatusHistory
              │                          ├── Quotation ──► QuotationItem
              │                          ├── Invoice ──► InvoiceItem
              │                          │       ▲
              │                          │   PaymentAllocation
              │                          │       ▲
              │                          ├── Payment
              │                          └── Expense ──► FreelancerPayout / ExpenseAttachment
              │
              └── Attendance / LeaveRequest

Cross-cutting: AuditLog · Notification · FileObject · SystemSetting · IdempotencyKey
```

## 2. Multi-tenancy

Every business table carries `organization_id`. Tenant scoping is part of the lookup
predicate, never a check performed after loading a row:

```ts
findFirst({ where: { id, organizationId, deletedAt: null } })
```

A cross-tenant read therefore returns `404`, not a leaked record. `Branch` sits between
organization and user so a studio can grow to multiple locations without a redesign.

## 3. Keys

Every business entity uses a native PostgreSQL `uuid`:

```prisma
id String @id @default(uuid()) @db.Uuid
```

No sequential integer identifier is ever exposed. Human-facing identifiers are separate,
per-organization, and readable: `PRJ-2026-0001`, `INV-2026-0001`, `PAY-2026-0001`,
`QTN-2026-0001`, `CLI-0001`, `FRL-0001`.

Those numbers are allocated inside the same transaction as the row, guarded by a
transaction-scoped advisory lock keyed on `(organization, document kind)`:

```sql
SELECT pg_advisory_xact_lock(hashtextextended('docnum:<org>:INVOICE', 0));
```

Two admins creating an invoice at the same instant queue rather than race, and the
`@@unique([organizationId, invoiceNumber])` constraint remains the final backstop.

## 4. Money

**No monetary value is ever a float.** Every amount is `numeric(14,2)`, mapped to
Prisma's `Decimal`, and arithmetic runs through `src/utils/money.ts` — never through
JavaScript numbers.

Over the wire, money is an exact decimal string (`"450000"`, `"1234.5"`). Trailing zeros
are not padded. Format for display on the client; never parse into a float first.

### Source of truth vs. derived cache

| Fact | Source of truth |
|---|---|
| Revenue recognised | `invoices` + `invoice_items` |
| Cash received | `payments` |
| Cash applied to an invoice | `payment_allocations` |
| Cost (crew payouts included) | `expenses` |

`invoices.amount_paid`, `invoices.amount_due` and `payments.allocated_amount` are
**derived caches**. They exist so dashboards do not aggregate on every read, and they are
governed by one rule: they are only ever *recomputed from* `SUM(payment_allocations.amount)`
inside the same transaction that changes an allocation. They are never incremented in
place, so a lost update cannot silently corrupt a balance.

A CHECK constraint makes the cache self-verifying — any drift aborts the transaction:

```sql
CHECK (amount_due = total - amount_paid)
```

### Crew cost is counted exactly once

A freelancer payout writes a `freelancer_payouts` row **and** its backing `expenses` row in
one transaction, linked 1:1 by a unique `expense_id`. `expenses` therefore stays the single
cost ledger, and project profitability cannot double-count crew.

`shoot_assignments.agreed_amount` is the *committed* cost, used for forecasting. It is
reported separately as `crewCommitted` and is deliberately **not** subtracted from profit,
because settled crew cost already appears in `expenses`.

### Profitability

Computed entirely in SQL (`src/services/dataManagement.service.ts`):

```text
revenue  = SUM(payments.amount)  WHERE status = 'COMPLETED'      AND project_id = p.id
expenses = SUM(amount + tax)     WHERE approval_status='APPROVED' AND project_id = p.id
profit   = revenue - expenses
```

Profit is never a stored, user-editable column.

## 5. Relational, not JSON

A wedding has many functions, so `Event` is a real table — never a JSON blob on the
project. Likewise crew: instead of `photographerName`/`cinematographerName` strings,

```text
Shoot ──► ShootAssignment ──► User (employee)  |  Freelancer (external)
```

`jsonb` is used only where relational modelling adds nothing: `audit_logs.old_data` /
`new_data` (arbitrary entity snapshots), `system_settings.value`, `files.metadata`,
`organizations.settings`, `idempotency_keys.response_body`.

## 6. CHECK constraints

Prisma cannot express these, so they live in the migration SQL. They hold even if a bug,
a `psql` session, or a future service bypasses the service layer.

**Crew integrity**

```sql
-- Exactly one assignee: an employee OR a freelancer, never both, never neither
CHECK (num_nonnulls(user_id, freelancer_id) = 1)
```

**Financial integrity**

```sql
CHECK (amount > 0)                                        -- payments, expenses, payouts
CHECK (allocated_amount >= 0 AND allocated_amount <= amount)   -- never over-allocate a payment
CHECK (amount_paid >= 0 AND amount_paid <= total)              -- never over-settle an invoice
CHECK (amount_due = total - amount_paid)                       -- derived cache must agree
CHECK (approval_status <> 'APPROVED'
       OR (approved_at IS NOT NULL AND approved_by_id IS NOT NULL))
```

**Temporal sanity**

```sql
CHECK (end_time > start_time)          -- events, shoots
CHECK (due_date >= issue_date)         -- invoices
CHECK (valid_until >= issue_date)      -- quotations
CHECK (check_out >= check_in)          -- attendance, shoot assignments
CHECK (end_date >= start_date)         -- leave requests
CHECK (quantity > 0)                   -- invoice/quotation/delivery items, tasks
CHECK (rating BETWEEN 0 AND 5)         -- freelancers
```

## 7. Uniqueness and duplicate prevention

| Constraint | Prevents |
|---|---|
| `(organization_id, project_number \| invoice_number \| quotation_number \| payment_number)` | Duplicate document numbers |
| `(organization_id, transaction_reference)` on `payments` | The same bank reference booked twice |
| `(shoot_id, user_id)` and `(shoot_id, freelancer_id)` | The same person assigned twice to one shoot |
| `(payment_id, invoice_id)` on `payment_allocations` | One payment allocated twice to one invoice |
| `(user_id, date)` on `attendance` | Two attendance rows for one person on one day |
| `(organization_id, email)` on `users` | Duplicate accounts within a studio |
| `(organization_id, key, endpoint)` on `idempotency_keys` | Retries creating a second financial record |
| `(role_id, permission_id)`, `(user_id, role_id)` | Duplicate grants |

PostgreSQL treats `NULL`s as distinct, which is exactly what the nullable pairs on
`shoot_assignments` require.

## 8. Indexing

Indexes follow real query patterns rather than blanket-indexing every column.

**Composite** — `projects(organization_id, status)`, `projects(organization_id, wedding_date)`,
`shoots(organization_id, shoot_date)`, `tasks(assignee_id, status)`,
`expenses(organization_id, expense_date)`, `audit_logs(organization_id, created_at)`,
`notifications(user_id, is_read)`.

**Partial** — every list endpoint filters `deleted_at IS NULL`, so indexing only live rows
keeps them small and skips tombstones entirely:

```sql
CREATE INDEX projects_org_status_live_idx
  ON projects (organization_id, status) WHERE deleted_at IS NULL;

CREATE INDEX tasks_due_date_open_idx
  ON tasks (due_date)
  WHERE deleted_at IS NULL AND status NOT IN ('COMPLETED','CANCELLED');

CREATE INDEX invoices_outstanding_idx
  ON invoices (organization_id, due_date)
  WHERE status IN ('SENT','PARTIALLY_PAID','OVERDUE');

CREATE INDEX notifications_unread_idx
  ON notifications (user_id, created_at DESC) WHERE is_read = false;
```

## 9. Deletion policy

Business records soft-delete via `deleted_at` + `deleted_by`, and every list query filters
them out. Financial records are never deleted at all:

- A payment is reversed by marking it `REFUNDED` and writing a linked counter-entry
- An invoice with payments against it cannot be cancelled
- A project with settled financial records cannot be archived
- An approved expense cannot be edited or deleted
- A client with live projects cannot be archived

## 10. Audit trail

`audit_logs` is append-only and records actor, action, entity, before/after `jsonb`
snapshots, IP, user agent and request id. The audit row is written **inside the same
transaction** as the change it describes, so a rolled-back operation leaves no misleading
trail.

Snapshots pass through a scrubber that redacts `password`, `passwordHash`, `token`,
`refreshToken`, `secret`, `apiKey`, `authorization` and `cookie` at every depth before
anything is persisted.

Audited: project changes and status transitions, client changes, payments and allocations,
invoice changes, expense approvals, shoot assignment, task reassignment, role and
permission changes, logins and logouts.

## 11. Timestamps

Every timestamp is `timestamptz(6)`; calendar dates that carry no time (`wedding_date`,
`expense_date`, `payment_date`, attendance `date`) are `date`. Date-only values are
normalised to midnight UTC on the way in, so a client's timezone cannot shift which day a
payment lands on.

## 12. Concurrency

| Risk | Mitigation |
|---|---|
| Two admins record the same payment | Unique `transaction_reference` + required `Idempotency-Key` |
| Concurrent invoice settlement | `SERIALIZABLE` transaction with bounded retry on `40001`/`40P01`/`P2034` |
| Duplicate document numbers | `pg_advisory_xact_lock` + unique constraint |
| Duplicate shoot assignment | Unique `(shoot_id, user_id)` / `(shoot_id, freelancer_id)` |
| Freelancer double-booked on a date | Same-day assignment count checked against `max_shoots_per_day` |
| Retried request creating two records | `idempotency_keys` claim-then-replay |
