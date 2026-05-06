// JPYC v2 contract addresses per supported network.
// Action item before v0.1 release: re-verify these addresses against
// the current JPYC official documentation.

export type Network = 'polygon' | 'polygon-amoy'

export const JPYC_DECIMALS = 18

export const JPYC_CONTRACTS = {
  polygon: '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB',
  // Placeholder. Resolve before v0.1 release; see release checklist.
  'polygon-amoy': '0x0000000000000000000000000000000000000000',
} as const satisfies Record<Network, `0x${string}`>

export const RPC_DEFAULTS = {
  polygon: 'https://polygon-rpc.com',
  'polygon-amoy': 'https://rpc-amoy.polygon.technology',
} as const satisfies Record<Network, string>
