# hono-jpyc-checkout — v0.1 Design

**Status:** Approved (brainstorming complete, ready for implementation plan)
**Date:** 2026-05-04
**Author:** Ryota Ikezawa (with Claude)

## 1. One-line definition

`hono-jpyc-checkout` is a Hono middleware that turns a Cloudflare Workers app
into a JPYC paywall — drop in three lines, redirect users to a hosted checkout
page, and receive an `onPaid` callback when the on-chain transfer is confirmed.

## 2. Positioning & disclaimers

- **Unofficial open-source library.** Not affiliated with, endorsed by, or
  sponsored by JPYC株式会社. "JPYC" is a trademark of its respective owner.
- Library is non-custodial: payments flow directly from customer wallets to
  merchant wallets on-chain. The library never holds funds and never sees a
  private key.
- The library is not legal, financial, or tax advice. Merchants remain
  responsible for compliance (特定商取引法, 消費者契約法, ASBJ Report
  No. 45, etc.).

## 3. Target user & primary use case

### Goal
OSS adoption first; the maintainer does not yet have a production product
that uses this library. If a meaningful adopter base emerges, the maintainer
may dogfood it later. Optimization target: "the first 10 real users".

### v0.1 use case (single, concrete)
**Article paywall** — a reader pays N JPYC on Polygon to unlock a piece of
content. This is the "Stripe Checkout for JPYC" framing. The same API shape
generalizes to API credit top-ups, tip jars, and one-shot digital goods, but
those are documented as variants, not first-class.

### Non-goals for v0.1
Subscriptions, x402 / agent payments, multi-chain, multi-token, refunds,
admin dashboards, customer email, internationalization beyond Japanese,
Node/Bun runtime, React/Vue SDK packages, Postgres/KV/DO storage adapters.

## 4. Operational decisions

| Item | Decision |
| :--- | :--- |
| Package name | `hono-jpyc-checkout` (unscoped on npm) |
| License | MIT |
| Repository | github.com/paveg/hono-jpyc-checkout |
| Demo domain | `*.workers.dev` (no custom domain in v0.1) |
| Docs language | `README.md` in English (default), `README.ja.md` for Japanese mirror |
| Code comments | English only |

## 5. Architecture

### Tech stack

| Layer | Choice | Rationale |
| :--- | :--- | :--- |
| Runtime | Cloudflare Workers | Hono's primary deployment target; largest user base |
| Framework | Hono v4+ | Sub-app `route()` mount idiom; tight Workers integration |
| Storage | D1 (SQLite) | Familiarity > DO; transactional UPDATE for idempotency; portable to Postgres later |
| Detection | Frontend tx hash submit + cron sweep | Zero external dependency; low latency; fallback for tab-close |
| Wallet integration | `window.ethereum` direct | Smallest bundle (~5KB) for v0.1; viem deferred to v0.2 |
| UI rendering | hono/jsx (SSR) | Native to Hono; no extra dependency |
| Validation | valibot + `@hono/valibot-validator` | ~1.5KB gzipped (zod is ~13KB); first-class in Hono ecosystem |
| Schema | Drizzle ORM + drizzle-kit | Generated migrations; future portability to Postgres / better-sqlite3 |
| Build | tsup | Dual ESM/CJS; auto `.d.ts`; minimal config |
| Test | Vitest + `@cloudflare/vitest-pool-workers` | Real Workers runtime via miniflare |
| Lint/Format | Biome | Fast; single tool replaces eslint+prettier |
| Package manager | Bun | Fast install; matches CF Workers ecosystem direction |

### Block diagram

```
[Customer Browser]                              [Merchant Worker]
     │                                                │
     │ 1. POST /articles/:id/buy                      │
     ├───────────────────────────────────────────────►│ createCheckoutSession()
     │                                                │       │
     │                                                │       ▼
     │                                                │   [D1: sessions]
     │ 2. 302 → /checkout/:sessionId                  │
     │◄───────────────────────────────────────────────┤
     │                                                │
     │ 3. GET /checkout/:sessionId  (hosted page)     │
     ├───────────────────────────────────────────────►│ jpycCheckout sub-app
     │                                                │
     │ 4. window.ethereum.request (Connect Wallet)    │
     │ 5. POST /checkout/:sessionId/connect           │
     ├───────────────────────────────────────────────►│ store from_address
     │                                                │
     │ 6. window.ethereum.request (sendTransaction)   │
     │     → tx hash returned                         │
     │                                                │
     │ 7. POST /checkout/:sessionId/verify            │
     ├───────────────────────────────────────────────►│ verify receipt via RPC
     │                                                │       │
     │                                                │       ▼
     │                                                │   onPaid() → merchant logic
     │                                                │   POST webhook (best-effort)
     │ 8. 302 → successUrl                            │
     │◄───────────────────────────────────────────────┤
     │
     │     ⏱ Polygon RPC ────────► [Cron Worker] every 10 min
     │                                  jpycSweep() walks open sessions,
     │                                  re-runs verify for safety net
```

### Rejected alternatives (with rationale)

- **Durable Objects per session:** `alarm()` is elegant but cron sweep is
  cheap (~50 LOC). DO has higher per-request cost and zero portability to
  non-Workers runtimes.
- **Provider webhook (Alchemy / QuickNode):** Forces merchants to open an
  external account; major OSS adoption friction.
- **HD wallet derivation per session:** Library would have to handle a seed
  phrase; security responsibility is too heavy for an OSS dependency.
- **Multi-chain in v0.1:** Each new chain requires individual reorg / RPC /
  finality verification. YAGNI.
- **viem in browser:** ~50KB for one method (`eth_sendTransaction`). Direct
  `window.ethereum` is sufficient for v0.1.

## 6. Component layout

```
hono-jpyc-checkout/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── drizzle.config.ts
├── biome.json
├── README.md (English)
├── README.ja.md
├── LICENSE (MIT)
├── docs/
│   ├── adr/
│   └── superpowers/specs/
├── src/
│   ├── index.ts                      # Public API barrel
│   ├── checkout-app.ts               # jpycCheckout() factory (Hono sub-app)
│   ├── session.ts                    # createCheckoutSession() + internal CRUD
│   ├── sweep.ts                      # jpycSweep() cron handler
│   ├── verify.ts                     # Pure: receipt → paid decision
│   ├── rpc.ts                        # Polygon JSON-RPC client (fetch-based)
│   ├── webhook.ts                    # HMAC-SHA256 sign + best-effort POST
│   ├── jpyc/
│   │   ├── contracts.ts              # JPYC v2 addresses per network
│   │   └── erc20.ts                  # Transfer topic / decode helpers
│   ├── ui/
│   │   ├── page.tsx                  # SSR checkout page
│   │   ├── client.ts                 # Inlined client JS (string export)
│   │   └── styles.ts                 # Inlined CSS (string export)
│   ├── db/
│   │   ├── schema.ts                 # Drizzle schema
│   │   └── migrations/               # drizzle-kit generated
│   └── types.ts                      # Public types
├── examples/
│   └── paywall-cf-workers/
└── tests/
    ├── verify.test.ts
    ├── session.test.ts
    ├── checkout-app.test.ts
    ├── webhook.test.ts
    └── e2e/paywall-flow.test.ts
```

## 7. Public API surface

```ts
// Public types
export type Network = 'polygon' | 'polygon-amoy'

export interface JpycCheckoutConfig {
  network: Network
  receivingAddress: (c: Context) => `0x${string}`
  rpcUrl: (c: Context) => string
  db: (c: Context) => D1Database
  confirmations?: number              // default: 8
  theme?: { primaryColor?: string; logo?: string; merchantName?: string }
  onPaid?: (session: PaidSession, c: Context) => Promise<void>
  webhook?: { url: string; secret: string }
}

export interface CreateSessionParams {
  orderId: string
  amount: string                      // decimal JPYC string, e.g. "100"
  successUrl: string
  cancelUrl: string
  expiresInSec?: number               // default: 1800 (30 min)
  metadata?: Record<string, string>
}

export interface Session {
  id: string                          // cs_<ulid>
  orderId: string
  amount: string                      // decimal string
  status: 'pending' | 'paid' | 'expired' | 'failed'
  expectedFromAddress: `0x${string}` | null
  receivingAddress: `0x${string}`
  txHash: `0x${string}` | null
  blockNumber: number | null
  paidAt: string | null               // ISO 8601
  createdAt: string
  expiresAt: string
  metadata: Record<string, string>
}

export type PaidSession = Session & { status: 'paid'; txHash: string; paidAt: string }

// Public functions
export function jpycCheckout(config: JpycCheckoutConfig): Hono
export function createCheckoutSession(
  db: D1Database,
  params: CreateSessionParams,
): Promise<{ id: string; url: string }>
export function jpycSweep(config: { db: (env: any) => D1Database }):
  (event: ScheduledEvent, env: any, ctx: ExecutionContext) => Promise<void>
```

### Mounted routes (under merchant-chosen prefix, e.g., `/checkout`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| GET | `/:id` | Hosted checkout page (HTML) |
| POST | `/:id/connect` | Register sender wallet address |
| POST | `/:id/verify` | Submit tx hash and verify receipt |
| GET | `/:id/status` | Poll session status (JSON) |

## 8. Data flow & state machine

### Session states

```
                    ┌─────────────┐
                    │   pending   │ ◄─── createCheckoutSession()
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐
      │   paid   │   │ expired  │   │  failed  │
      └──────────┘   └──────────┘   └──────────┘
       verify        cron sweep:    verify rules out:
       success       expiresAt <    tx reverted on-chain
                     now            (sender/amount mismatch
                                     keeps state at pending,
                                     allows retry)
```

Sub-states ("from address registered", "tx hash submitted") are tracked via
nullable columns, not status enum values.

### Idempotency

All paid-state transitions go through:

```sql
UPDATE sessions
SET status = 'paid', tx_hash = ?, block_number = ?, paid_at = ?
WHERE id = ? AND status = 'pending'
```

`onPaid` and webhook fire only when `meta.changes === 1`. Concurrent verify
calls (frontend + cron sweep + retry) cannot double-fulfill.

### Cron sweep (every 10 min)

1. `UPDATE sessions SET status='expired' WHERE status='pending' AND expires_at <= now()`
2. `SELECT * FROM sessions WHERE status='pending' AND tx_hash IS NOT NULL LIMIT 100`
3. For each: re-run verify; on success run the same atomic UPDATE.

LIMIT 100 keeps execution within Workers' 30s CPU budget at ~200ms per
RPC call.

### verify() pure function

```ts
type VerifyResult =
  | { paid: true; blockNumber: number }
  | { paid: false; reason:
      | 'tx_not_mined' | 'tx_reverted' | 'wrong_contract'
      | 'no_transfer_log' | 'sender_mismatch' | 'recipient_mismatch'
      | 'amount_mismatch' | 'insufficient_confirmations' }
```

Pure function; no RPC calls inside. Receipt is passed in by caller.

## 9. Error handling

### Response shape

```ts
interface ErrorResponse {
  error: { code: string; message: string; details?: object }
}
```

### HTTP status mapping

| Status | Code | Trigger |
| :--- | :--- | :--- |
| 400 | `invalid_body` | valibot validation failure |
| 404 | `session_not_found` | Unknown session id |
| 409 | `session_not_pending` | Action attempted on terminal state |
| 410 | `session_expired` | `expiresAt < now` |
| 422 | `verify_failed` | verify returned `paid: false` (reason in details) |
| 502 | `rpc_unavailable` | Polygon RPC unreachable |
| 500 | `internal_error` | Unexpected exception |

### RPC retries

2 retries with exponential backoff (200ms / 400ms / 800ms), 5s timeout per
request. On final failure, return 502 — frontend continues polling, cron
sweep retries on next cycle.

### Sweep error isolation

Per-session try/catch; one failure does not abort the batch.
`console.error` for visibility; metrics deferred to v0.2.

## 10. Security

| Threat | Mitigation |
| :--- | :--- |
| Session id guessing | ULID (~80-bit entropy after prefix) |
| Tx hash replay across sessions | DB constraint: a tx_hash can paid-mark only one session |
| Webhook signature forgery | HMAC-SHA256, timing-safe compare, secret in env |
| Phishing (third-party hosted page) | Hosted page served from merchant's own Worker domain |
| Configuration leak | Receiving address / RPC URL / webhook secret typed as `(c) => c.env.X` |
| Front-running of `/verify` | Verify is idempotent and side-effect-once; no exploitation surface |

## 11. Testing strategy

### Layer pyramid

```
┌─────────────────────────────────────────────────────────────────────┐
│  Manual / Browser (testnet) — pre-release smoke                     │
├─────────────────────────────────────────────────────────────────────┤
│  E2E (Vitest + workers-pool, mocked RPC) — full lifecycle           │
├─────────────────────────────────────────────────────────────────────┤
│  Integration (Vitest + workers-pool) — D1, sub-app routing          │
├─────────────────────────────────────────────────────────────────────┤
│  Unit (Vitest, no Workers env) — verify(), HMAC, ABI                │
└─────────────────────────────────────────────────────────────────────┘
```

### TDD order (bottom-up)

1. `src/jpyc/erc20.ts` (Transfer topic + decode)
2. `src/verify.ts` (10+ branch cases, pure function)
3. `src/webhook.ts` (HMAC roundtrip)
4. `src/db/schema.ts` + `src/session.ts` (D1 CRUD via miniflare)
5. `src/checkout-app.ts` (route by route)
6. `src/sweep.ts` (cron handler behavior)
7. `tests/e2e/paywall-flow.test.ts` (full pipeline)
8. UI manual tests on testnet

### Coverage policy

- Target: 80% overall, **100% required** on `verify.ts` branches and the
  atomic UPDATE + onPaid dispatch path.
- Not enforced as CI gate in v0.1 (avoid coverage-driven low-value tests).

## 12. v0.1 release checklist (open TODOs)

Before publishing v0.1 to npm, verify:

1. **`hono-jpyc-checkout` package name available** on npm (`npm view hono-jpyc-checkout`).
   Fall back to `@paveg/hono-jpyc-checkout` if taken.
2. **Polygon finality recommendation still current** — re-confirm
   Heimdall v2 / Bhilai / Giugliano upgrade status and adjust
   `confirmations` default if reorg cap has changed.
3. **JPYC v2 contract addresses on Polygon mainnet and Amoy** — verify
   from official JPYC docs and pin to `src/jpyc/contracts.ts`.
4. **`@hono/valibot-validator` major version compatibility** with Hono v4+.
5. **D1 binding documentation** — confirm wrangler.toml syntax against
   current Cloudflare docs.
6. **Demo deployment** to a `*.workers.dev` subdomain (preferred:
   `hono-jpyc-checkout-demo.workers.dev`, fall back to a variant if taken)
   with Polygon Amoy testnet integration; verify end-to-end with real MetaMask.
7. **README disclaimer** prominently placed at top, including trademark
   notice and non-affiliation statement.

## 13. ADR cross-references

- ADR-0001: Default `confirmations = 8` on Polygon PoS

## 14. Future work (v0.2+, not in v0.1)

- Multi-chain (Avalanche, Ethereum) via per-network adapter
- Multi-token (JPYSC, USDC) — note that legal classification differs
  per token in Japan; abstraction is leaky
- React / Vue / Svelte UI SDK packages
- Webhook retry queue (CF Queues)
- Subscription support (EIP-2612 permit + scheduled `transferFrom`)
- x402 / agent payment adapter
- Address screening (Chainalysis, OFAC)
- HD wallet per-session derivation
- DO-based session store (alarm-driven expiration)
- Postgres / SQLite (better-sqlite3) adapters for Node/Bun
- WalletConnect support beyond `window.ethereum`
- Internationalization (English UI, additional locales)
- Refund helper
- Admin dashboard / CSV export of paid sessions
- Visual regression testing (Playwright)
