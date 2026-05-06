import { JPYC_CONTRACTS, type Network } from './jpyc/contracts'
import { createRpcClient } from './rpc'
import {
  expireOverdueSessions,
  getSession,
  listOpenSessionsWithTxHash,
  markSessionFailed,
  markSessionPaid,
} from './session'
import {
  DEFAULT_CONFIRMATIONS,
  type PaidSession,
  type SweepConfig,
  type WebhookOptions,
} from './types'
import { verify } from './verify'
import { fireWebhook } from './webhook'

const SWEEP_BATCH_LIMIT = 100

export interface RunSweepOptions {
  db: D1Database
  rpcUrl: string
  network: Network
  confirmations?: number
  webhook?: WebhookOptions
  onPaid?: (session: PaidSession) => Promise<void>
  fetchImpl?: typeof fetch
}

export async function runSweep(opts: RunSweepOptions): Promise<{ expired: number; paid: number }> {
  const confirmations = opts.confirmations ?? DEFAULT_CONFIRMATIONS
  const jpycContract = JPYC_CONTRACTS[opts.network]
  const rpc = createRpcClient(opts.rpcUrl, opts.fetchImpl ?? fetch)

  const expired = await expireOverdueSessions(opts.db)
  const open = await listOpenSessionsWithTxHash(opts.db, SWEEP_BATCH_LIMIT)
  let paidCount = 0

  for (const session of open) {
    if (!session.txHash) continue
    try {
      const receipt = await rpc.getTransactionReceipt(session.txHash)
      if (!receipt) continue
      const blockN = await rpc.blockNumber()
      const result = verify({
        session,
        receipt,
        currentBlockNumber: blockN,
        jpycContract,
        confirmations,
      })
      if (result.paid) {
        const flipped = await markSessionPaid(
          opts.db,
          session.id,
          session.txHash,
          result.blockNumber,
        )
        if (flipped) {
          paidCount++
          const updated = (await getSession(opts.db, session.id)) as PaidSession
          if (opts.onPaid) await opts.onPaid(updated)
          if (opts.webhook) {
            await fireWebhook(
              opts.webhook,
              {
                id: `evt_${updated.id}`,
                type: 'payment.succeeded',
                data: {
                  session_id: updated.id,
                  order_id: updated.orderId,
                  amount: updated.amount,
                  currency: 'JPYC',
                  network: opts.network,
                  tx_hash: updated.txHash,
                  from_address: updated.expectedFromAddress,
                  to_address: updated.receivingAddress,
                  block_number: updated.blockNumber,
                  paid_at: updated.paidAt,
                },
              },
              opts.fetchImpl ?? fetch,
            )
          }
        }
      } else if (result.reason === 'tx_reverted') {
        await markSessionFailed(opts.db, session.id)
      }
    } catch (e) {
      console.error(`[hono-jpyc-checkout] sweep failed for ${session.id}:`, e)
    }
  }

  return { expired, paid: paidCount }
}

export function jpycSweep<Env>(config: SweepConfig<Env>) {
  return async (_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) => {
    await runSweep({
      db: config.db(env),
      rpcUrl: config.rpcUrl(env),
      network: config.network,
      confirmations: config.confirmations,
      webhook: config.webhook,
      onPaid: config.onPaid ? (s) => config.onPaid!(s, env) : undefined,
    })
  }
}
