import { describe, expect, it, vi } from 'vitest'
import { createRpcClient } from '../src/rpc'

describe('createRpcClient', () => {
  it('parses eth_blockNumber hex result', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xabc' })),
    )
    const rpc = createRpcClient('https://rpc.example', fetchMock as unknown as typeof fetch)
    expect(await rpc.blockNumber()).toBe(0xabcn)
  })
  it('returns null receipt when result is null', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })),
    )
    const rpc = createRpcClient('https://rpc.example', fetchMock as unknown as typeof fetch)
    expect(await rpc.getTransactionReceipt('0xdeadbeef')).toBeNull()
  })
  it('throws after exhausting retries', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    const rpc = createRpcClient('https://rpc.example', fetchMock as unknown as typeof fetch, {
      retries: 1,
      backoffBaseMs: 1,
    })
    await expect(rpc.blockNumber()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('throws on RPC error response', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'oops' } }),
        ),
    )
    const rpc = createRpcClient('https://rpc.example', fetchMock as unknown as typeof fetch, {
      retries: 0,
    })
    await expect(rpc.blockNumber()).rejects.toThrow(/oops/)
  })
})
