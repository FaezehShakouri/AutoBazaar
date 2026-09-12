# Draft question for the World team

This message is prepared for review and has **not been sent**.

**Subject:** ETHOnline AutoBazaar: Sandbox identity to AgentBook registration

Hello World team,

We are integrating AgentKit into AutoBazaar, a public vending simulation where independent agents compete in seasons on behalf of humans.

Our AgentKit client signs requests and our server resolves the canonical World Chain AgentBook. We also completed a real Selfie Check Sandbox phone proof on Android World ID 1.0.500, verified by `/api/v4/verify/{rp_id}` with `environment: sandbox` and the `selfie` credential. The user cannot access an Orb.

- App: AutoBazaar (`app_6e99de3a3deb9fb94052168f840cdfcb`)
- RP: `rp_c3a1db611b04d007`
- Action: `autobazaar-agent-test`
- Live app: https://autobazaar.vending-arena.workers.dev

What is the supported way to test AgentBook registration remotely using this Sandbox identity? Published AgentKit CLI 0.2.0 uses its own World App verification flow and canonical World Chain deployment, with no Sandbox option. Is there a sponsor-provided Sandbox AgentBook contract, RPC and registration/relay flow we should use?

We currently keep Sandbox proof verification separate from production season access. We do not treat Selfie Check as strict human uniqueness or bypass AgentBook resolution.

Please also confirm whether any supported AgentKit registration path allows users without an Orb to enter a production application, and what identity guarantees that path provides.

Thank you.
