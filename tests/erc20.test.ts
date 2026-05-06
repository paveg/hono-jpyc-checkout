import { describe, expect, it } from 'vitest'
import {
  TRANSFER_EVENT_TOPIC,
  decodeTransferLog,
  encodeTransferCalldata,
  parseJpycAmount,
} from '../src/jpyc/erc20'

describe('TRANSFER_EVENT_TOPIC', () => {
  it('matches keccak256("Transfer(address,address,uint256)")', () => {
    expect(TRANSFER_EVENT_TOPIC).toBe(
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    )
  })
})

describe('parseJpycAmount', () => {
  it('converts "100" to 100 * 10^18 wei', () => {
    expect(parseJpycAmount('100')).toBe(100_000_000_000_000_000_000n)
  })
  it('handles fractional amounts up to 18 decimals', () => {
    expect(parseJpycAmount('0.5')).toBe(500_000_000_000_000_000n)
  })
  it('rejects negative values', () => {
    expect(() => parseJpycAmount('-1')).toThrow()
  })
  it('rejects more than 18 fractional digits', () => {
    expect(() => parseJpycAmount('1.0000000000000000001')).toThrow()
  })
})

describe('encodeTransferCalldata', () => {
  it('produces 0xa9059cbb-prefixed calldata of 68 bytes', () => {
    const calldata = encodeTransferCalldata(
      '0x1111111111111111111111111111111111111111',
      100_000_000_000_000_000_000n,
    )
    expect(calldata.startsWith('0xa9059cbb')).toBe(true)
    expect(calldata.length).toBe(2 + 8 + 64 + 64)
  })
})

describe('decodeTransferLog', () => {
  it('extracts from, to, value from a Transfer log', () => {
    const log = {
      topics: [
        TRANSFER_EVENT_TOPIC,
        '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ],
      data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
    }
    const decoded = decodeTransferLog(log)
    expect(decoded?.from.toLowerCase()).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(decoded?.to.toLowerCase()).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(decoded?.value).toBe(100_000_000_000_000_000_000n)
  })
  it('returns null when topic[0] is not Transfer', () => {
    expect(decodeTransferLog({ topics: ['0xdeadbeef', '0x', '0x'], data: '0x' })).toBeNull()
  })
  it('returns null when topics array is malformed', () => {
    expect(decodeTransferLog({ topics: [TRANSFER_EVENT_TOPIC], data: '0x' })).toBeNull()
  })
})
