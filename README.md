# PANDA Agent Framework

PANDA is an open-source TypeScript intelligence runtime for building
goal-directed agents and automation. Its five independently selectable
capabilities are **Perception, Analysis, Network, Decision, and Action**. A
coordinator routes between them dynamically, policy gates transitions and
effects, and an append-only causal trace records what the system observed,
inferred, decided, authorized, executed, and verified.

An LLM may implement reasoning inside a capability, but it is neither required
nor the orchestrator. The frozen v0.1 release demonstrated the architecture with
one deterministic, policy-bounded filesystem action whose effect is
independently observed before the Goal can succeed. The current post-v0.1 daemon
also retains canonical local state across restart and handles interrupted work
without blindly replaying Action. It can bind API work to an authenticated
service principal and refuses unauthenticated non-loopback exposure.

- Static project homepage: [`index.html`](./index.html)
- Documentation index: [`docs/README.md`](./docs/README.md)
- Developer onboarding: [`docs/developer-onboarding.md`](./docs/developer-onboarding.md)
- Framework requirements: [`docs/requirements.md`](./docs/requirements.md)
- Guiding principles and KPI scorecard:
  [`docs/guiding-principles-kpis.md`](./docs/guiding-principles-kpis.md)
- v0.1 release profile: [`docs/v0.1-release-profile.md`](./docs/v0.1-release-profile.md)
- Current implementation progress: [`docs/progress.md`](./docs/progress.md)

## The five capabilities

- **Perception** accepts and validates signals and observes environmental facts.
- **Analysis** derives assessments, interprets context, and evaluates evidence.
- **Network** exchanges information with external people, agents, and systems.
- **Decision** selects and explains an authorized next step or action candidate.
- **Action** performs approved effects through responsibility-specific connectors.

These are responsibilities, not stages in a fixed loop. Any capability can
request any policy-permitted capability, itself, a wait, or termination.
Memory is persistence used by capabilities; planning, understanding, and
reflection are techniques used inside capabilities rather than additional
runtime states.

```text
signal
  -> Goal + Execution
  -> capability-selected NextStep
  -> transition policy
  -> Decision + effect policy
  -> Action connector
  -> independent Perception
  -> Analysis verifies Goal criteria
  -> terminal Execution + causal trace
```

## Design goals

The [Guiding Principles and KPI Scorecard](./docs/guiding-principles-kpis.md)
turns PANDA's intended operating character into measurable, evidence-backed
review criteria. The architectural design goals below remain its foundation.

- **Modular:** capability implementations, stores, policies, and connectors are
  replaceable behind typed boundaries.
- **Observable and explainable:** material decisions and effects retain identity,
  provenance, correlation, causation, and ordered trace records.
- **Non-linear:** routing comes from capability results and policy rather than a
  predetermined sequence.
- **Safe by construction:** effects cross an explicit policy and connector
  boundary and are not considered verified merely because dispatch succeeded.
- **Model-agnostic and local-first:** rules, people, optimizers, state machines,
  planners, ML models, or LLMs can implement capabilities without requiring a
  broker or cloud service.

## Repository

```text
panda/
  apps/
    cli/
    daemon/
    dashboard/
  packages/
    core/
    sdk/
    shared/
  examples/
  docs/
  scripts/
```

- `apps/daemon` owns the canonical coordinator, durable local stores, policy,
  connector, observer, HTTP API, and WebSocket trace stream.
- `apps/dashboard` displays canonical executions, Goals, source-linked operator
  answers, and sequence-stable causal traces.
- `apps/cli` provides local initialization, development, health, and version
  commands.
- `packages/shared` defines canonical records, contracts, IDs, timestamps, and
  logging utilities.
- `packages/core` implements stores, dynamic coordination, deterministic v0.1
  capabilities, policy gates, the filesystem Action connector, and independent
  effect observation.
- `packages/sdk` provides a typed client for execution and trace endpoints.

## Quick start

Prerequisites: Node.js 20 or newer and pnpm 9.15.1.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm dev
```

The daemon listens at `http://127.0.0.1:4317` and the dashboard at
`http://127.0.0.1:5173` by default.

The dashboard's Flow Records workspace is available at
`http://127.0.0.1:5173/#/flow-records`. Its CRUD API is implemented by the
existing Fastify daemon and stored in SQLite, so records survive browser
storage clearing and server restarts. On first load, the page imports records
from the legacy `panda.flow-records.v1` browser-storage key into SQLite.

Create and independently verify a sandboxed file:

```bash
curl --request POST \
  --header 'content-type: application/json' \
  --data '{"payload":{"path":"proof.txt","content":"PANDA v0.1 completed"}}' \
  http://127.0.0.1:4317/executions
```

The response includes the execution ID and status, canonical Execution and
Goal, real Outcome, verification Assessment, and trace URL. Durable local state
is available through:

- `GET /health`
- `POST /executions`
- `GET /executions`
- `GET /executions/:id`
- `GET /executions/:id/trace`
- `GET /flow-records`
- `POST /flow-records`
- `GET /flow-records/:id`
- `PUT /flow-records/:id`
- `DELETE /flow-records/:id`
- `WS /events`

Without `PANDA_API_TOKEN`, the server runs only as the explicit `panda-local`
principal and must remain on loopback. The process refuses a non-loopback
listener in that mode. Browser access is limited to the local dashboard origins
by default.

Enable single-principal bearer mode with a secret of at least 32 characters:

```bash
export PANDA_API_TOKEN="replace-with-a-secret-of-at-least-32-characters"
export PANDA_API_PRINCIPAL_ID="local-operator"
pnpm dev
```

Then add `Authorization: Bearer $PANDA_API_TOKEN` to execution HTTP requests and
the `/events` WebSocket upgrade. `/health` stays public and reports
authentication mode `none` or `bearer`; it never returns the token or principal.
Set `PANDA_ALLOWED_ORIGINS` to a comma-separated exact origin list when a browser
client uses different origins. The included dashboard does not yet provide an
authenticated-mode sign-in or token entry.

By default, canonical Execution/trace and Goal snapshots are stored below
`.panda/state`, Flow Records are stored in `.panda/panda.sqlite`, and effect
workspaces remain below `.panda/runs`. Completed and waiting work survives a
daemon restart. Active work with a terminal Goal is finalized to that outcome;
other work interrupted while `pending` or `running` is failed explicitly with
`PROCESS_RESTART_INTERRUPTED`. Neither path replays Action. Set
`PANDA_PERSISTENCE=memory` only when ephemeral execution state is intentional;
Flow Records remain SQLite-backed.

## Browser companion

The bundled [PANDA Reply Assistant](./apps/reply-extension/README.md) adds X
reply drafting, persistent follower consultations, duplicate reply protection,
X/Instagram browse recording with JSON/HTML exports, and keyword highlights.
Open `http://127.0.0.1:5173/#/browser-companion` for setup and feature details.
Load `apps/reply-extension` as an unpacked extension in Chrome, then click its
PANDA toolbar icon on X. Browser features run in the extension side panel.

Optional **save draft to PANDA Flow records** writes source context and the
prepared reply through the existing daemon `/flow-records` API. View these
records at `#/flow-records`. Set the companion's PANDA bearer token when daemon
authentication is enabled. Draft records do not claim a reply was published.
The companion's OpenAI calls and browser automation are separate from the
core coordinator; the core runtime's supported effects remain unchanged.

Run companion checks with `pnpm --filter @panda/reply-extension test`.

## SDK example

```ts
import { PandaClient } from "@panda/sdk";

const client = new PandaClient({ apiToken: process.env.PANDA_API_TOKEN });
const execution = await client.createExecution({
  source: "example",
  payload: {
    path: "proof.txt",
    content: "PANDA v0.1 completed",
  },
});

const trace = await client.getExecutionTrace(execution.executionId);
console.log(execution.status, trace.length);
```

See [`examples/basic-run.ts`](./examples/basic-run.ts) for the executable form.

## CLI

```bash
pnpm --filter @panda/cli panda init
pnpm --filter @panda/cli panda dev
pnpm --filter @panda/cli panda daemon
pnpm --filter @panda/cli panda dashboard
pnpm --filter @panda/cli panda doctor
pnpm --filter @panda/cli panda version
```

## Current limits

The file adapter is a single-process local store, not a database, broker,
multi-writer service, backup system, or exactly-once effect mechanism. It does
not automatically resume waits or active work. The bounded filesystem action is
the only supported real effect. Authentication is one static bearer principal,
not TLS, browser login, roles/scopes, credential lifecycle, or multi-tenant
authorization. Durable scheduling/retries, general planning, LLM integration,
distributed execution, multiple agents, plugins, MCP, and cloud deployment are
not implemented.

<!-- donations:start -->
## Donations

Donation seed phrases are generated locally by running:

```bash
npm run generate:wallets
```

The generated recovery phrases are saved in `generated_wallets/`, which is
ignored by git. Only public donation addresses are listed here.

| Chain | Address |
| --- | --- |
| Bitcoin | `bc1qtlywhsj3rvmvrz9zuh2l3czncd7mwpmtknjd83` |
| Ethereum / EVM | `0x88C8183cDDAA5e848Ec222F42771Ba055e9f9fb7` |
| Solana | `Ab8qd9GriUraYdMfpYSbUtfXoqiNSqdA5xrBM9rn7Tku` |
| Litecoin | `ltc1qt7gyfk6tam5zvd6pej9qcat2ep80w3xykue8y7` |
| Dogecoin | `DRKDnV536QVdYUAeCnFewWjfztUkFEwcNr` |
| Tron | `THiYW7Fh1CtpbTwixcDNYR6B1Si6761Uoy` |
| XRP Ledger | `rKS5gBGerGRvFEoBWhUcD2fazLYnBcqgWK` |
| Cosmos | `cosmos10mdk53s6e377pmd7frcrd5t52qndhpuc5f0zfn` |
| Polkadot | `14RJwVeSWmW3a5Rk1R1Am89nKYan1B25MuGnKozR395s9Ftk` |

The Ethereum / EVM address can also receive assets on Ethereum, BNB Smart Chain, Polygon, Arbitrum, Optimism, Base, Avalanche C-Chain, and Fantom when using the correct network.
<!-- donations:end -->

## License

PANDA source code and executable examples are available under the
[MIT License](./LICENSE.md#software-license-mit). Original prose, diagrams, and
other non-code content in this README and `docs/` are available under
[Creative Commons Attribution 4.0 International](./docs/license.md). See the
[complete licensing notice](./LICENSE.md) for scope and exclusions.

## Long-term vision

PANDA aims to become a reusable architecture for intelligent agents, analogous
to the role MVC plays in web applications: a shared vocabulary and separation
of responsibilities without prescribing one implementation technology.
