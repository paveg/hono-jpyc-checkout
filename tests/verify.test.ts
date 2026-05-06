import { describe, expect, it } from 'vitest'
import { TRANSFER_EVENT_TOPIC } from '../src/jpyc/erc20'
import type { Session } from '../src/types'
import { type TransactionReceipt, type VerifyInput, verify } from '../src/verify'

const JPYC_CONTRACT = '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB' as const
const FROM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const TO = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'cs_01H',
    orderId: 'article-123',
    amount: '100',
    status: 'pending',
    expectedFromAddress: FROM,
    receivingAddress: TO,
    txHash: null,
    blockNumber: null,
    paidAt: null,
    createdAt: '2026-05-04T00:00:00Z',
    updatedAt: '2026-05-04T00:00:00Z',
    expiresAt: '2026-05-04T01:00:00Z',
    metadata: {},
    ...overrides,
  }
}

function makeReceipt(overrides: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return {
    status: '0x1',
    to: JPYC_CONTRACT,
    blockNumber: '0x100',
    logs: [
      {
        address: JPYC_CONTRACT,
        topics: [
          TRANSFER_EVENT_TOPIC,
          `0x000000000000000000000000${FROM.slice(2)}`,
          `0x000000000000000000000000${TO.slice(2)}`,
        ],
        data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
      },
    ],
    ...overrides,
  }
}

function makeInput(overrides: Partial<VerifyInput> = {}): VerifyInput {
  return {
    session: makeSession(),
    receipt: makeReceipt(),
    currentBlockNumber: 0x108n,
    jpycContract: JPYC_CONTRACT,
    confirmations: 8,
    ...overrides,
  }
}

describe('verify', () => {
  it('paid:true when receipt valid and confirmations met', () => {
    expect(verify(makeInput())).toEqual({ paid: true, blockNumber: 0x100 })
  })

  it('tx_not_mined when receipt is null', () => {
    expect(verify(makeInput({ receipt: null }))).toEqual({ paid: false, reason: 'tx_not_mined' })
  })

  it('tx_reverted when status !== 0x1', () => {
    expect(verify(makeInput({ receipt: makeReceipt({ status: '0x0' }) }))).toEqual({
      paid: false,
      reason: 'tx_reverted',
    })
  })

  it('wrong_contract when receipt.to is not JPYC', () => {
    expect(
      verify(
        makeInput({
          receipt: makeReceipt({ to: '0x9999999999999999999999999999999999999999' }),
        }),
      ),
    ).toEqual({ paid: false, reason: 'wrong_contract' })
  })

  it('no_transfer_log when no Transfer event', () => {
    expect(verify(makeInput({ receipt: makeReceipt({ logs: [] }) }))).toEqual({
      paid: false,
      reason: 'no_transfer_log',
    })
  })

  it('sender_mismatch when log.from differs', () => {
    const wrong = makeReceipt({
      logs: [
        {
          address: JPYC_CONTRACT,
          topics: [
            TRANSFER_EVENT_TOPIC,
            '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
            `0x000000000000000000000000${TO.slice(2)}`,
          ],
          data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
        },
      ],
    })
    expect(verify(makeInput({ receipt: wrong }))).toEqual({
      paid: false,
      reason: 'sender_mismatch',
    })
  })

  it('recipient_mismatch when log.to differs', () => {
    const wrong = makeReceipt({
      logs: [
        {
          address: JPYC_CONTRACT,
          topics: [
            TRANSFER_EVENT_TOPIC,
            `0x000000000000000000000000${FROM.slice(2)}`,
            '0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd',
          ],
          data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
        },
      ],
    })
    expect(verify(makeInput({ receipt: wrong }))).toEqual({
      paid: false,
      reason: 'recipient_mismatch',
    })
  })

  it('amount_mismatch when value differs', () => {
    const wrong = makeReceipt({
      logs: [
        {
          address: JPYC_CONTRACT,
          topics: [
            TRANSFER_EVENT_TOPIC,
            `0x000000000000000000000000${FROM.slice(2)}`,
            `0x000000000000000000000000${TO.slice(2)}`,
          ],
          data: '0x0000000000000000000000000000000000000000000000002b5e3af16b188000',
        },
      ],
    })
    expect(verify(makeInput({ receipt: wrong }))).toEqual({
      paid: false,
      reason: 'amount_mismatch',
    })
  })

  it('insufficient_confirmations', () => {
    expect(verify(makeInput({ currentBlockNumber: 0x103n }))).toEqual({
      paid: false,
      reason: 'insufficient_confirmations',
    })
  })

  it('insufficient_confirmations when diff is exactly confirmations - 1', () => {
    // receiptBlock=0x100, current=0x107 -> diff=7, threshold=8 -> must fail
    // Pairs with the happy-path test at diff=8 to pin the < vs <= boundary in verify.ts.
    expect(verify(makeInput({ currentBlockNumber: 0x107n }))).toEqual({
      paid: false,
      reason: 'insufficient_confirmations',
    })
  })

  it('rejects log emitted by a different ERC-20', () => {
    const wrong = makeReceipt({
      logs: [
        {
          address: '0x9999999999999999999999999999999999999999',
          topics: [
            TRANSFER_EVENT_TOPIC,
            `0x000000000000000000000000${FROM.slice(2)}`,
            `0x000000000000000000000000${TO.slice(2)}`,
          ],
          data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
        },
      ],
    })
    expect(verify(makeInput({ receipt: wrong }))).toEqual({
      paid: false,
      reason: 'no_transfer_log',
    })
  })

  it('accepts when one of multiple Transfer logs matches', () => {
    const noiseAndMatch = makeReceipt({
      logs: [
        {
          address: '0x9999999999999999999999999999999999999999',
          topics: [TRANSFER_EVENT_TOPIC, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
          data: '0x0',
        },
        {
          address: JPYC_CONTRACT,
          topics: [
            TRANSFER_EVENT_TOPIC,
            `0x000000000000000000000000${FROM.slice(2)}`,
            `0x000000000000000000000000${TO.slice(2)}`,
          ],
          data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
        },
      ],
    })
    expect(verify(makeInput({ receipt: noiseAndMatch }))).toEqual({
      paid: true,
      blockNumber: 0x100,
    })
  })

  it('finds matching log when there is amount-noise from same JPYC contract / from / to', () => {
    // Two Transfer logs from JPYC, same from and to, but only the second has the
    // expected amount. Pins the .find(value === expectedAmountWei) selection
    // inside the JPYC-filtered set (the existing "multiple logs" test only mixes
    // a different ERC-20 as noise, which gets filtered out earlier).
    const r = makeReceipt({
      logs: [
        {
          address: JPYC_CONTRACT,
          topics: [
            TRANSFER_EVENT_TOPIC,
            `0x000000000000000000000000${FROM.slice(2)}`,
            `0x000000000000000000000000${TO.slice(2)}`,
          ],
          data: '0x0000000000000000000000000000000000000000000000000000000000000001', // wrong amount (1 wei)
        },
        {
          address: JPYC_CONTRACT,
          topics: [
            TRANSFER_EVENT_TOPIC,
            `0x000000000000000000000000${FROM.slice(2)}`,
            `0x000000000000000000000000${TO.slice(2)}`,
          ],
          data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000', // correct (100 * 10^18)
        },
      ],
    })
    expect(verify(makeInput({ receipt: r }))).toEqual({ paid: true, blockNumber: 0x100 })
  })

  it('sender_mismatch when expectedFromAddress is null', () => {
    expect(verify(makeInput({ session: makeSession({ expectedFromAddress: null }) }))).toEqual({
      paid: false,
      reason: 'sender_mismatch',
    })
  })
})
