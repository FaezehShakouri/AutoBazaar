# Customer purchases: source mapping and implementation

Sources checked 2026-09-12:

- [Vending-Bench 2](https://andonlabs.com/evals/vending-bench-2), “Where’s the ceiling?”, links to the original paper and states that version 2 retains its sales simulation.
- [Original paper §2.2.2](https://arxiv.org/html/2502.15840v1#S2.SS2.SSS2) describes the daily purchase calculation.
- [Arena](https://andonlabs.com/evals/vending-bench-arena) establishes competition at a shared location, but the page does not specify an allocation equation.

## What comes from the paper

Each product has a cached elasticity, reference price and baseline daily sales. The benchmark obtains those values from GPT-4o. Daily demand changes with percentage price deviation, weekday, month, weather, and assortment variety. Too many choices can reduce demand, with a 50% maximum penalty. Noise is added, then predicted sales are rounded and limited by inventory. The paper also reports stronger weekend sales.

## What the sources do not disclose

The inspected paper/pages do not give the cached item values, exact price-impact equation, numeric calendar/weather coefficients, weather generator, variety curve or optimum, noise distribution or scale, or multi-machine allocation formula. We did not locate official customer-simulation source code. Third-party clones were not used as authoritative substitutes.

Therefore this implementation follows the **published sequence**, not the undisclosed original numerical implementation. Its results are not comparable to official benchmark scores. `SALES_MODEL.fidelity` and `calibration.provenance` make this limitation part of each exported run.

## Local calibration, isolated in `dist/sales-model.js`

The existing six-product catalog has a frozen, hand-authored calibration with reference price in cents, negative signed elasticity, and baseline units per day. These are local estimates, **not GPT-4o output or Andon Labs values**. They are validated once when creating a game and copied into the game state. All agents use the same cache. `createGame({salesModel})` accepts a complete replacement calibration for experiments; malformed values fail before a round begins.

Our explicit mathematical interpretation is:

```text
relative price change = (price - reference price) / reference price
price multiplier = max(0, 1 + elasticity * relative price change)
expected units = baseSales * price multiplier * weekday multiplier
                 * month multiplier * weather multiplier * variety multiplier
noise = expected units * noiseFraction * uniform(-1, 1)
predicted units = max(0, round(expected units + noise))
single-machine sales = min(available inventory, predicted units)
```

The linear price equation, multiplicative expected-demand structure, uniform proportional noise and rounding convention are local interpretations. Noise defaults to ±15%. A product whose demand reaches zero cannot generate sales through noise alone.

Variety counts distinct in-stock products at the beginning of sales, after loading. Its local piecewise-linear curve adds 3% for each extra product up to six, subtracts 5 percentage points per excess product, and floors at 0.5. The maximum-reduction bound follows the paper; those slopes and the optimum are local.

Weekday indexing is Sunday-first; calendar arithmetic uses UTC to avoid host-timezone drift. Month indexing is January-first. All coefficient tables and weather probabilities are visibly labeled local in the module. The initial date, 2025-01-01, is also a local default. Weather and each product’s demand noise have separately keyed seed/date streams, so placing an extra supplier order cannot change the weather.

## Local competition extension

For each product, calculate every stocked, active machine’s standalone expected demand. The shared product pool is the largest of those expectations, perturbed by one shared noise draw and rounded. Allocate its units with probability proportional to each machine’s expected demand, excluding closed, zero-demand, and out-of-stock machines. Inventory is decremented by the allocation; unfilled demand does not transfer to a different product. Stockouts during allocation cause remaining units to be offered to eligible machines.

Every completed sale draws its actual payment from the round's shared customer wallet. Each of the four agents pays a fixed $500 registration stake into that wallet and separately receives $500 of operating cash. The registration stakes therefore create a $2,000 customer wallet without reducing the agents' starting game cash. When the remaining wallet is below the next item's listed price, that final purchase pays the exact remainder. The difference is recorded as `closingAdjustment`; this explicit game rule guarantees that an active round can finish at exactly zero cents instead of retaining unspendable change. If all agents close first, the round ends with the residual wallet reported.

This keeps machines competing and prevents multiplying market demand by the number of machines. It is **our Arena extension**, not an equation published by Andon Labs. With just one active stocked machine it reduces to the paper-shaped single-machine pipeline. There is no visitor count, per-visitor drink/snack draw, fixed outside option, or customer identity model.

The spectator UI and JSON export include the day situation, traffic and seasonal multipliers, expected demand, noise, wanted/bought/unserved counts, available stock, per-machine factors and allocations, and individual purchase receipts with the wallet balance after each purchase. The event log records agent decisions, price changes, restocking, orders, deliveries, fees, sales, customer outcomes, warnings and closures. Agents receive their own sales history, the date/weather situation, and public competitor prices; they do not receive opponents’ hidden state or the simulator’s product calibration.

## 3D customer visualization

The Three.js plaza adds a visual layer over this same sales model. Each daily receipt schedules one character to approach its assigned machine, collect the purchased product, and exit the plaza. Customers have decorative names, outfits, and walking animations. Rainy weather gives them umbrellas and changes the scene's sky, lighting, and puddles. These visual choices do not feed into demand or add a separate customer identity model. Lobby passersby do not buy anything.

The engine settles the entire day first; `dist/playback.js` then emits its recorded receipts in order against a separate visual clock. A purchase occurs four visual seconds after its character enters, with visits staggered by 0.48 seconds. Visible machine stock and the displayed wallet follow those receipts. Financial reports and machine inspectors always show the completed day. Pause, speed changes, skip, and replay affect the presentation only: they never spend money again, alter orders, or call agents again. The next automatic market day waits until playback finishes.

Click a character to inspect its matching receipt, and click a machine to inspect the agent. The monitor retains the full ledger and log, including events that are not separately animated. NPC movement is an illustration of settled purchases, not a new simulation of individual preferences or an additional benchmark claim.

## Other scope boundaries

We removed the fabricated festival/closure schedule and automatic 1.2% refunds. Vending-Bench 2 describes customer complaints, but provides no numerical rate; an interactive complaint/refund system is not implemented here. Sales revenue still settles immediately into bank cash. The published cash-collection and delayed-card-settlement mechanics remain outside this customer-demand change. Supplier procurement, fees and existing machine capacities also remain local game rules.

State schema version is now 4. Start a fresh round rather than combining historical sales from older rules. Old exports are not overwritten or migrated.
