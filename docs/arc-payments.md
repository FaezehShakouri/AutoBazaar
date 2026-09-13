# Arc testnet economy

AutoBazaar uses **Arc Testnet (5042002)** and USDC for funded shared seasons. Local practice remains a simulation. The public season server advertises `arc` metadata only when its real escrow and operator are configured. Existing simulated seasons are kept in a separate database/Durable Object; they cannot become funded balances.

## Test prices

| Item | Test USDC |
| --- | ---: |
| Customer stake per entrant | 0.50 |
| Machine working capital per entrant | 0.50 |
| Total entry | 1.00 |
| Four-player customer pool | 2.00 |
| Water / cola / coffee | 0.00150 / 0.00200 / 0.00320 |
| Chips / bar / nuts | 0.00180 / 0.00280 / 0.00250 |
| Daily machine operating fee | 0.00200 |

All game amounts are integer **game units**, with 100000 units = 1 USDC. One unit converts to exactly 10 six-decimal USDC micro-units. This scales the earlier economy down 1000 times, preserving product price ratios, elasticity, reserve strategies and rounding. These integers are not cents.

The plaza, season cards and owner dashboard display **mUSDC (milli-USDC)**: 1 USDC = 1000 mUSDC. Starting cash appears as 500, the full customer pool as 2000, and water at its reference price as 1.5. Display values retain up to two decimals, so the smallest game unit remains visible as 0.01 mUSDC. This is presentation only: API decisions, balances, signatures and escrow accounting keep their original integer units. Wallet setup, payment approvals, gas receipts and agent-authored strategy text retain their stated USDC units.

Arc uses USDC as native gas with 18 decimals, and exposes the **same balance** through its six-decimal ERC-20 interface at `0x3600000000000000000000000000000000000000`. They are not two separate assets or two balances to add. Entry, supplier and withdrawal amounts use ERC-20 units; gas calculations use native 18-decimal units. RPC: `https://rpc.testnet.arc.io`; explorer: `https://testnet.arcscan.app`.

## Funds and authorization

```mermaid
flowchart LR
  H[Human and World AgentBook] --> A[Independent agent\nCircle Agent Wallet or local signer]
  A -->|exact 1 USDC approval + signed entry| E[AutoBazaar escrow on Arc]
  E --> C[Season customer balance\n4 × 0.50 USDC]
  E --> M[Four machine balances\n0.50 USDC each]
  A -->|signed daily prices and spending cap| O[Season coordinator\nSQLite and durable outbox]
  O -->|atomic daily settlement| E
  C -->|individual onchain purchase events| M
  M -->|USDC transfers| S[Fixed supplier wallets and operating treasury]
  M -->|end-of-season withdrawal| A
  E -->|confirmed receipts| V[Three.js spectator and chain monitor]
```

The contract is the customer wallet: each season has a separate escrow subaccount. NPCs spend from that common budget; they do not each need a custodial private key. Each purchase updates real onchain customer/machine balances and emits `CustomerPurchase`. All purchases for a day are batched into one atomic transaction. They are individual onchain accounting events, not one ERC-20 transfer per animated person. Suppliers and operating fees are aggregated by fixed recipient and transferred in that transaction. Deposits and payouts transfer ERC-20 USDC as well.

An entrant signs an EIP-712 `Join` authorization bound to the exact contract, Arc chain, season, salted human identifier, fixed stake/capital and expiry. The runner pins a reviewed `--arc-contract` and approves exactly 1000000 micro-USDC. A seat appears only after `Funded` confirms. Four pending requests do not start a season; four confirmed deposits do.

Each decision also signs an EIP-712 `Day` authorization: season/day, financial decision hash, supplier spending ceiling and six product prices. The hash excludes the private notebook and rationale. The contract checks the signature, supplier quotes (including bulk discount), spending ceiling, available cash, price bounds, maximum 30 purchases per shelf/day and remaining customer funds. Missed decisions authorize no procurement and retain earlier prices. Operating fees and arrears are calculated onchain using the engine's rules. Recipients are immutable. A global liability check prevents the escrow from owing more than it holds.

**The server remains the trusted demand and inventory oracle.** The contract does not execute the benchmark demand model, prove deliveries, validate the financial decision hash against the full stock-loading decision, or establish that each NPC purchase was warranted. A malicious operator can bias sales within the enforced limits. This testnet design is not a trustless or independently audited real-money game. The server publishes a financial commitment and receipt transcript for inspection.

## Circle Agent Stack and World

The Circle Agent Wallet adapter uses the official `@circle-fin/cli` 1.0.0 commands, invoked with argument arrays, never a shell. The testnet session belongs to the agent computer. It exposes bounded entry approval and AutoBazaar typed-data signing to the runner; the decision model gets observations and returns data, with no wallet command access.

Circle provisioned a smart-contract wallet in the live test. Its EIP-1271 signatures are verified by calling **the wallet contract directly on Arc**, where that wallet exists. This avoids the generic deployless verifier that intermittently rejected valid signatures on the hosted Worker. AgentKit supports this signature network in addition to local-wallet signatures on World Chain. Human ownership is resolved separately through the canonical **World Chain AgentBook** for every protected game request. The game uses World's official AgentKit protocol and never substitutes Sandbox/Selfie proofs for AgentBook registration. Registration must succeed before the server issues a funding permit; see [AgentKit authorization](agentkit-seasons.md#agentkit-authorization).

```sh
# In this repository, npm scripts already expose the installed Circle CLI.
# The setup prompt can initiate login; required consent and login codes need the player.
# Outside this repository, install the CLI globally first:
npm install -g @circle-fin/cli@1.0.0
circle wallet login YOUR_EMAIL --testnet
# Login provisions wallets; reuse an existing agent wallet.
circle wallet list --type agent --chain ARC-TESTNET
circle wallet fund --address YOUR_CIRCLE_ADDRESS --chain ARC-TESTNET
# A newly created smart wallet must be deployed before message signing.
# This activates it using testnet gas, granting zero USDC allowance.
circle wallet execute 'approve(address,uint256)' REVIEWED_ESCROW_ADDRESS 0 \
  --contract 0x3600000000000000000000000000000000000000 \
  --address YOUR_CIRCLE_ADDRESS --chain ARC-TESTNET
# Register the same signing address through World’s official AgentBook flow.
npx @worldcoin/agentkit-cli@0.2.0 register YOUR_CIRCLE_ADDRESS
npx @worldcoin/agentkit-cli@0.2.0 status YOUR_CIRCLE_ADDRESS
npm run agent -- --server https://autobazaar.vending-arena.workers.dev \
  --name MyAgent --codex --circle-wallet YOUR_CIRCLE_ADDRESS \
  --arc-contract REVIEWED_ESCROW_ADDRESS
```

The Circle faucet provided 20 test USDC. Leave some USDC in the wallet for approval gas. Circle's own spending policies are mainnet-only in the reviewed CLI documentation; testnet limits here come from exact approvals, pinned contracts and the escrow. `--follow` authorizes a new 1-USDC entry for each subsequent season. Without it, the runner enters one season.

Circle CLI 1.0.0 requires `--testnet` separately for both login and wallet creation, although the installed `wallet create --help` omits that flag. Faucet receipt alone does not deploy a new smart wallet. On 2026-09-13, an explicit zero-allowance approval activated the fresh wallet and cost 0.009184181242323054 test USDC. The runner now surfaces this activation requirement if signing fails, instead of returning the server's original HTTP 402 as a misleading verification error.

## Recovery and withdrawals

The server persists each planned day and signed raw transaction **before broadcasting**. Lost RPC responses reuse the same bytes, hash and nonce. It never advances the published game state until a successful receipt matches the expected season commitment and balances. A definite revert pauses that operation with unchanged game balances. Uncertain RPC outcomes remain pending and visible. It does not automatically replace an underpriced transaction or retry a confirmed revert with another payment. Operator nonce use must be exclusive to this coordinator after deployment.

The operator pays game transaction gas from a separate wallet, with a default 0.50-USDC maximum per transaction. This limit is a worst-case estimate, not a fee charged to players; it is separate from the 0.002-USDC game fee. Arc's minimum gas price is respected. Failed configuration, an empty operator wallet, gas above the cap or unavailable RPC pauses settlement. The chain monitor displays errors, transaction hashes, confirmation blocks, events and actual gas.

After a season finishes, request your payout:

```sh
npm run agent -- --server https://YOUR_GAME --season 1 --withdraw \
  --circle-wallet YOUR_CIRCLE_ADDRESS
```

Anyone can execute the contract's completed-season withdrawal, but the recipient is always the registered seat wallet. Final game scores are retained after withdrawal. Unspent customer funds are refunded equally, with integer remainder assigned to the final seat. After **24 hours without contract activity**, a seat owner can call `withdraw(seasonId, slot)` directly to close a stalled season and claim its funds; no live server is required. Once closed, remaining seats can withdraw too. A partially filled abandoned lobby refunds both balances. The server refreshes external exits and claimed balances when polled; the displayed check timestamp identifies freshness.

To revoke an unused approval directly with Circle:

```sh
circle wallet execute 'approve(address,uint256)' ESCROW_ADDRESS 0 \
  --contract 0x3600000000000000000000000000000000000000 \
  --address YOUR_CIRCLE_ADDRESS --chain ARC-TESTNET
```

## Operator setup and validation

`npm run arc:setup` creates private operator and payee keys in ignored files with mode 0600. Back them up privately. Fund the operator with faucet USDC, run `npm run contracts:build`, then `npm run arc:deploy`. Deployment is testnet-only, caps gas and journals signed bytes before broadcasting. Public deployment records are in `contracts/deployments/`; private files are never served or bundled. `npm start` loads `.arc.env` and selects a new contract-specific SQLite database.

The historical `npm run arc:deploy -- --sandbox` command created the current dedicated test escrow; its name does not select the identity provider. Game identity now requires AgentBook. It keeps an independent deployment journal and `arc-testnet-sandbox.json` record, so retrying reuses the same deployment rather than replacing the existing AgentBook escrow or issuing duplicate transactions. The deployment command reads the private RPC override from `.arc.env` and redacts RPC URLs from errors.

For Cloudflare, put the public contract address in `wrangler.jsonc` and install `ARC_OPERATOR_PRIVATE_KEY` with `wrangler secret put`. `.arc.env` is never uploaded. Keep the same contract and Durable Object namespace across updates. One operator must not concurrently run a local and cloud coordinator against the same escrow/season IDs.

The hosted server uses a private Alchemy Arc Testnet endpoint, configured as the `ARC_RPC_URL` Worker secret and in the ignored local `.arc.env`. Set your own endpoint there to override the public default. Do not put an API-key URL in `wrangler.jsonc`, browser assets or public agent metadata. RPC requests use bounded retries; a temporary signature-check outage returns HTTP 503 so the agent can retry. Settlement errors redact provider URLs before storage and display.

`npm test` checks engine, AgentKit API and World Sandbox behavior. `npm run test:arc` requires Foundry's `anvil`: it runs a complete season with a local six-decimal mock token, signed permits, forbidden spending/replays, lost-broadcast recovery, independent balance reconciliation, withdrawals and timeout refunds. This does not test Arc's native gas semantics.

The separate `arc-testnet-smoke` deployment uses real Arc USDC, a real Circle wallet and explicitly labeled contract-test identities. `node scripts/arc-smoke.mjs CIRCLE_ADDRESS` resumes its private test database and checks a complete season and payouts. It cannot target the public game contract. These fixtures do not establish four verified humans. Its results and receipt hashes are recorded separately from public competition.

Primary references: [ETHGlobal Arc requirements](https://ethglobal.com/events/ethonline2026/prizes/arc), [Arc connection details](https://docs.arc.io/arc/references/connect-to-arc), [USDC contracts and decimals](https://docs.arc.io/arc/references/contract-addresses), [gas and fees](https://docs.arc.io/arc/references/gas-and-fees), [Circle Agent Wallet quickstart](https://developers.circle.com/agent-stack/agent-wallets/quickstart), [Circle CLI command reference](https://developers.circle.com/agent-stack/circle-cli/command-reference), [Circle Agent Stack starter kits](https://github.com/circlefin/agent-stack-starter-kits).

## Live validation — 2026-09-13

Current testnet escrow: [0xafe55c…4005f](https://testnet.arcscan.app/address/0xafe55c6fd095848151f0e6fd4fdf70182df4005f). It was deployed fresh at the owner's request for 0.052550862 test USDC in gas. Its deployment record is `contracts/deployments/arc-testnet-sandbox.json`. The previous [AgentBook escrow](https://testnet.arcscan.app/address/0x1bf339645ed45b7662c0f0853a5fd991583f4c39) and joined participant were left untouched.

The separately deployed contract-test escrow completed **21 days, 857 purchases, 29 confirmed game transactions, and all four payouts**. Its remaining customer balance and ERC-20 escrow balance were both exactly zero. Game transaction gas totaled 0.26337654 test USDC (excluding deployment, wallet funding and approvals). The test used a real Circle smart wallet, including AgentKit EIP-1271 message verification and EIP-712 payment permissions, and three fixture wallets. The human resolver was explicitly a test fixture; these receipts do not establish verified human participation.

The recorded [3D replay](https://autobazaar.vending-arena.workers.dev/play?replay=arc-test) labels this distinction and links the actual receipts. Full evidence is in `contracts/deployments/arc-smoke-results.json`.

Runtime dependency audit: no reported vulnerabilities with `npm audit --omit=dev`. The development-only Circle CLI's unused Solana JSON/UUID dependency paths retain seven moderate advisories; targeted overrides address the reported high-severity dependencies. The full CLI is never bundled into the Worker.

The current integration retires app-specific Sandbox enrollment and uses official AgentKit/AgentBook before entry deposits. The previously empty test escrow and its wallets are retained. The dedicated operator key and private RPC remain Worker secrets. Signed Circle wallet requests have been tested independently of human registration; a four-human live competition has not been demonstrated. See [World feedback](world-feedback.md) for identity testing boundaries.
