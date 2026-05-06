// Helpers for ERC-20 Transfer events and transfer calldata.
// Pure functions only.

export const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const

const TRANSFER_FUNCTION_SELECTOR = '0xa9059cbb' as const

export function parseJpycAmount(decimal: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(decimal)) {
    throw new Error(`invalid amount: ${decimal}`)
  }
  // The regex above guarantees at least one digit before the optional '.'.
  const [whole = '0', frac = ''] = decimal.split('.')
  if (frac.length > 18) {
    throw new Error(`amount exceeds 18 decimal places: ${decimal}`)
  }
  const padded = frac.padEnd(18, '0')
  return BigInt(whole) * 10n ** 18n + BigInt(padded || '0')
}

export function encodeTransferCalldata(to: `0x${string}`, value: bigint): `0x${string}` {
  const toClean = to.toLowerCase().replace(/^0x/, '')
  if (toClean.length !== 40) throw new Error(`invalid address: ${to}`)
  const valueHex = value.toString(16).padStart(64, '0')
  return `${TRANSFER_FUNCTION_SELECTOR}${toClean.padStart(64, '0')}${valueHex}` as `0x${string}`
}

export interface TransferLog {
  from: `0x${string}`
  to: `0x${string}`
  value: bigint
}

interface RawLog {
  topics: readonly string[]
  data: string
}

export function decodeTransferLog(log: RawLog): TransferLog | null {
  if (log.topics.length !== 3) return null
  if (log.topics[0]?.toLowerCase() !== TRANSFER_EVENT_TOPIC) return null
  const from = topicToAddress(log.topics[1])
  const to = topicToAddress(log.topics[2])
  if (!from || !to) return null
  if (!/^0x[0-9a-fA-F]+$/.test(log.data)) return null
  return { from, to, value: BigInt(log.data) }
}

function topicToAddress(topic: string | undefined): `0x${string}` | null {
  if (!topic) return null
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(topic)) return null
  return `0x${topic.slice(26)}` as `0x${string}`
}
