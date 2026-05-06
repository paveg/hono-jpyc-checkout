import { describe, expect, it, vi } from 'vitest'
import { fireWebhook, signWebhook, verifyWebhookSignature } from '../src/webhook'

describe('signWebhook', () => {
  it('produces deterministic HMAC-SHA256 signature with timestamp prefix', async () => {
    const sig = await signWebhook('secret', 'body', 1730000000)
    expect(sig).toMatch(/^t=1730000000,v1=[a-f0-9]{64}$/)
  })
  it('different bodies produce different signatures', async () => {
    const a = await signWebhook('secret', 'one', 1730000000)
    const b = await signWebhook('secret', 'two', 1730000000)
    expect(a).not.toBe(b)
  })
})

describe('verifyWebhookSignature', () => {
  it('returns true for a signature it just produced', async () => {
    const sig = await signWebhook('secret', 'body', 1730000000)
    expect(await verifyWebhookSignature('secret', 'body', sig)).toBe(true)
  })
  it('returns false for tampered body', async () => {
    const sig = await signWebhook('secret', 'body', 1730000000)
    expect(await verifyWebhookSignature('secret', 'tampered', sig)).toBe(false)
  })
  it('returns false for wrong secret', async () => {
    const sig = await signWebhook('secret', 'body', 1730000000)
    expect(await verifyWebhookSignature('wrong', 'body', sig)).toBe(false)
  })
  it('returns false for malformed signature header', async () => {
    expect(await verifyWebhookSignature('secret', 'body', 'not-a-valid-sig')).toBe(false)
  })
})

describe('fireWebhook', () => {
  it('POSTs body with X-Jpyc-Signature header', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    await fireWebhook(
      { url: 'https://example.com/hook', secret: 'secret' },
      { id: 'evt_1', type: 'payment.succeeded', data: {} },
      fetchMock as unknown as typeof fetch,
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error('fetchMock was not called')
    const [url, init] = call
    expect(url).toBe('https://example.com/hook')
    expect((init as RequestInit).method).toBe('POST')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['X-Jpyc-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/)
    expect(headers['Content-Type']).toBe('application/json')
  })
  it('does not throw when fetch rejects', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(
      fireWebhook(
        { url: 'https://example.com/hook', secret: 'secret' },
        { id: 'evt_1', type: 'payment.succeeded', data: {} },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined()
  })
})
