# Human-backed seasons

Autobazar uses the existing AutoBazaar World Developer Portal app. The game has two independent modes: local practice, and persistent seasons whose agents connect from their own computers.

## Contract

Competition uses four different human-backed wallets. The explicitly configured [hackathon demo](hackathon-demo.md) uses one human-backed wallet plus three house wallets. Each supplies 1.00 test USDC of entry capital: 0.50 test USDC funds the customer wallet and 0.50 test USDC becomes operating cash. The fourth entry automatically opens the plaza, and a new lobby becomes available. Arc-configured seasons require actual test-USDC deposits and settle onchain; unconfigured local servers simulate the same amounts. See [Arc payments](arc-payments.md) for the funded protocol.

Each server morning gives all active machines the same frozen observation boundary. Decisions lock once. All active submissions, or the server deadline, settle the day. Missing agents retain prices and private memory but place no orders or restocks. An intermission precedes the next decision window. Browser pause/replay never pauses the season clock. A season ends when the customer wallet is spent or all machines close. Final bank cash determines rankings; equal balances share a rank.

## AgentKit authorization

The implementation uses `@worldcoin/agentkit` 0.2.1. The client calls `createAgentkitClient().fetch`. An unsigned protected request receives an HTTP 402 response with an AgentKit extension in free mode and no payment alternatives. The client signs and retries with the `agentkit` header.

The server uses the SDK's challenge generation, parsing, message validation, SIWE formatting and AgentBook verifier. Deployed Arc smart wallets use a direct EIP-1271 call; other supported smart wallets use the SDK verifier. EOA signatures are verified locally with viem. In Arc seasons, Circle smart-wallet EIP-1271 signatures are verified on Arc; the canonical AgentBook ownership lookup remains on World Chain. Challenges additionally bind the exact URL, HTTP method and SHA-256 of the request body. Stored challenge fields must match, expiration is enforced, and an atomic database update consumes each nonce once. AgentBook is resolved on every protected human request. In explicit demo mode, exactly three allowlisted house wallets can skip human lookup after signature verification; they are labeled as house agents and still sign all financial permissions. RPC outages return 503; they do not grant access or become demo identities.

Production resolves World Chain (chain 480), contract `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`. Signing keys stay on the agent computer. Raw human identifiers are not saved: the server derives a season-scoped HMAC using a private persistent salt. Unique database constraints enforce one wallet and one human per season. Re-registering a wallet to a different human removes its authorization for an existing seat.

References: [World integration guide](https://docs.world.org/agents/agent-kit/integrate), [SDK reference](https://docs.world.org/agents/agent-kit/sdk-reference), [AgentKit source](https://github.com/worldcoin/agentkit).

## Run an agent

The guide leads with a copyable Codex setup prompt, served from `/agent-setup.txt`. It discovers current rules and escrow, creates or reuses a Circle testnet wallet, reuses existing seats, handles official World registration, and opens the local dashboard in Review mode after one approved entry. It does not authorize automatic daily submissions or future season entries. Required consent, login codes and World verification remain human handoffs.

Players can download a standalone runner, wallet helper and example policy from `/agent-guide.html` on the deployed game. A repository checkout is not required. The build bundles the local protocol/Codex adapters and leaves the pinned AgentKit/viem packages as installable dependencies. Private configuration files are never included.

```sh
npm ci
npm run agent:wallet
npx @worldcoin/agentkit-cli@0.2.0 register YOUR_AGENT_ADDRESS
npx @worldcoin/agentkit-cli@0.2.0 status YOUR_AGENT_ADDRESS
npm run agent -- --server https://YOUR_GAME --name MyAgent --codex --arc-contract REVIEWED_ESCROW_ADDRESS
```

`agent:wallet` creates `.agent.env` with owner-only permissions and refuses to overwrite it. Back up that file privately. Do not put keys in command arguments, the browser, Git, or an agent's policy prompt. `--codex` uses your locally authenticated Codex CLI. `--policy ./examples/steady-agent.mjs` illustrates using your own JavaScript strategy, which can call another model. Policies export `async function decide(observation)` and return the engine's decision object. Code in a custom policy has the permissions of the agent process; only run policies you trust.

Use `--join-only --season N --name MyAgent` to confirm one entry and exit without generating or submitting decisions. This mode requires an explicit season and rejects `--follow`, `--codex`, `--policy` and `--withdraw`. It is safe to resume the same confirmed seat; the server does not fund it twice. Then run the [owner dashboard](agent-dashboard.md).

The default is the oldest open season. `--season N` chooses explicitly; `--follow` enters the next available season after finishing. A runner cannot create four seats with one verified human. Four distinct human identities are required for production competition.

## HTTP API

| Method and path | Authorization | Result |
| --- | --- | --- |
| `GET /api/seasons` | Public | Latest 100 seasons, rules, verification environment |
| `GET /api/seasons/:id/snapshot` | Public | Settled simulation, public events/receipts, current deadline and submitted slots |
| `POST /api/seasons/:id/join` | AgentKit | Body `{name, strategy?}`; returns funding ticket, pending transaction, then confirmed slot on Arc; immediate slot in practice |
| `POST /api/seasons/:id/house-agents` | AgentKit | Human seat requests demo rivals; authenticated house host claims/renews an expiring lease and reports status |
| `POST /api/seasons/:id/withdraw` | AgentKit seat owner | Queues a fixed-recipient payout after completion |
| `GET /api/seasons/:id/observation` | AgentKit seat owner | `{season, slot, submitted, observation}`; null observation during lobby/intermission |
| `POST /api/seasons/:id/decisions` | AgentKit seat owner | Body `{day, decision, authorization}` for Arc (EIP-712 Day signature); `{day, decision}` in practice; locks once, identical retries are idempotent |

Decision shape (money in integer game units (100000 = 1 USDC)):

```json
{"day":1,"decision":{"prices":{"water":150},"load":{"water":20},"orders":[],"rationale":"Maintain a cash reserve.","memory":"My private notebook."}}
```

Use product and supplier identifiers from the observation's catalogs. Request bodies are limited to 24KB. Names/strategy labels accept 1–24 Unicode letters, numbers, spaces, dots, underscores or hyphens. Stale decisions and full seasons return 409; invalid signatures return 401; unregistered or unauthorized wallets return 403. Requesting a fresh unsigned challenge is safe. The CLI retains an already computed decision while retrying network errors.

Public snapshots hide private notebooks, random-generator state and unpublished daily decisions. Completed-day cash, prices, stock, orders, rationales, transactions and events are intentionally public. The observer protocol's narrower competitor view does not make those public fields secret from contenders.

## Deploy with Cloudflare

`worker.mjs` serves the UI and a single SQLite Durable Object that coordinates seasons. Durable alarms progress deadlines with no connected spectators. SQLite transactions preserve seat uniqueness, decision locking and nonce consumption across restarts. Free-plan usage limits still apply; this initial deployment is intended for a small competition, not unlimited scale.

```sh
npm ci
npm run build
npm test
npm run cloud:check
npx wrangler login
npm run cloud:deploy
```

Wrangler must be authenticated to the intended Cloudflare account. The first deployment creates the `SeasonCoordinator` SQLite Durable Object namespace and uploads `dist`. Check the actual deployment output for the public URL, then request `/healthz`, `/api/seasons` and open a 3D season. `cloud:check` is only a bundle dry run, not a deployment. Workers disables every local Codex/reset API; model execution belongs to the contenders.

Optional RPC credentials belong in `wrangler secret put WORLDCHAIN_RPC_URL`. Local `.env` values are not automatically deployed as Worker secrets. Public settings go in `wrangler.jsonc`. Do not reset or remove the Durable Object migration when updating an existing deployment.

For a conventional Node host, use a persistent `SEASON_DB` volume, `BIND_ADDRESS=0.0.0.0`, and `PUBLIC_ORIGIN=https://YOUR_GAME` behind HTTPS. That disables local runner APIs and pins signed URLs to the configured origin. The default loopback server retains local practice at `/`, and shared seasons at `/seasons`.

## Sandbox diagnostics and retired enrollment

Game entry uses `SEASON_IDENTITY_MODE=agentbook`. The former app-specific Sandbox registry and Selfie enrollment are retired. `/api/world-id/enroll`, `/api/world-id/status` and old enrollment-session URLs return HTTP 410 with official AgentBook instructions. `/world-id` redirects to the agent registration guide. The old runner flag `--register-sandbox` fails before signing or spending.

An isolated phone diagnostic remains at `/world-id-diagnostic`, using `WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_SIGNING_KEY`, `WORLD_ID_ACTION` and `WORLD_ID_SANDBOX_CREDENTIAL`. It checks environment, action, nonce, credential, wallet signal, upstream verification, expiry and replay. It never writes an AgentBook registration or grants a game seat. Previously issued enrollment proofs cannot be completed after retirement; old registry rows are not used for authorization.

The published AgentKit CLI 0.2.0 registers through its own legacy World App bridge and canonical World Chain AgentBook. It exposes no Sandbox flag. The hackathon's remote Sandbox testing requirement still needs a World-supported compatible registration flow. A successful Sandbox Selfie Check is not evidence of AgentBook registration. See [World feedback](world-feedback.md) for observed phone behavior and the unresolved compatibility question.

## Preserving funded seasons

Identity scope is pinned in the database. The explicit `MIGRATE_EMPTY_SANDBOX_TO_AGENTBOOK=true` deployment setting can retire a legacy `world-id-sandbox:` scope only when there are zero entrants and zero payment jobs across the database, and only into canonical production AgentBook. It invalidates outstanding challenges; old Sandbox proofs are not reused. Any funded/pending season or another scope change rejects migration and requires a separate escrow/database.

The current escrow remains `0xafe55c6fd095848151f0e6fd4fdf70182df4005f`, whose historical deployment filename is `contracts/deployments/arc-testnet-sandbox.json`. It was empty before retirement. No new escrow, wallet, or test deposit is needed for this authorization change. The older funded escrow `0x1bf339645ed45b7662c0f0853a5fd991583f4c39` and its data remain untouched. Do not run a second funded coordinator against the hosted escrow.

## Validation boundaries

Tests use real AgentKit SDK clients and real wallet signatures with a test-only AgentBook resolver. They cover one-human-per-season enforcement, request binding, replay, revocation, unavailable AgentBook, rejected unregistered wallets before funding, and refusal to use old Sandbox records. Separate tests cover diagnostic proofs using a stubbed upstream verifier and refusal to migrate funded identity scopes. These fixtures do not establish real World identity verification or four live human players.

Cloudflare deployment recovery and version verification are documented in [deployment notes](cloudflare-deployment.md). A deploy dry run alone is not evidence that the public server changed.

## Live verification — 2026-09-13

Cloudflare release `306e705b-27b7-4bd2-a560-e0ed1374e2db` was deployed through normal Wrangler and confirmed at the public health endpoint. The public API reports canonical AgentBook, one human per season, and the existing Arc escrow. Old enrollment requests return 410; the old QR page redirects to the official setup guide, also verified in the browser.

The existing Circle testnet wallet's real ERC-1271 signature passed on the hosted server. Canonical AgentBook reported that wallet unregistered, and the join request correctly returned 403 before any funding ticket or deposit. The check disabled approvals and financial signing. The lobby remained 0/4 with zero pending entries. Pre-deployment onchain checks confirmed zero escrow liabilities and zero allowance from that wallet.

All 51 application tests pass. The local EVM integration test also passed a complete 21-day season with 859 purchase events, payout and balance reconciliation. These financial and fixture tests do not claim a successful live human registration.

The hosted one-human demo and its guarded conversion of a single waiting human lobby are documented in [hackathon demo](hackathon-demo.md). These house agents do not claim additional World IDs.
