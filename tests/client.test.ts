import { describe, expect, it } from 'vitest'
import { renderClientScript } from '../src/ui/client'

const BASE = {
  sessionId: 'cs_01H',
  amount: '100',
  receivingAddress: '0x1111111111111111111111111111111111111111',
  jpycContract: '0x2222222222222222222222222222222222222222',
  chainIdHex: '0x89',
  successUrl: 'https://example.com/ok',
  cancelUrl: 'https://example.com/cancel',
  apiPrefix: '/checkout',
}

describe('renderClientScript', () => {
  it('escapes < to prevent breaking out of <script>', () => {
    const out = renderClientScript({
      ...BASE,
      successUrl: '</script><script>alert(1)</script>',
    })
    // The literal "</script>" must NOT appear; "</script>" should.
    expect(out).not.toContain('</script>')
    expect(out).toContain('\\u003c/script>')
  })

  it('escapes < in any field, not just URLs', () => {
    const out = renderClientScript({ ...BASE, sessionId: 'cs_<test>' })
    expect(out).not.toMatch(/cs_<test>/)
    expect(out).toContain('\\u003ctest>')
  })

  it('embeds bootstrap as accessible JSON', () => {
    const out = renderClientScript(BASE)
    // The JSON should appear inside the IIFE (no escaping needed for safe values)
    expect(out).toContain('"sessionId":"cs_01H"')
    expect(out).toContain('"amount":"100"')
    expect(out).toContain(BASE.receivingAddress)
  })

  it('produces a self-invoking function', () => {
    const out = renderClientScript(BASE)
    expect(out.startsWith('(function () {')).toBe(true)
    expect(out.trimEnd().endsWith('})();')).toBe(true)
  })

  it('does not escape > (asymmetric escape is intentional)', () => {
    // The escape only handles `<` because that is the start of </script>.
    // `>` alone cannot break out, so it stays literal.
    const out = renderClientScript({ ...BASE, successUrl: 'https://e.com/?q=>' })
    expect(out).toContain('?q=>')
  })
})
