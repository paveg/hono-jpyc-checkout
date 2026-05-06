# hono-jpyc-checkout

> **非公式 OSS ライブラリ。** JPYC 株式会社とは無関係、後援・推奨もされていない。「JPYC」はそれぞれの所有者の商標。

Cloudflare Workers 上の [Hono](https://hono.dev) アプリで [JPYC](https://jpyc.jp) 決済を受け取るためのミドルウェア。3 行追加して、ユーザーをホスト型チェックアウトページにリダイレクトすると、オンチェーンの送金確認後に `onPaid` コールバックが呼ばれる。

- 🇯🇵 **JPYC** — Polygon 上の日本円ペッグステーブルコイン
- ⚡ **Cloudflare Workers** — エッジ駆動、サーバ不要
- 🔐 **ノンカストディアル** — 顧客ウォレットからマーチャントアドレスへ直接送金。ライブラリは資金を一切保持しない
- 📦 **小さい bundle** — ホストページ ~14KB、ライブラリ本体 ~30KB

[English README](./README.md)

## クイックスタート

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
```

## 動作の流れ

1. マーチャントが `createCheckoutSession()` で注文を作成。D1 に pending 行が入る
2. マーチャントが顧客を返却 URL にリダイレクト
3. ホストページが Connect Wallet を促し、送信元アドレスを取得後、N JPYC を受領アドレスに送信させる
4. 送信した tx hash をフロントが POST。サーバが receipt を検証（送信元・受領先・金額・confirmation 数）
5. paid 化と同時に同じ Worker 内で `onPaid()` を呼ぶ。任意で外部 webhook も送る（HMAC 署名、best-effort）
6. cron sweep が「tx hash まで到達したが confirmation 不足だったセッション」を 10 分毎に再検証する保険として動く

## 規制とコンプライアンス

JPYC（電子決済手段、改正資金決済法）を Hono アプリに組み込むための OSS ミドルウェア。**決済代行サービスではない**。資金を保持せず、JPYC 株式会社とも無関係。

- JPYC は顧客ウォレットからマーチャントウォレットへオンチェーンで直接送金される
- 1 件あたり 100 万円の上限（第二種資金移動業相当）が適用される
- 特定商取引法・消費者契約法・ASBJ 第 45 号による会計処理など、各種法令の遵守はマーチャント側の責任
- このライブラリは法律・金融・税務助言ではない

## ステータス

v0.1 — 初期。Polygon mainnet / Polygon Amoy testnet のみ、JPYC v2 のみ、Cloudflare Workers のみ。v0.2 以降の拡張は [設計ドキュメント](./docs/superpowers/specs/2026-05-04-hono-jpyc-checkout-design.md) を参照。

## ライセンス

MIT © Ryota Ikezawa
