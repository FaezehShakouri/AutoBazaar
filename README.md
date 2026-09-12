# Vending Arena

A spectator-first simulation game: four independent agents register for a round, run vending machines in a shared customer market, and compete to capture a finite customer wallet.

Inspired by [Andon Labs Vending-Bench 2 and Arena](https://andonlabs.com/evals/vending-bench-2). This is an independent implementation, not a reproduction of their benchmark or published scores.

## Run

Requires Node.js 20 or newer. No npm dependencies or installation required.

```sh
npm start
# Open http://127.0.0.1:3000
```

The default browser mode uses four explicitly labeled built-in policies. In the lobby, each of the four agents provides $1,000: a fixed $500 registration stake is transferred into the shared customer wallet, and a separate $500 becomes that agent's operating cash. The market opens after all four register. Select **Codex agents** before registration to play with real model decisions. Click **Next day** for one market day or **Run round** to continue. Pausing stops before the next day; an in-flight decision completes first. Each active agent makes one Codex call per day. Real inference usage belongs to your configured Codex account and is not deducted from simulated cash.

## Codex harness

Install and authenticate the [official Codex CLI](https://developers.openai.com/codex/cli/) before using model mode. Integration follows [non-interactive Codex execution](https://developers.openai.com/codex/noninteractive/) with a JSON output schema. The runner uses `codex exec` directly; it does not require an API key in the browser.

The runner finds Codex on PATH, alongside Node, in common CLI installations, or bundled with the Codex app, Cursor or VS Code extension. This also works when a GUI-launched server has a minimal PATH. `CODEX_BIN` overrides discovery; relative paths resolve from the server's working directory. Restart the server after updating the runner or changing this setting.

```sh
codex login
# Optional: choose a model available to your account
CODEX_MODEL=your-model-id npm start
# Optional: point to a specific binary
CODEX_BIN=/absolute/path/to/codex npm start
```

Each agent receives its own balance, stock, arrivals, previous product sales, recent events, persistent private notebook, supplier catalog, and public competitor prices. It returns prices, stock-loading quantities, purchase orders, a public rationale, and updated private notes. Starting briefs are hypotheses, not fixed strategies: Codex may revise them. All agents decide from the same morning snapshot before any decision is applied.

Daily executions are ephemeral, in a fresh temporary directory with a read-only sandbox and shell tool disabled; the notebook is explicitly carried forward. User configuration is ignored to avoid inheriting unrelated MCP tools, while Codex authentication still uses its normal location. `CODEX_MODEL` selects a model; otherwise the CLI default applies. This is an application-level game boundary, not a hardened sandbox for hostile code. No actual supplier contacts or financial transactions occur.

Decisions have a two-minute timeout. Provider or JSON failures leave the entire day uncommitted; errors are visible, with no silent switch to built-in policies. A retry calls all agents again. The local server binds to loopback, rejects foreign origins and unrecognized Host headers, and never serves private run files. The runner supports one authoritative Codex round per process; browser demo rounds are independent.

## Experiments

```sh
npm run simulate -- --mode demo --seed 42 --stake 500 --cash 500 --max-days 1000 --start-date 2025-01-01
npm run simulate -- --mode codex --seed 42 --stake 500 --cash 500 --max-days 1000 --start-date 2025-01-01
npm test
npm run check
```

CLI runs save their state to `.runs/<mode>-<seed>.json` after each day. `--max-days` is a runner safety limit, not a normal round-ending rule. The server writes `.runs/latest.json` atomically after each completed Codex day. **Export round JSON** downloads the current browser-visible state and full event log. Browser refresh starts a fresh lobby; automatic resume/import is not implemented. Repeating a seed reproduces market outcomes for identical decisions; model decisions themselves are not deterministic.

## Simulation rules

- A round has exactly four agent slots. Each pays a fixed $500 registration stake into the customer wallet and separately starts with $500 of operating cash. Four registrations therefore fund a $2,000 customer wallet and $2,000 of total agent working capital.
- The round ends when purchases drain the customer wallet to exactly zero. If the wallet contains less than the final item's listed price, the closing customer pays the exact remainder and the adjustment is logged. A round can also end if every machine closes. Highest final bank cash wins; unsold stock is not liquidated.
- Six products, 30 units per product in the machine, maximum 240 held/in-transit units per product.
- Three suppliers trade off price, delivery time and delay risk. Orders of 24+ units earn an 8% unit-price discount.
- Orders debit cash immediately. Deliveries enter storage on arrival mornings. Agents must explicitly load inventory before it can sell.
- All prices and ledgers use integer USD cents. Sales settle automatically that day (a local simplification of the original cash/card settlement). Automatic random refunds have been removed: the publication does not specify a fixed refund rate.
- Sales are predicted daily per product following the published price-elasticity, baseline-demand, calendar/weather, variety, noise, rounding and stock-cap pipeline. See [customer model and source mapping](docs/customer-model.md).
- The spectator control room exposes the day's weather and traffic situation, demand factors, wanted/bought/unserved counts, machine allocations, individual purchase receipts, pricing, restocking, orders, deliveries, fees, warnings, closures and agent rationales. JSON export contains the complete state and event history.
- Actual UTC calendar dates drive weekday and month multipliers. The default start is 2025-01-01 (a local choice); set it in the lobby or use `--start-date YYYY-MM-DD` in the CLI. Weather/noise streams are independent of supplier orders. No invented festival/closure schedule or visitor population remains.
- Daily operating rent is $2. Missed rent accumulates as arrears; ten consecutive unpaid days close a machine. Outstanding arrears plus the current fee must be paid to reset the counter.

The published model does not include numeric coefficients, cached product triples, noise distribution, exact variety function or Arena allocation equations. These remain explicitly labeled local assumptions in `dist/sales-model.js`, snapshotted into every run. It is not an exact benchmark reproduction. Other simplifications remain: fixed supplier/product catalogs, automatic cash collection, bulk discounts instead of conversation-based negotiation, no adversarial supplier agents, no inter-agent trade, no inventory spoilage, no model-cost scoring. Codex determines the business actions; the engine alone determines customer purchases and financial state.

## Layout

- `dist/engine.js`: pure shared simulation, observation boundaries, decision validation, and built-in policies.
- `dist/sales-model.js`: source-linked demand pipeline, versioned local calibration, calendar and competition allocation.
- `dist/app.js`, `dist/style.css`, `dist/game.css`, `dist/index.html`: browser spectator interface, no framework required.
- `lib/codex.mjs`: schema, prompts, and local Codex subprocess adapter.
- `server.mjs`: loopback HTTP API, atomic decision rounds and snapshots.
- `scripts/simulate.mjs`: headless demo/Codex round runner.
- `tests/`: accounting, reproducibility, inventory, privacy, bankruptcy, demand and API tests.

The privately hosted Sites version serves the browser demo only. Codex requires the local Node process; it cannot execute inside a static hosted page. Optional WebMCP tools expose read-only state and paused demo advancement when the browser supports them.
