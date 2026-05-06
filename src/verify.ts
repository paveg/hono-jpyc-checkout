import { TRANSFER_EVENT_TOPIC, decodeTransferLog, parseJpycAmount } from './jpyc/erc20'
import type { Session } from './types'

export interface RawLog {
  address: string
  topics: readonly string[]
  data: string
}

export interface TransactionReceipt {
  status: string
  to: string | null
  blockNumber: string
  logs: readonly RawLog[]
}

export interface VerifyInput {
  session: Session
  receipt: TransactionReceipt | null
  currentBlockNumber: bigint
  jpycContract: `0x${string}`
  confirmations: number
}

export type VerifyReason =
  | 'tx_not_mined'
  | 'tx_reverted'
  | 'wrong_contract'
  | 'no_transfer_log'
  | 'sender_mismatch'
  | 'recipient_mismatch'
  | 'amount_mismatch'
  | 'insufficient_confirmations'

export type VerifyResult =
  | { paid: true; blockNumber: number }
  | { paid: false; reason: VerifyReason }

export function verify(input: VerifyInput): VerifyResult {
  const { session, receipt, currentBlockNumber, jpycContract, confirmations } = input

  if (!receipt) return { paid: false, reason: 'tx_not_mined' }
  if (receipt.status !== '0x1') return { paid: false, reason: 'tx_reverted' }
  if (!receipt.to || receipt.to.toLowerCase() !== jpycContract.toLowerCase()) {
    return { paid: false, reason: 'wrong_contract' }
  }
  if (!session.expectedFromAddress) return { paid: false, reason: 'sender_mismatch' }

  const expectedAmountWei = parseJpycAmount(session.amount)
  const matchingLogs = receipt.logs
    .filter((log) => log.address.toLowerCase() === jpycContract.toLowerCase())
    .filter((log) => log.topics[0]?.toLowerCase() === TRANSFER_EVENT_TOPIC)
    .map(decodeTransferLog)
    .filter((d): d is NonNullable<typeof d> => d !== null)

  if (matchingLogs.length === 0) return { paid: false, reason: 'no_transfer_log' }

  const expectedFrom = session.expectedFromAddress.toLowerCase()
  const expectedTo = session.receivingAddress.toLowerCase()

  const fromMatches = matchingLogs.filter((log) => log.from.toLowerCase() === expectedFrom)
  if (fromMatches.length === 0) return { paid: false, reason: 'sender_mismatch' }

  const toMatches = fromMatches.filter((log) => log.to.toLowerCase() === expectedTo)
  if (toMatches.length === 0) return { paid: false, reason: 'recipient_mismatch' }

  const amountMatch = toMatches.find((log) => log.value === expectedAmountWei)
  if (!amountMatch) return { paid: false, reason: 'amount_mismatch' }

  const receiptBlock = BigInt(receipt.blockNumber)
  if (currentBlockNumber - receiptBlock < BigInt(confirmations)) {
    return { paid: false, reason: 'insufficient_confirmations' }
  }
  return { paid: true, blockNumber: Number(receiptBlock) }
}
