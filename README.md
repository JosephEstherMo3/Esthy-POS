# Charlotte Esthy — Point of Sale

Web-based point of sale, receipt management, inventory and sales analytics.

> *Created during internship at Hamplus Hub*

Charlotte Esthy is a multi-business POS: owners register a business, invite managers and cashiers, sell from a
responsive checkout screen, print / download / share receipts, track stock with a full movement history, and
review analytics built from real database values.

---

## Architecture (and one deliberate deviation from the brief)

The brief prefers React + Vite + Supabase. This workspace is a **Next.js 16 (App Router) + PostgreSQL (Drizzle ORM)**
platform, so the app uses that native stack instead:

| Concern | Brief | What is implemented |
| --- | --- | --- |
| Frontend | React + Vite + Tailwind + shadcn/ui | React 19 + Next.js + Tailwind CSS 4 with a small in-house component set (`src/components/ui.tsx`) |
| Database | Supabase PostgreSQL | PostgreSQL via Drizzle ORM (`src/db/schema.ts`) — works with any Postgres, including Supabase-hosted Postgres via `DATABASE_URL` |
| Auth | Supabase Auth | Own auth: scrypt-hashed passwords, random session tokens stored **only as SHA-256 hashes**, `httpOnly` cookies (embedded pages use a per-tab token) |
| Authorisation / RLS | Supabase RLS | Server-enforced permission matrix + every query scoped by the session's business (see *Security*). Optional Postgres RLS policies in `db/rls/enable_rls.sql` |
| Charts / PDF | Recharts / PDF lib | Recharts, jsPDF + jspdf-autotable |

```
src/
  app/(auth)/        login, register, forgot/reset password
  app/(app)/         dashboard, pos, sales, products, customers, reports, team, settings
  app/api/           JSON route handlers (all go through src/lib/api.ts)
  components/        UI kit, app shell, receipt, charts
  db/schema.ts       relational schema (Drizzle)
  lib/               auth, permissions, money maths, receipts, PDF, services (checkout, refunds, reports)
drizzle/             generated SQL migration (0000_init.sql)
db/rls/              optional Row Level Security policies
tests/               unit, DB integration and HTTP authorisation tests
```

## Features

* **Auth & access** — register (creates a business, you become *owner*), login, logout, 14-day persistent sessions,
  password reset by email, profile & password change, owner / manager / cashier roles, protected routes, login throttling.
  Registration creates the account and, when a mail provider is configured, sends a verification link. Opening the link
  shows "Your account has been created successfully" and the account can then sign in. Without a mail provider,
  accounts are active when created and the registration screen says verification is not active.
* **Dashboard** — today's net revenue, transactions, average sale, low-stock count, recent transactions, best sellers,
  revenue trend by day/week/month, date-range filter, empty state for new accounts. Cashiers see only their own sales.
* **POS** — search by name/SKU/barcode (barcode scanners work: scan + Enter), categories, product images, cart with
  stock validation, percentage / fixed discounts, configurable tax (exclusive or inclusive), cash / transfer / card,
  change calculation, confirmation dialog with live receipt preview, double-submit protection, cart cleared only after
  the sale is saved.
* **Receipts** — unique configurable numbering, logo & business details, thank-you message, 58 mm / 80 mm / A4 layouts,
  browser print (print-only layout), PDF download, WhatsApp share link, reprint any receipt, searchable history with
  filters (date, cashier, payment method, status, receipt number).
* **Products & inventory** — create / edit / archive (never hard-delete), SKU, barcode, category, cost & price,
  low-stock thresholds, stock adjustments with reasons, movement history, valuation at cost and retail.
* **Customers** — records with purchase history, linked to sales.
* **Refunds & cancellations** — partial / full refunds and whole-sale cancellation by managers/owners, optional restock,
  reason required, audit-logged. Completed sales are never deleted.
* **Reports** — daily/weekly/monthly sales, product performance, inventory valuation, payment methods,
  discounts & refunds, cashier performance, CSV + PDF export, CSV export of sales/items/inventory from the server.
* **Team & settings** — add members with temporary passwords, change roles, disable accounts, reset passwords;
  business identity, receipt details (separate from the app brand), currency, timezone, tax, numbering, stock rules,
  activity (audit) log.
* **UX** — responsive sidebar / drawer / bottom navigation, breadcrumbs, search, low-stock notifications, loading
  skeletons, empty and error states, toasts, confirmation dialogs, keyboard-accessible native `<dialog>` modals,
  visible focus rings, offline banner.

## Security model

* **Server-enforced permissions** — every API route is wrapped by `route({ permission })` in `src/lib/api.ts`. It
  validates the session, resolves the user's active membership and role, and checks the permission matrix
  (`src/lib/permissions.ts`). Hidden buttons are cosmetic only.
* **Business isolation** — the business id is **never** accepted from the client; it comes from the session. Every
  query on a business-owned table filters by it, and cross-business references (customer, product, sale) are verified.
  This is covered by DB-level and HTTP-level tests.
* **Checkout integrity** — one database transaction: locks the business settings row (serialises receipt numbers),
  re-reads prices from the DB, recomputes discount/tax/total in integer cents, deducts stock with a conditional
  `UPDATE … WHERE stock_qty >= qty`, writes sale, items, payment, inventory movements and an audit event.
  An idempotency key per sale makes retries and double-clicks safe.
* **Input validation** — zod schemas on every route; client-side validation is only a convenience.
* **Secrets** — only `DATABASE_URL` (and optional email keys) are used, server-side. Error responses never include
  stack traces or SQL. `.env` is git-ignored; use `.env.example` as a template.
* **CSRF** — mutations require `Content-Type: application/json`; `Sec-Fetch-Site: cross-site` and untrusted `Origin` requests are rejected server-side. HTTPS sessions use a partitioned `SameSite=None` cookie where supported.
* **Embedded sign-in sessions** — normal browser tabs keep the session in an `httpOnly` cookie. A page shown inside another site's frame (for example a preview) asks for its session as a token (`x-session-transport: token`), keeps it only in that tab's `sessionStorage`, and sends it as `Authorization: Bearer`. The token is cleared on sign-out or when the tab closes. The server stores only its hash and revokes it on logout. Protected pages load as a shell; the browser checks the session (`/api/me/context`), and every data API enforces it. Trade-off: a token held by page scripts is readable by any script running on this app's origin, so the app must stay free of third-party scripts.

* **Audit trail** — sales, refunds, cancellations, price changes, stock adjustments, role/password changes, exports and
  settings changes are recorded in `audit_events` (viewable by owners/managers in Settings → Activity log).

### Row Level Security

`db/rls/enable_rls.sql` defines `business_id = current_setting('app.business_id')` policies for every business-owned
table. They are **not active by default** because the app connects as the database owner/superuser (which bypasses RLS)
and does not yet set `app.business_id` per transaction. To enable them: apply the file, connect with a non-superuser
role that belongs to `ce_app`, and call `select set_config('app.business_id', $1, true)` at the start of each request
transaction. Until then, isolation relies on the application-layer scoping described above.

## Getting started

Requirements: Node.js 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL
npm run db:push                 # create tables (or apply drizzle/0000_init.sql with psql)
npm run dev                     # http://localhost:3000
```

Open `/register` to create your business, then add products under **Products & inventory** and start selling.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (server only) |
| `APP_URL` | production | Canonical public HTTPS origin for password-reset links |
| `RESEND_API_KEY`, `EMAIL_FROM` | one provider | Send verification and password-reset emails using Resend (verified sender domain required) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` (or `SMTP_FROM`) | one provider | Send reset emails through SMTP; use an app password where your provider requires it |
| `SMTP_PORT` | no | SMTP submission port; defaults to 587 (STARTTLS) |
| `SMTP_SECURE` | no | `true` for implicit TLS (normally port 465), `false` for STARTTLS (normally port 587) |
| `SMTP_FROM` | no | Optional SMTP sender override; defaults to `EMAIL_FROM` |

Configure **one** provider in the deployment secret store, set `APP_URL` to the public HTTPS website, then redeploy and
request a fresh reset link. Resend is preferred when both providers are configured. For SMTP, use the provider's SMTP
submission host and credentials; port 587 requires STARTTLS, while port 465 uses implicit TLS.

If no provider is configured, no email is sent and no reset token/link is written to production logs or returned to the
browser. The screen shows the exact server variables required. Managers/owners can still set a temporary password for
staff under **Team & permissions**; a business owner who is locked out must ask the server administrator to configure
delivery or issue a secure reset. `.env` is git-ignored; never commit provider credentials.

### Database & migrations

* Schema source of truth: `src/db/schema.ts`.
* `npm run db:generate` writes SQL migrations to `drizzle/`; `drizzle/0000_init.sql` is the initial schema.
* `npm run db:push` applies the current schema directly (development / first deployment).
* Tables: `users, sessions, password_resets, businesses, business_settings (receipt settings), memberships (roles),
  email_verifications, categories, products, customers, sales, sale_items, payments, inventory_movements, refunds, refund_items,
  audit_events` with foreign keys, unique constraints (per-business SKU, receipt number, idempotency key),
  check constraints (non-negative prices, valid quantities) and indexes for common queries.
* The role/permission matrix lives in code (`src/lib/permissions.ts`) and is displayed in **Team & permissions**.

### No developer mode

The app has no demo accounts, sample data, developer sign-in or sign-in bypass. Every account is created by registering
(the first account becomes the business owner) and signs in with its own email and password. Reset links are only ever
sent by email; they are never shown on screen or written to logs.

## Testing

```bash
npm test                                         # unit + database integration tests
E2E_BASE_URL=http://localhost:3000 npm test      # additionally runs HTTP auth/authorisation/isolation tests
npm run lint
npx tsc --noEmit
npm run build
```

Covered: checkout maths (discounts, tax inclusive/exclusive, change, rounding), receipt numbering and rendering
(including 58 mm / 80 mm widths), WhatsApp link encoding, CSV injection safety, role permissions and navigation, password
and token hashing, Resend/SMTP selection and TLS configuration, escaped reset email content, reset-response account privacy,
stock deduction, concurrent checkouts (no overselling), duplicate submissions, partial/full refunds and cancellations,
business data isolation, database constraints, and — against a running server — login failures, 401/403 enforcement,
cross-business access (404), cashier restrictions and logout invalidation.

Integration tests use the database in `DATABASE_URL` and delete everything they create. Not covered by automation:
visual/responsive behaviour in real browsers and physical printing — verify those manually.

## Deployment

1. Provision PostgreSQL (e.g. Neon, Supabase Postgres, Railway, RDS) and note its connection string.
2. Choose a Node host (Vercel, Render, Railway, Fly.io, a VPS with Node ≥ 20 behind Nginx/Caddy).
3. Set `DATABASE_URL`, `APP_URL`, and one email provider (Resend variables or SMTP variables) in the host's secret store.
4. Run `npm ci && npm run db:push` once against the production database, then `npm run build && npm start`.
5. Serve over **HTTPS** and make sure the reverse proxy forwards `X-Forwarded-Proto` (the session cookie is marked
   `Secure` only when it sees `https`) and `X-Forwarded-For`.
6. Register the first account (it becomes the owner), then configure **Settings → Business & receipts / Currency & tax**.

## Limitations (honest list)

* **No offline mode.** When the browser is offline a banner appears and sales are blocked; nothing is queued or
  synchronised later. Data is shared across devices through the cloud database in real time on each request, with no
  push updates — other screens refresh on navigation or reload.
* **Supabase Auth/RLS are not used** (see *Architecture*). Postgres RLS policies are provided but opt-in.
* **Email verification depends on a mail provider.** When Resend or SMTP is configured, new accounts must open the verification link before they can sign in. Without a provider, verification is not active and accounts are active when created (the registration screen says so). Accounts that already exist when a provider is first configured are *not* verified automatically. To keep them usable, run once against the database: `update users set email_verified_at = now() where email_verified_at is null;`. Owner- or manager-created team accounts are treated as verified.
* **Password-reset email requires mail-provider credentials** (Resend or SMTP). Without them, production neither sends nor exposes reset links; the UI gives the server administrator exact setup steps. Staff can alternatively ask their manager/owner for a temporary password.
* **WhatsApp sharing is a link** (`wa.me`) that pre-fills a message; the user must press *Send* in WhatsApp.
* One payment method per sale (no split payments); quantities are whole numbers; one business per account session.
* Login throttling is in-memory per server instance. For several instances use a shared store (e.g. Redis).
* Stock is changed only by sales, refunds and adjustments; there is no purchase-order or supplier module.
* Receipt printing relies on the browser's print dialog; direct ESC/POS printing is not implemented.
* Timezone and currency are per business; amounts on a past receipt keep the currency in which they were issued.
