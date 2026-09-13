# One-human hackathon demo

AutoBazaar's demo season has **one World AgentBook-backed entrant and three house agents**. House agents are explicitly configured test wallets. They sign real AgentKit requests and Arc spending authorizations, but they are not three more verified humans. The normal competition mode still requires four human-backed entrants.

The hosted demo keeps the existing `thefazi` entrant, verified identity and 1 test-USDC deposit in escrow `0xafe55c6fd095848151f0e6fd4fdf70182df4005f`. Its three remaining seats belong to Penny House (value), Nova House (premium) and Sage House (adaptive). Every seat pays 0.50 test USDC into the customer pool and 0.50 into working capital. All purchases and payouts follow the same Arc contract as other seasons.

## Manage the human agent

Use the [local agent control room](agent-dashboard.md) for private strategy instructions, decision reviews and automatic play. It resumes the existing seat without another entry deposit. Stop the human console runner before switching; leave the house agents running.

## Add rivals from the owner dashboard

After a human's deposit confirms, the local dashboard shows **Add 3 house agents**. Its signed AgentKit request is accepted only from the registered human seat in that demo season. It queues Penny, Nova and Sage with the existing value, premium and adaptive strategies. The button shows progress and offers a retry if the host reports a failure. It does not debit the human wallet again.

The host runs this supervisor once:

```sh
npm run demo:host -- --server https://autobazaar.vending-arena.workers.dev --arc-contract 0xafe55c6fd095848151f0e6fd4fdf70182df4005f
```

Keep this computer running. The supervisor serves one requested season at a time, using the same three private house wallets and the normal signed runner. Each new house entry costs 1 test USDC plus approval gas; give each wallet at least 1.10 test USDC before starting. The service never tops up wallets automatically. If funds are insufficient, replenish them and choose **Retry house agents**. Existing confirmed entries are reused without another deposit. To top up for a later season, use `npm run demo:fund -- --source-circle YOUR_SPARE_CIRCLE_TEST_WALLET --season N`; the separate receipt journal prevents repeating that season’s top-up.

Requests survive server restarts. Host claims use expiring leases and attempt numbers so another runner cannot take an active request or update a newer retry. Public status contains no keys or lease tokens. A network failure stops the local players before a supervisor attempts to recover. Stop a manually launched house runner for the same season before enabling the supervisor.

The equivalent owner command is `npm run agent -- --server GAME --season N --circle-wallet YOUR_WALLET --arc-contract ESCROW --add-house-agents`. Standalone users should refresh `agent.mjs` and the four dashboard files before restarting the local dashboard. The host's private wallet file is never a player download.

## Run the house agents manually

Private house keys are stored in ignored `.demo-wallets.json` with owner-only permissions. Keep this file to resume play or withdraw. A public wallet address alone cannot claim a house seat.

```sh
# Built-in strategies; no model usage.
npm run demo:agents -- \
  --server https://autobazaar.vending-arena.workers.dev \
  --season 1 --arc-contract 0xafe55c6fd095848151f0e6fd4fdf70182df4005f
```

Add `--codex` to replace the built-in policies with three locally authenticated Codex processes. Stop the existing house runner first with the same server/season command and `--stop`. The runner prevents duplicate local instances, so changing strategy mode does not duplicate decisions. Each agent has its own wallet, observations and private notebook. The same signed API handles both policy modes. The process runs one season and never automatically spends another entry. Keep the host computer and runner running during the demo.

The human entrant keeps its own usual runner. For the existing `thefazi` Circle wallet, resume without paying another entry:

```sh
npm run agent -- --server https://autobazaar.vending-arena.workers.dev \
  --season 1 --name thefazi --codex \
  --circle-wallet 0x291d4aedaafee3f4ade78521cc801696e1ea04aa \
  --arc-contract 0xafe55c6fd095848151f0e6fd4fdf70182df4005f
```

The three house agents were started as a local background process. Read `.runs/demo-house-agents.log` for their decisions. Stop them with `npm run demo:agents -- --server https://autobazaar.vending-arena.workers.dev --season 1 --stop` before switching to `--codex`.

 When all four deposits confirm, the season starts automatically. A missing participant's decision retains prices without buying or stocking. The browser only controls playback; it does not stop server deadlines.

After the season, use the same command with `--withdraw` to claim the three house wallets' remaining balances. Human payouts still go only to the human's registered wallet.

## Set up another demo host

1. Run `npm run demo:setup` to create or reuse the three house wallets. It prints only public addresses.
2. Configure `SEASON_MODE=demo` and `DEMO_AGENT_ADDRESSES` with those exact three addresses on the host. All other wallets still need AgentBook. Demo settlement is restricted to Arc Testnet or the local test EVM.
3. Fund each house wallet with 1.10 test USDC, covering entry and approval gas. `npm run demo:fund -- --source-circle YOUR_SPARE_CIRCLE_TEST_WALLET` transfers exactly that amount once per house wallet. It uses a persistent receipt journal and stops on an uncertain transfer rather than sending another one. The Circle source must be an already activated Arc Testnet wallet.
4. Start the house runner and your human agent. Open `/play?season=N` to watch the labeled participants and transaction monitor.

The host pays settlement gas from its operator wallet. The house runner does not receive that operator key or the World RP signing key. Its only approvals are the normal exact 1-USDC entry allowances against the pinned escrow.

## Participation safeguards

The configured mode and three wallet addresses are pinned in the database. Changing house wallets, switching funded demo history back to competition, or relabeling a running season is rejected. An entirely empty database can be configured afresh; an existing empty lobby needs `ALLOW_EMPTY_DEMO_MIGRATION=true`.

`ALLOW_SINGLE_HUMAN_DEMO_MIGRATION=true` permits the specific requested upgrade from a competition lobby with exactly one human entrant and only that entrant's confirmed join transactions. It requires one season, no pending payments, no day settlement, and no collision with the new house addresses. Existing identity, deposit, game state and receipts are preserved. Any other funded shape is rejected. Once the three house agents join, this exception no longer applies.

The UI and public API expose `mode: demo`, `participantKind: house|human`, verified/house seat counts, and `humanBacked: false` for house wallets. A hackathon demonstration should describe this as one verified human plus three house agents, not four independently verified users.

## Validation

Tests exercise real SDK signatures, forged house addresses, nonce replay, unregistered outsiders, the single-human quota including pending deposits, mode persistence, funded-migration guards, participant labels, and a complete built-in strategy season. The local EVM test runs both a four-human fixture competition and a one-human/three-house fixture demo, including conversion after the first funded entry, settlement, payouts and balance reconciliation. Fixture identity tests do not count as live World verification.

## Live setup — 2026-09-13

Release `f5636787-1edd-484d-b279-c21221c98e95` is deployed and verified at the public URL. The existing human entry was retained. All three house entry deposits confirmed on Arc; all three house agents submitted their first-day decisions. The browser visibly labels one human and three house agents. Current evidence is in [demo-season-live.json](../contracts/deployments/demo-season-live.json).

Funding came from the spare Circle test wallet, totaling 3.30 test USDC plus transfer gas, with 1 test USDC per house entering the game and the remainder covering approval gas:

- House wallet 0x18ae11cf42b3ae9ea22f959db5d6c82ae3ba5147: 1.10 test USDC funded; [receipt](https://testnet.arcscan.app/tx/0x3dd505e85f35b5e4ae4dd576c23698bae3a71e2ab7d1dd2b288ec984dad51d5c).
- House wallet 0xe7ee86c313ffd3d2673bbe2aad1c5b458a6ac3dc: 1.10 test USDC funded; [receipt](https://testnet.arcscan.app/tx/0x55ab6fb7135268d216494aa3dff8ece4835baa8aca1e97b15bdf1d23ea2ca0cb).
- House wallet 0x45443a7e4da152cff61f683983ae6b83ff313db7: 1.10 test USDC funded; [receipt](https://testnet.arcscan.app/tx/0x71f0d9c383eeccaa946bf9dcdb9544c7dcc9c9c7503fe905f959b547c88c6c6d).

58 application tests and both full local escrow integration scenarios passed.

The first day settled on Arc at block 61882631: [settlement receipt](https://testnet.arcscan.app/tx/0x704821f33c9e2875e20ef6a99f11b94a774cdbf9dcd5a5d124f04a0a69a9e777), gas 0.009259 test USDC. House agents ordered stock and paid operating fees; the human runner missed that deadline. The house agents subsequently submitted day-two decisions. No first-day customer sales occurred because stock had not arrived yet. The browser's Chain monitor shows all four confirmed deposits and this settlement.
