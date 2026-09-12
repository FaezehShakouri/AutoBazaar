# Vending Arena

A spectator-first simulation game: four independent agents each run a vending machine in a shared customer market. Watch the season, inspect business decisions and notebooks, and compare final bank balances.

Inspired by [Andon Labs Vending-Bench 2 and Arena](https://andonlabs.com/evals/vending-bench-2). This is an independent implementation, not a reproduction of their benchmark or published scores.

## Run

Requires Node.js 20 or newer. No npm dependencies or installation required.

```sh
npm start
# Open http://127.0.0.1:3000
```

The default browser mode uses four explicitly labeled built-in policies. Select **Codex agents** at the bottom of the local interface to start a new season with real model decisions. Click **Next day** to run a single decision round, or **Run season** to continue. Pausing stops before the next round; an in-flight round completes first. Each active agent makes one Codex call per day, so a full year may use up to 1,460 calls. Real inference usage belongs to your configured Codex account and is not deducted from simulated cash.

## Codex harness

Install and authenticate the [official Codex CLI](https://developers.openai.com/codex/cli/) before using model mode. Integration follows [non-interactive Codex execution](https://developers.openai.com/codex/noninteractive/) with a JSON output schema. The runner uses `codex exec` directly; it does not require an API key in the browser.

```sh
codex login
# Optional: choose a model available to your account
CODEX_MODEL=your-model-id npm start
# Optional: point to a specific binary
CODEX_BIN=/absolute/path/to/codex npm start
```

Each agent receives its own balance, stock, arrivals, previous product sales, recent events, persistent private notebook, supplier catalog, and public competitor prices. It returns prices, stock-loading quantities, purchase orders, a public rationale, and updated private notes. Starting briefs are hypotheses, not fixed strategies: Codex may revise them. All agents decide from the same morning snapshot before any decision is applied.

Daily executions are ephemeral, in a fresh temporary directory with a read-only sandbox and shell tool disabled; the notebook is explicitly carried forward. User configuration is ignored to avoid inheriting unrelated MCP tools, while Codex authentication still uses its normal location. `CODEX_MODEL` selects a model; otherwise the CLI default applies. This is an application-level game boundary, not a hardened sandbox for hostile code. No actual supplier contacts or financial transactions occur.

Decisions have a two-minute timeout. Provider or JSON failures leave the entire day uncommitted; errors are visible, with no silent switch to built-in policies. A retry calls all agents again. The local server binds to loopback, rejects foreign origins and unrecognized Host headers, and never serves private run files. The runner supports one authoritative Codex season per process; browser demo seasons are independent.

## Experiments

```sh
npm run simulate -- --mode demo --seed 42 --days 365
npm run simulate -- --mode codex --seed 42 --days 30
npm test
npm run check
```

CLI runs save their state to `.runs/<mode>-<seed>.json` after each day. The server writes `.runs/latest.json` atomically after each completed Codex round. **Export season JSON** downloads the current browser-visible state and full event log. Browser refresh starts a fresh demo; automatic resume/import is not implemented. Saved files remain available for analysis. Repeating a seed reproduces market outcomes for identical decisions; model decisions themselves are not deterministic.

## Simulation rules

- $500 starting cash per agent, empty machine and storage, up to 365 days. Highest final bank cash wins; unsold stock is not liquidated.
- Six products, 30 units per product in the machine, maximum 240 held/in-transit units per product.
- Three suppliers trade off price, delivery time and delay risk. Orders of 24+ units earn an 8% unit-price discount.
- Orders debit cash immediately. Deliveries enter storage on arrival mornings. Agents must explicitly load inventory before it can sell.
- All prices and ledgers use integer USD cents. Sales settle automatically that day. Refunds remove revenue from cash but do not restore consumed stock.
- A shared population of visitors chooses a product, then one available machine using price-sensitive weighted choice with an outside option. At most one sale per visitor.
- Weather, weekly patterns and scheduled market events affect traffic or drink demand. Randomness uses a seeded PRNG.
- Daily operating rent is $2. Missed rent accumulates as arrears; ten consecutive unpaid days close a machine. Outstanding arrears plus the current fee must be paid to reset the counter.

This first slice simplifies the original benchmark: fixed supplier/product catalogs, automatic cash collection, bulk discounts instead of conversation-based negotiation, no adversarial supplier agents, no inter-agent trade, no inventory spoilage, no model-cost scoring. Codex determines the business actions; the engine alone determines customer purchases and financial state.

## Layout

- `dist/engine.js`: pure shared simulation, observation boundaries, decision validation, and built-in policies.
- `dist/app.js`, `dist/style.css`, `dist/index.html`: browser spectator interface, no framework required.
- `lib/codex.mjs`: schema, prompts, and local Codex subprocess adapter.
- `server.mjs`: loopback HTTP API, atomic decision rounds and snapshots.
- `scripts/simulate.mjs`: headless demo/Codex season runner.
- `tests/`: accounting, reproducibility, inventory, privacy, bankruptcy, demand and API tests.

The privately hosted Sites version serves the browser demo only. Codex requires the local Node process; it cannot execute inside a static hosted page. Optional WebMCP tools expose read-only state and paused demo advancement when the browser supports them.
