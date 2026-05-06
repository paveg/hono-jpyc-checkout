import { Hono } from 'hono'
import {
  createCheckoutSession,
  jpycCheckout,
  jpycSweep,
  type Network,
} from 'hono-jpyc-checkout'

interface Env {
  DB: D1Database
  RPC_URL: string
  RECEIVING_ADDRESS: string
  NETWORK: Network
}

const app = new Hono<{ Bindings: Env }>()

app.route(
  '/checkout',
  jpycCheckout({
    network: 'polygon-amoy',
    receivingAddress: (c) => c.env.RECEIVING_ADDRESS as `0x${string}`,
    rpcUrl: (c) => c.env.RPC_URL,
    db: (c) => c.env.DB,
    theme: { merchantName: 'Demo Merchant', primaryColor: '#1a73e8' },
    onPaid: async (session) => {
      console.log(`[demo] paid: ${session.orderId} -> ${session.txHash}`)
    },
  }),
)

app.get('/', (c) =>
  c.html(`
    <!doctype html>
    <html>
      <body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
        <h1>hono-jpyc-checkout demo</h1>
        <p>Click below to start a paywall purchase (100 JPYC).</p>
        <form method="POST" action="/articles/demo/buy">
          <button type="submit">Unlock article for 100 JPYC</button>
        </form>
      </body>
    </html>
  `),
)

app.post('/articles/:id/buy', async (c) => {
  const orderId = c.req.param('id')
  const url = new URL(c.req.url)
  const session = await createCheckoutSession(c.env.DB, {
    orderId,
    amount: '100',
    successUrl: `${url.origin}/articles/${orderId}/unlocked`,
    cancelUrl: `${url.origin}/`,
    receivingAddress: c.env.RECEIVING_ADDRESS,
    origin: url.origin,
  })
  return c.redirect(session.url)
})

app.get('/articles/:id/unlocked', (c) =>
  c.html(`
    <!doctype html>
    <html>
      <body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
        <h1>Unlocked: ${c.req.param('id')}</h1>
        <p>Thank you for your payment.</p>
      </body>
    </html>
  `),
)

export default {
  fetch: app.fetch,
  scheduled: jpycSweep<Env>({
    db: (env) => env.DB,
    rpcUrl: (env) => env.RPC_URL,
    receivingAddress: (env) => env.RECEIVING_ADDRESS as `0x${string}`,
    network: 'polygon-amoy',
  }),
}
