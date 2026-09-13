# Cloudflare serving recovery

On 2026-09-13, Cloudflare's deployment API reported the latest AutoBazaar Worker version at 100%, and downloading the Worker returned the new code. The public workers.dev URL still served the previous code, including the outer `/healthz` handler. Requests with fresh query strings and no-cache headers reproduced the mismatch. Repeating version deployment and toggling the workers.dev route did not resolve it.

## Verified recovery

The [direct Worker script-upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) recovered serving. This uses `PUT /accounts/{account_id}/workers/scripts/autobazaar`, rather than Wrangler 4.131.1's version-upload followed by deployment path for this existing Worker. The root cause inside Cloudflare remains unconfirmed.

1. Run `npm run cloud:check` to produce the checked bundle in `.worker-build/worker.js`.
2. Read the existing Worker settings with an authenticated Cloudflare API request. Check its expected Durable Object namespace and required bindings before any update.
3. Upload a multipart body containing `worker.js` with MIME type `application/javascript+module` and JSON `metadata`. Preserve the compatibility date and flags. Set `main_module: "worker.js"`, `keep_assets: true`, and inherit each existing binding using `{name, type: "inherit"}`. Specify only deliberate variable changes explicitly. This retains existing credentials without downloading or re-uploading their values. Do not remove or recreate the Worker or its Durable Object namespace.
4. Verify the API-reported active version against the **public** `/healthz` response. Also request `/api/seasons`, `/api/world-id/config`, and the frontend. An accepted upload alone does not establish that the release is serving.

The successful recovery version was `ea69d704-06bb-4b35-a399-ac908ff24da3`, verified live at 08:47 UTC. Its health response was:

```json
{
  "ok": true,
  "seasons": true,
  "identityMode": "agentbook",
  "version": "ea69d704-06bb-4b35-a399-ac908ff24da3"
}
```

The existing participant, 1 test USDC deposit, Arc escrow address, Durable Object namespace, three secrets, and static assets were preserved during recovery. The owner subsequently requested a fresh Sandbox game. A second direct upload activated `eb4ca5a3-2ac7-4119-90b8-ba1d9ec130e1` with `identityMode: "world-id-sandbox"` and dedicated escrow `0xafe55c6fd095848151f0e6fd4fdf70182df4005f`. Its contract-derived Durable Object ID selects an empty database. The old escrow and data remain intact; they were not converted into Sandbox identities.

Normal `npm run cloud:deploy` subsequently worked again: follow-up version `1c19021c-7332-459e-b9b7-ea9d0a827f36` and its updated `/agent.mjs` were both verified on the public URL. The direct-upload procedure is a recovery option if the mismatch recurs, not a demonstrated permanent requirement.

## Preview URLs

AutoBazaar implements a Durable Object. Cloudflare [does not generate version preview URLs for such Workers](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/#limitations), even when the subdomain settings show previews enabled. A preview 404 therefore does not demonstrate a broken deployment. Use the public health endpoint, or deploy a separate test environment with isolated storage and escrow.

## Current AgentKit release

On 2026-09-13, normal Wrangler deployed `306e705b-27b7-4bd2-a560-e0ed1374e2db` successfully. Public health confirmed that version and `identityMode: agentbook`. The empty app-specific Sandbox scope was retired with an explicit empty-only migration; the current escrow, Durable Object, wallet and secrets were retained. Live checks confirmed canonical AgentBook metadata, HTTP 410 for retired enrollment, the guide redirect, and no new entrant or payment after an unregistered Circle wallet's signed request.

The one-human hackathon demo is live in release `f5636787-1edd-484d-b279-c21221c98e95`. It preserved the sole verified waiting entrant and its deposit, added three explicitly configured house wallets, and settled its first day on Arc. See [demo setup and live evidence](hackathon-demo.md).
