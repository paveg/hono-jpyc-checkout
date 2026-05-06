import type { WebhookOptions } from './types'

const WEBHOOK_TIMEOUT_MS = 5000

export interface WebhookPayload {
  id: string
  type: 'payment.succeeded'
  data: Record<string, unknown>
}

export async function signWebhook(
  secret: string,
  body: string,
  timestampSec: number,
): Promise<string> {
  const message = `${timestampSec}.${body}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `t=${timestampSec},v1=${sigHex}`
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
): Promise<boolean> {
  const parsed = parseSignatureHeader(header)
  if (!parsed) return false
  const expected = await signWebhook(secret, body, parsed.timestamp)
  return timingSafeEqual(expected, header)
}

function parseSignatureHeader(header: string): { timestamp: number; v1: string } | null {
  const parts = header.split(',').map((p) => p.trim())
  const tPart = parts.find((p) => p.startsWith('t='))
  const vPart = parts.find((p) => p.startsWith('v1='))
  if (!tPart || !vPart) return null
  const timestamp = Number(tPart.slice(2))
  const v1 = vPart.slice(3)
  if (!Number.isFinite(timestamp) || !/^[a-f0-9]{64}$/.test(v1)) return null
  return { timestamp, v1 }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export async function fireWebhook(
  opts: WebhookOptions,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await signWebhook(opts.secret, body, timestamp)

  try {
    await fetchImpl(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Jpyc-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
  } catch (e) {
    // Best-effort delivery: log and swallow. The merchant's primary path is onPaid.
    console.error('[hono-jpyc-checkout] webhook delivery failed:', e)
  }
}
