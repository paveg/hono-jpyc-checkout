# hono-jpyc-checkout

> **Unofficial open-source library.** Not affiliated with, endorsed by, or sponsored by JPYC株式会社. "JPYC" is a trademark of its respective owner.

[Hono](https://hono.dev) middleware for accepting [JPYC](https://jpyc.jp) payments on Cloudflare Workers. Drop in three lines, redirect users to a hosted checkout page, and receive an `onPaid` callback when the on-chain transfer is confirmed.

- 🇯🇵 **JPYC** — JPY-pegged stablecoin on Polygon
- ⚡ **Cloudflare Workers** — edge-native, no servers
- 🔐 **Non-custodial** — payments go directly from customer wallet to merchant address; the library never holds funds
- 📦 **Tiny bundle** — ~14KB hosted page, ~30KB library overhead

[日本語版 README](./README.ja.md)

## Quick start

```bash
bun add hono hono-jpyc-checkout
```

```ts
import { Hono } from 'hono'
import { jpycCheckout, createCheckoutSession, jpycSweep } from 'hono-jpyc-checkout'

interface Env {
  DB: D1Database
  RPC_URL: string
  RECEIVING_ADDRESS: string
}

const app = new Hono<{ Bindings: Env }>()

app.route('/checkout', jpycCheckout({
  network: 'polygon',
  receivingAddress: (c) => c.env.RECEIVING_ADDRESS as `0x${string}`,
  rpcUrl: (c) => c.env.RPC_URL,
  db: (c) => c.env.DB,
  onPaid: async (session, c) => {
    await c.env.DB.prepare('UPDATE articles SET unlocked_at = ? WHERE order_id = ?')
      .bind(new Date().toISOString(), session.orderId).run()
  },
}))

app.post('/articles/:id/buy', async (c) => {
  const url = new URL(c.req.url)
  const session = await createCheckoutSession(c.env.DB, {
    orderId: c.req.param('id'),
    amount: '100',
    successUrl: `${url.origin}/articles/${c.req.param('id')}/unlocked`,
    cancelUrl: `${url.origin}/articles/${c.req.param('id')}`,
    receivingAddress: c.env.RECEIVING_ADDRESS,
    origin: url.origin,
  })
  return c.redirect(session.url)
})

export default {
  fetch: app.fetch,
  scheduled: jpycSweep<Env>({
    db: (env) => env.DB,
    rpcUrl: (env) => env.RPC_URL,
    receivingAddress: (env) => env.RECEIVING_ADDRESS as `0x${string}`,
    network: 'polygon',
  }),
}
```

## How it works

1. Merchant calls `createCheckoutSession()` with order details. A pending row is inserted in D1.
2. Merchant redirects the customer to the returned URL.
3. The hosted checkout page asks the customer to connect their wallet, captures the sender address, and prompts them to send N JPYC to the merchant's receiving address.
4. The customer's wallet returns a transaction hash. The page POSTs it back; the library verifies the receipt against expected sender, recipient, amount, and confirmations.
5. On success, `onPaid()` is called inside the same Worker. An optional webhook is also dispatched (HMAC-signed, best-effort).
6. A cron-triggered sweep re-verifies any pending sessions whose tx hash arrived but were never confirmed (e.g., the customer closed the tab mid-flight).

## Choosing `confirmations`

After the Heimdall v2 upgrade (July 2025), Polygon PoS guarantees a maximum reorg depth of **2 blocks**. We default to 8 (4× margin), giving ~16 seconds wait. For higher-value transactions, increase as needed.

| Use case            | Suggested  | Wait    |
| ------------------- | ---------- | ------- |
| Low-value paywall   | 4          | ~8s     |
| Default (any)       | 8          | ~16s    |
| Standard payment    | 16         | ~32s    |
| Mission-critical    | wait for L1 checkpoint (v0.2)  | ~30min  |

## Legal & compliance notes

This library is open-source middleware that helps integrate JPYC (an electronic payment instrument under Japan's revised Payment Services Act) into your Hono application. **It is not a payment service provider**, does not custody funds, and is not affiliated with JPYC株式会社.

- JPYC payments flow directly from customer wallets to your wallet on-chain.
- A per-transaction limit of 1,000,000 JPY applies (Type II Funds Transfer).
- You remain responsible for all applicable laws (特定商取引法, 消費者契約法, accounting/tax obligations under ASBJ Report No. 45, etc.).
- This library does not constitute legal, financial, or tax advice.

## Status

v0.1 — early. Polygon mainnet and Polygon Amoy testnet only; JPYC v2 only; Cloudflare Workers only. See [the design spec](./docs/superpowers/specs/2026-05-04-hono-jpyc-checkout-design.md) for the full v0.1 scope and what's deferred.

## License

MIT © Ryota Ikezawa
