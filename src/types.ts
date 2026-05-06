import type { Context } from 'hono'
import type { Network } from './jpyc/contracts'

export type { Network }

export type SessionStatus = 'pending' | 'paid' | 'expired' | 'failed'

export interface Session {
  id: string
  orderId: string
  amount: string
  status: SessionStatus
  expectedFromAddress: `0x${string}` | null
  receivingAddress: `0x${string}`
  txHash: `0x${string}` | null
  blockNumber: number | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
  metadata: Record<string, string>
}

export type PaidSession = Session & {
  status: 'paid'
  txHash: `0x${string}`
  blockNumber: number
  paidAt: string
}

export interface CreateSessionParams {
  orderId: string
  amount: string
  successUrl: string
  cancelUrl: string
  expiresInSec?: number
  metadata?: Record<string, string>
}

export interface ThemeOptions {
  primaryColor?: string
  logo?: string
  merchantName?: string
}

export interface WebhookOptions {
  url: string
  secret: string
}

export interface JpycCheckoutConfig {
  network: Network
  receivingAddress: (c: Context) => `0x${string}`
  rpcUrl: (c: Context) => string
  db: (c: Context) => D1Database
  confirmations?: number
  theme?: ThemeOptions
  onPaid?: (session: PaidSession, c: Context) => Promise<void>
  webhook?: WebhookOptions
}

export interface SweepConfig<Env = unknown> {
  db: (env: Env) => D1Database
  rpcUrl: (env: Env) => string
  receivingAddress: (env: Env) => `0x${string}`
  network: Network
  confirmations?: number
  webhook?: WebhookOptions
  onPaid?: (session: PaidSession, env: Env) => Promise<void>
}

export const DEFAULT_CONFIRMATIONS = 8 as const
export const DEFAULT_EXPIRES_IN_SEC = 1800 as const
