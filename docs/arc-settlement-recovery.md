# Day-7 supplier rounding recovery

The live demo stopped at day 7 because a supplier quote differed between JavaScript and the escrow. The premium house agent requested 13 colas and 9 Trail Mix items from Metro Express. JavaScript evaluated `90 * 1.15` as `103.49999999999999` and rounded to 103. Solidity's exact integer formula rounded the half unit to 104. The old request authorized 1,980 game units of supplier spend; the corrected full order costs 1,989.

The failed operation was rejected during preflight and had no transaction bytes, hash or receipt. Days 1–6 and their balances remained confirmed onchain.

## Fix

All engine quotes, built-in house policies, the example policy and bundled runners now use integer percentage arithmetic and half-up rounding, matching the escrow. The contract does not change. Arc day planning also enforces each original signed supplier limit when applying orders. An order outside the remaining limit is rejected before creating a payment or delivery.

On startup, the server repairs only an unbroadcast failed daily job with the recognizable legacy rounding mismatch. It requires the same current frozen morning, unchanged day and unchanged permit bytes. It rebuilds the pending plan from the stored daily decisions and records the old payload in a private `arc_job_repairs` audit table. It does not reopen decisions or change confirmed game balances. Prepared, broadcast, reverted-onchain and confirmed transactions never qualify.

For day 7, the 13 colas fit the original limit; the 9 Trail Mix items do not. The latter order is skipped, with a visible game event explaining why. No spending cap is increased and no replacement signature or new entry deposit is needed. Future orders use the corrected quote, so the agent can replenish normally the next day.

The recovered job uses the existing transaction journal: preflight, capped gas estimate, persist signed bytes, broadcast, verify the receipt and only then publish the new game balances. The public job exposes a repair reason, while the original payload and private notebooks remain private.

## Validation

- Replayed all six confirmed live days and matched each machine's cash, inventory, storage, deliveries, revenue, spending and fees.
- Reproduced the legacy `Invalid()` revert through a read-only call against the deployed Arc contract, then verified the corrected, capped day passes preflight with the original spending caps.
- Compared all 2,160 product/supplier/quantity combinations with the escrow's integer formula.
- Added recovery tests for audit preservation, idempotency, original decision/signature/cap preservation, unchanged confirmed state, and refusal to modify unrelated or potentially broadcast jobs.
- The local EVM test reproduces the actual rounding failure with real signatures, recovers it, then finishes and pays out the entire season with exact balance reconciliation.

Restart running local agents after updating the engine so their spending-permit calculations use the same corrected quotes as the server. This resumes existing seats; it does not repay entry fees. The owner dashboard retains its saved strategy and private history.

## Live result — 2026-09-13

Release `d07006ec-7989-4223-a082-1108ec73bfef` recovered the same pending job, ID 11. [Day 7 settled on Arc](https://testnet.arcscan.app/tx/0x5dac5c8b773f56b788176ff7038db658a3768d0cb7eb1f9d9ec47cce773ee0be) at block 61890658 with 63 customer purchases, the 13-cola supplier payment and 0.013559364 test USDC operator gas. All four machine balances, the customer budget and escrow liabilities reconcile with the chain. The season retained its four original entry deposits. Day 8 opened normally; the three updated house runners resumed their existing seats. The owner dashboard was restarted with its prior paused mode and saved strategy preserved.

79 application tests and both complete local contract scenarios passed. The public recovery evidence is in [day7-recovery.json](../contracts/deployments/day7-recovery.json).
