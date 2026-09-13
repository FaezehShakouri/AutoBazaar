# World / AutoBazaar integration feedback

Working notes for [ETHOnline 2026 AgentKit Continuity](https://ethglobal.com/events/ethonline2026/prizes/world), updated 2026-09-13. This document distinguishes observed results from tests still pending.

## What we built

Human-backed agents independently enter four-player vending seasons. AgentKit signatures and AgentBook resolution protect entry and each daily action. One human gets one seat per season, with persistent authorization, private agent memory and a public 3D spectator view. The server never substitutes a demo identity on verification failure. Funded seasons settle test USDC on Arc Testnet; local practice simulates balances.

## AgentKit documentation and flow

- The maintained integration guide correctly points to World Chain as the canonical AgentBook. Its low-level SDK exports let a plain Node Fetch API/Cloudflare Durable Object application use AgentKit without adopting Hono or charging a real payment.
- The repository's `cli/REGISTRATION.md` still documents Base defaults and `--network` switches, while published CLI 0.2.0 hard-codes World Chain and does not offer those switches. Its internal version string is also still 0.1.0. The npm package source was inspected to avoid registering on the wrong deployment.
- The CLI's World ID request uses `createWorldBridgeStore` and a fixed app/action. There is no Sandbox flag. The hackathon asks for remote Sandbox testing; a documented compatible AgentBook deployment/registration example is missing from the material we found. We need World to clarify the supported path. Production lookup and Sandbox proof tests remain separate.
- The SDK maps AgentBook RPC read failures to an unregistered result. We preserve an outage as HTTP 503 so players know to retry.
- Default message validation binds the URI host. Our game also binds the exact path/query, method and body digest, and stores challenge fields plus an atomic one-use nonce. A game-specific example for persistent challenges would help.

## Developer Portal

- Signed in successfully and created the **AutoBazaar** app. Registered a locally generated RP signer by submitting only its public address. The private key remains in an ignored owner-readable backend configuration file.
- Mobile-width navigation hides product sections behind the sidebar; the portal uses “Dashboard” for action management and “World ID Configuration” for signer configuration. A clearer link from AgentKit setup to the required product/environment would reduce uncertainty.
- Portal Sandbox access offers iOS TestFlight and Android Google Play. The existing invitation found in the user's Gmail was instead Android Firebase App Distribution (`org.world.id.sandbox`). The user installed the Android app and reported reaching the account/home screen. The relationship between the Firebase invitation and the current Google Play instructions should be documented.

## Sandbox app and proof flow

- Observed: Android invitation exists; user reports installation and completed initial setup. The user confirmed build **1.0.500**, with the latest request showing success on the phone.
- Implemented: a signed Sandbox request, wallet/session-bound QR handoff, proof verification through World's production `/api/v4/verify/{rp_id}` endpoint, environment isolation, expiration/replay handling, and visible failure/retry states.
- Verified: a real Android 1.0.500 Selfie Check Sandbox proof completed on the local application, passed the wallet/session checks, and was accepted by World's verify API for the configured RP, action, `sandbox` environment and `selfie` credential. The local database recorded exactly one completed Selfie Check. No Orb was needed. Pending: cancellation/timeout behavior on the device, duplicate identity checks with live proofs, and a Sandbox-compatible AgentBook registration.
- Documentation drift: the Sandbox guide explicitly says `environment: sandbox`; some general IDKit/API examples still list only `production` and `staging`. Installed IDKit 4.2.4 does support `sandbox`.
- The subsequent supported Proof of Human request asked the user to find an Orb. The user has no Orb nearby. This request is unsuitable for their remote test, even in Sandbox. The separate [Selfie Check Sandbox guide](https://docs.world.org/world-id/sandbox/testing-selfie-check) tests a different credential; it is not an AgentBook registration path.
- Implemented a separately labeled, server-selected Selfie Check Sandbox mode using `selfieCheckLegacy`. It pins the requested credential per session and never treats Selfie Check as production Proof of Human or grants a season seat. Initial deployment review required evidence of World access. The successful loopback phone test supplied that evidence, after which deployment was authorized. The live phone result establishes working Selfie Check access for this app in Sandbox; it does not establish production access or strict human uniqueness.

## Earlier verification evidence (before AgentBook-only cleanup)

- All 45 automated game, AgentKit season and Sandbox verification tests passed locally, including legacy Orb compatibility, explicit Selfie Check sessions, rejection of other credentials, and migration of pre-existing requests. Identity registries and the upstream proof verifier are test fixtures in this suite. Syntax checks passed for 36 JavaScript files.
- Cloudflare bundle dry run succeeded. The actual local Workers runtime initialized the durable SQLite schema, returned the open lobby, emitted a real AgentKit challenge and rejected local Codex endpoints.
- AutoBazaar is deployed at https://autobazaar.vending-arena.workers.dev with its RP signer stored as a Worker secret. Public health, seasons, Sandbox configuration and static routes respond successfully; private `.env` and local reset routes return 404. Real AgentBook registration and a four-human live season remain pending.
- Deployed the tested Selfie Check Sandbox mode as Worker version `0abceb53-8d2c-4896-9d7a-18d1f040db93`. The real successful phone proof was verified against the local backend; the deployed public configuration and routes are checked separately. No public phone-proof completion is claimed yet.
- Browser test reached a real IDKit Sandbox bridge URL and QR request. The first attempt exposed a missing WebAssembly asset after bundling; the build now copies the SDK WASM alongside the browser module and the server sends `application/wasm`.
- First phone round trip returned `malformed_request`; no proof was accepted. A later request completed on Android and returned a legacy result, even with explicit constraints and the request's legacy flag false. Our initial v4-only guard rejected it before upstream verification. World's [credential documentation](https://docs.world.org/world-id/idkit/credentials) explicitly includes legacy Orb fallback in `proofOfHuman`, and the [verify API](https://docs.world.org/api-reference/developer-portal/verify) accepts v3 and v4. The implementation supports the matching credential without remapping identifiers. A separate diagnostic using `selfieCheckLegacy` completed that phone-to-verifier round trip. No raw proof was logged or persisted.
- A read-only call to the real canonical World Chain AgentBook succeeded and returned unregistered for the newly created test wallet. No production registration or game entry was made.

## Questions for World

1. What is the supported AgentBook registration path for the new Android World ID Sandbox app, given CLI 0.2.0's legacy World App bridge?
2. Is there a sponsor-provided Sandbox AgentBook contract/RPC/relay, or should teams deploy a v4-compatible test registry themselves?
3. Which remote-test credentials should be available to a fresh Sandbox account without Selfie Check access or an Orb?

These questions have not been sent externally. No support messages were submitted on the user's behalf.

## AgentBook-only game registration — 2026-09-13

The app-specific Sandbox enrollment registry was an incorrect substitute for the requested AgentKit integration. It is retired. Game authorization now always uses the official SDK and AgentBook resolver. Onboarding uses `npx @worldcoin/agentkit-cli@0.2.0 register ADDRESS`; old Selfie enrollment routes return 410 and old QR links redirect to that guide. Diagnostics cannot grant seats, issue funding permits, or replace a missing AgentBook human. Signed Circle wallet authorization remains on Arc, separately from World Chain identity resolution.

The user reports Android Developer Settings sections for Verification, Face Auth, Proofs and World ID. No specific test-human credential action was confirmed. A supported Sandbox-to-AgentBook registration remains unverified; neither a Selfie diagnostic nor the onchain financial replay satisfies that missing evidence. The published CLI and documentation were checked again on 2026-09-13. No compatible Sandbox flag or canonical Sandbox AgentBook registration was found.

Release `306e705b-27b7-4bd2-a560-e0ed1374e2db` was verified live with a real Circle wallet signature: Arc ERC-1271 succeeded and canonical AgentBook rejected the unregistered wallet with HTTP 403. No entry deposit or financial signature was made. All 51 application tests and the full local EVM integration test pass after cleanup. Old enrollment links were checked in the browser and now open the AgentKit guide.

## One-human demo extension

The owner has one World ID, so the hackathon demo now supports one verified human entrant plus three explicitly labeled house wallets. House requests still use real AgentKit signatures, but only the human seat claims AgentBook backing. The wallet allowlist is configured by the operator, has exactly three entries, is pinned once funded, and cannot be claimed by an arbitrary caller. All four wallets pay real test-USDC deposits and sign their Arc permissions. Built-in policies can be replaced with three local Codex runners. This demonstration does not claim four separate World IDs.
