import type { TransactionReceipt } from './verify'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_RETRIES = 2
const DEFAULT_BACKOFF_BASE_MS = 200

export interface RpcClient {
  blockNumber(): Promise<bigint>
  getTransactionReceipt(hash: string): Promise<TransactionReceipt | null>
}

export interface RpcOptions {
  retries?: number
  backoffBaseMs?: number
  timeoutMs?: number
}

export function createRpcClient(
  url: string,
  fetchImpl: typeof fetch = fetch,
  opts: RpcOptions = {},
): RpcClient {
  const retries = opts.retries ?? DEFAULT_RETRIES
  const backoff = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: attempt + 1, method, params }),
          signal: AbortSignal.timeout(timeout),
        })
        if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
        const json = (await res.json()) as {
          result?: T
          error?: { code: number; message: string }
        }
        if (json.error) throw new Error(`RPC error: ${json.error.message}`)
        return json.result as T
      } catch (e) {
        lastError = e
        if (attempt < retries) {
          await sleep(backoff * 2 ** attempt)
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  return {
    async blockNumber() {
      const hex = await call<string>('eth_blockNumber', [])
      return BigInt(hex)
    },
    async getTransactionReceipt(hash: string) {
      return call<TransactionReceipt | null>('eth_getTransactionReceipt', [hash])
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
