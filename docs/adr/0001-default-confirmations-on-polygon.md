# ADR-0001: Default `confirmations = 8` on Polygon PoS

## Status

Accepted (2026-05-04)

## Context

`hono-jpyc-checkout` verifies on-chain JPYC transfers by reading transaction
receipts and counting block confirmations before marking a session as paid.
The confirmation threshold is the primary economic-safety knob: too low and
a chain reorganization can falsely confirm a payment that later disappears;
too high and the user-facing wait time becomes unacceptable for paywall UX.

We considered three candidate defaults:

- **10 (initial proposal):** Reasonable for paywall UX (~20 s wait), but
  justified only by intuition about Polygon's reorg statistics.
- **64 (revised proposal):** Conservative middle ground. ~2.5 min wait,
  matches some pre-Bhilai exchange standards.
- **8 (final decision):** Aggressive but defensible given current Polygon
  finality guarantees.

The decision pivots on Polygon's actual reorg behavior in 2026.

### Findings (verified 2026-05-04)

- The **Heimdall v2 upgrade** (July 2025) reduced finality from ~1–2 minutes
  to ~5 seconds and **caps reorg depth at 2 blocks** at the protocol level.
- The **Bhilai upgrade** improved throughput and finalization further.
- The **Giugliano upgrade** (April 2026) shaved another ~2 seconds off
  testnet finality.
- L1 cryptographic finality via Heimdall checkpoints to Ethereum still
  takes ~30 minutes. This remains the option for high-value scenarios.

## Decision

Default `confirmations = 8` (≈16 seconds at ~2 s/block).

Rationale: 4× safety margin over the protocol-guaranteed 2-block reorg cap,
while keeping wait time short enough for paywall UX.

The value is configurable per merchant via `JpycCheckoutConfig.confirmations`,
and the README documents recommended values for higher-value scenarios:

| Use case | Suggested |
| :--- | :--- |
| Low-value paywall | 4 |
| Default | 8 |
| Standard payment | 16 |
| High-value | 32–128 |
| Mission-critical | wait for L1 checkpoint (deferred to v0.2) |

## Consequences

- (+) Excellent user experience: ~16 s wait is competitive with Stripe.
- (+) Honest threat model — security claim is grounded in Polygon's
  current protocol guarantees, not in vague "looks safe" intuition.
- (+) Configurable, so merchants with higher-value transactions can opt
  into stricter confirmation counts without forking the library.
- (−) The default must be revisited if Polygon's reorg-depth guarantees
  weaken in a future upgrade. The v0.1 release checklist includes this
  verification step.
- (−) Merchants who do not read the security guidance might accept the
  default for transactions where it is too aggressive. This is mitigated
  by the README's "Choosing `confirmations`" section.

## Sources

- Polygon Developer Docs — Finality
  (`https://docs.polygon.technology/pos/concepts/finality/finality`)
- Polygon — Heimdall v2 hard fork announcement
  (`https://polygon.technology/blog/polygon-5-second-fast-finality-upgrade`)
- Polygon — Giugliano hard fork (April 2026)
- Stakin — Understanding Polygon's Bhilai and Heimdall Upgrades
