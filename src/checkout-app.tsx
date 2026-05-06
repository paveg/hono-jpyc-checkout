import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as v from 'valibot'
import { JPYC_CONTRACTS, type Network } from './jpyc/contracts'
import { createRpcClient } from './rpc'
import {
  getSession,
  markSessionFailed,
  markSessionPaid,
  readStoredUrl,
  registerSenderAddress,
  setSessionTxHashIfMissing,
} from './session'
import { DEFAULT_CONFIRMATIONS, type JpycCheckoutConfig, type PaidSession } from './types'
import { CheckoutPage } from './ui/page'
import { type TransactionReceipt, verify } from './verify'
import { fireWebhook } from './webhook'

const ConnectBody = v.object({
  fromAddress: v.pipe(v.string(), v.regex(/^0x[a-fA-F0-9]{40}$/)),
})

const VerifyBody = v.object({
  txHash: v.pipe(v.string(), v.regex(/^0x[a-fA-F0-9]{64}$/)),
})

const CHAIN_ID_HEX: Record<Network, string> = {
  polygon: '0x89',
  'polygon-amoy': '0x13882',
}

type ErrorStatus = 400 | 404 | 409 | 410 | 422 | 500 | 502

export function jpycCheckout(config: JpycCheckoutConfig): Hono {
  const app = new Hono()
  const confirmations = config.confirmations ?? DEFAULT_CONFIRMATIONS
  const jpycContract = JPYC_CONTRACTS[config.network]

  app.get('/:id', async (c) => {
    const session = await getSession(config.db(c), c.req.param('id'))
    if (!session) return errorResponse(c, 404, 'session_not_found', 'Session not found')

    const url = new URL(c.req.url)
    const apiPrefix = url.pathname.replace(/\/[^/]+$/, '')
    return c.html(
      <CheckoutPage
        session={session}
        theme={config.theme ?? {}}
        bootstrap={{
          sessionId: session.id,
          amount: session.amount,
          receivingAddress: session.receivingAddress,
          jpycContract,
          chainIdHex: CHAIN_ID_HEX[config.network],
          successUrl: absoluteUrl(readStoredUrl(session, 'success'), url),
          cancelUrl: absoluteUrl(readStoredUrl(session, 'cancel'), url),
          apiPrefix,
        }}
      />,
    )
  })

  app.get('/:id/status', async (c) => {
    const session = await getSession(config.db(c), c.req.param('id'))
    if (!session) return errorResponse(c, 404, 'session_not_found', 'Session not found')
    return c.json({
      id: session.id,
      status: session.status,
      txHash: session.txHash,
      paidAt: session.paidAt,
    })
  })

  app.post('/:id/connect', vValidator('json', ConnectBody), async (c) => {
    const id = c.req.param('id')
    const session = await getSession(config.db(c), id)
    if (!session) return errorResponse(c, 404, 'session_not_found', 'Session not found')
    if (session.status !== 'pending')
      return errorResponse(c, 409, 'session_not_pending', 'Session is not pending')
    const { fromAddress } = c.req.valid('json')
    const ok = await registerSenderAddress(config.db(c), id, fromAddress)
    if (!ok)
      return errorResponse(c, 409, 'session_not_pending', 'Sender already set or session changed')
    return c.json({ ok: true })
  })

  app.post('/:id/verify', vValidator('json', VerifyBody), async (c) => {
    const id = c.req.param('id')
    const db = config.db(c)
    const session = await getSession(db, id)
    if (!session) return errorResponse(c, 404, 'session_not_found', 'Session not found')
    if (session.status === 'paid') {
      return c.json({
        paid: true,
        redirectUrl: absoluteUrl(readStoredUrl(session, 'success'), new URL(c.req.url)),
      })
    }
    if (session.status !== 'pending')
      return errorResponse(c, 410, 'session_expired', 'Session is no longer payable')

    const { txHash } = c.req.valid('json')
    await setSessionTxHashIfMissing(db, id, txHash)

    let receipt: TransactionReceipt | null
    let blockNumber: bigint
    try {
      const rpc = createRpcClient(config.rpcUrl(c))
      receipt = await rpc.getTransactionReceipt(txHash)
      blockNumber = await rpc.blockNumber()
    } catch (e) {
      return errorResponse(c, 502, 'rpc_unavailable', (e as Error).message)
    }

    const result = verify({
      session,
      receipt,
      currentBlockNumber: blockNumber,
      jpycContract,
      confirmations,
    })

    if (!result.paid) {
      if (result.reason === 'tx_reverted') {
        await markSessionFailed(db, id)
      }
      const progress =
        result.reason === 'insufficient_confirmations' && receipt
          ? {
              confirmed: Number(blockNumber - BigInt(receipt.blockNumber)),
              required: confirmations,
            }
          : undefined
      return c.json({ paid: false, reason: result.reason, progress })
    }

    const flipped = await markSessionPaid(db, id, txHash, result.blockNumber)
    if (flipped) {
      const updated = (await getSession(db, id)) as PaidSession
      if (config.onPaid) await config.onPaid(updated, c)
      if (config.webhook) {
        c.executionCtx.waitUntil(
          fireWebhook(config.webhook, {
            id: `evt_${updated.id}`,
            type: 'payment.succeeded',
            data: {
              session_id: updated.id,
              order_id: updated.orderId,
              amount: updated.amount,
              currency: 'JPYC',
              network: config.network,
              tx_hash: updated.txHash,
              from_address: updated.expectedFromAddress,
              to_address: updated.receivingAddress,
              block_number: updated.blockNumber,
              paid_at: updated.paidAt,
            },
          }),
        )
      }
    }

    return c.json({
      paid: true,
      redirectUrl: absoluteUrl(readStoredUrl(session, 'success'), new URL(c.req.url)),
    })
  })

  return app
}

function errorResponse(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json({ error: { code, message } }, status)
}

function absoluteUrl(path: string, requestUrl: URL): string {
  try {
    return new URL(path, requestUrl.origin).toString()
  } catch {
    return path
  }
}
