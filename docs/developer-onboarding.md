# PANDA Developer Onboarding

This guide is the practical starting point for PANDA development. It describes
the repository as it exists on **August 10, 2026**: a TypeScript pnpm monorepo
whose application path uses the canonical five-capability execution model.

Use it to set up a checkout, find the right workspace, understand an execution,
make a focused change, and validate it. The [documentation index](README.md)
links to the normative requirements, architecture, phase plans, and progress
records.

## 1. Current project status

Phases 0 through 11 and the local v0.1 release baseline are complete. Phases 12
and 13 add post-v0.1 durability and authenticated API-boundary increments. The
daemon owns durable local Goal and Execution stores, dynamic coordination,
deterministic capabilities, transition and effect policy, a real sandboxed
filesystem Action connector, and independent effect verification. The API,
SDK, dashboard, and WebSocket stream expose the same retained canonical
records. Optional bearer mode binds new work to one service principal, and the
process refuses unauthenticated non-loopback exposure. The
[v0.1 Release Profile](v0.1-release-profile.md) remains the authoritative frozen
v0.1 record; the [Phase 13 Plan](plans/phase-13.md) defines the current API trust
boundary.

The current executable development baseline remains intentionally narrow:

| Area | Current behavior |
| --- | --- |
| Capabilities | Perception, Analysis, Network, Decision, and Action |
| Routing | Each capability returns a typed `NextStep`; policy permits or denies the proposed transition |
| State | Goal, Execution, and trace state is isolated by execution ID and retained in versioned local files; Flow Records use SQLite |
| Effect | One relative-path UTF-8 filesystem write inside a per-execution workspace |
| Verification | A separate observer reads the environment before Analysis can mark the Goal achieved |
| Trace | Material records are stored append-only with per-execution sequence, correlation, and causation |
| Interfaces | Canonical HTTP execution resources, typed SDK methods, WebSocket commit events, and a trace dashboard |
| Security | Loopback development uses `panda-local`; optional bearer mode resolves one service principal, exact CORS origins are enforced, and unauthenticated non-loopback startup is rejected |
| Tests | Shared, core, SDK, daemon, and dashboard executable suites include the eight-case release matrix, restart recovery, and API security coverage |

Memory is a persistence responsibility. Planning, understanding, and reflection
are techniques that may be used inside Analysis or Decision; none is a runtime
capability or process-wide state.

See [Implementation Progress](progress.md) for the completed-phase evidence and
current validation baseline.

## 2. Prerequisites

- Git
- Node.js 20 or newer
- pnpm 9.15.1
- A modern browser for dashboard work
- Optional GitHub CLI (`gh`) for the documented publication workflow

The root package records Node.js `>=20` in `engines` and pins pnpm `9.15.1` in
`packageManager`. The release workflow was also verified with Node.js `v23.1.0`.

```bash
node --version
pnpm --version
git --version
```

## 3. First-time setup

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

The initial build is required because internal packages export JavaScript and
declarations from ignored `dist/` directories.

### Configuration and secrets

| Variable | Default | Behavior |
| --- | --- | --- |
| `PANDA_HOST` | `127.0.0.1` | Daemon listener host |
| `PANDA_PORT` | `4317` | Daemon listener port |
| `PANDA_DATA_DIRECTORY` | `.panda` | Root of versioned state snapshots and per-execution effect sandboxes |
| `PANDA_PERSISTENCE` | `file` | `file` retains local state across restart; `memory` is explicitly ephemeral |
| `PANDA_API_TOKEN` | unset | Enables bearer protection for execution HTTP and WebSocket resources; must contain at least 32 non-whitespace characters |
| `PANDA_API_PRINCIPAL_ID` | `panda-api-client` | Service-principal ID assigned to newly created Goals in bearer mode |
| `PANDA_ALLOWED_ORIGINS` | local dashboard origins | Comma-separated exact HTTP(S) origins allowed by CORS; an empty value allows no browser origins |

```bash
PANDA_HOST=127.0.0.1 PANDA_PORT=4317 pnpm dev
```

The application does not load `.env` automatically. `.env.example` documents
both the local GitHub publication credential and daemon security variable names;
export only the values required by the process. Never print or commit populated
`.env` files.

`generated_wallets/` contains recovery phrases if the donation script is run.
It is ignored secret material: do not commit, paste, log, or share it. Avoid
`pnpm generate:wallets` unless you explicitly intend to create credentials.
The default `.panda/` directory is also ignored because persisted JSON traces
and the `panda.sqlite` Flow Records database contain user-authored content and
evidence in plaintext.

## 4. Run the local stack

```bash
pnpm dev
```

- Daemon HTTP API: `http://127.0.0.1:4317`
- Daemon WebSocket: `ws://127.0.0.1:4317/events`
- Dashboard: `http://127.0.0.1:5173`
- Flow Records: `http://127.0.0.1:5173/#/flow-records`

In another terminal:

```bash
curl http://127.0.0.1:4317/health
pnpm run doctor
```

Create a canonical execution:

```bash
curl \
  --request POST \
  --header 'content-type: application/json' \
  --data '{"payload":{"path":"proof.txt","content":"PANDA v0.1 completed"}}' \
  http://127.0.0.1:4317/executions
```

The commands above use the default unauthenticated loopback mode and run as the
explicit `panda-local` system principal. To exercise bearer mode, export a
secret and principal before starting the daemon:

```bash
export PANDA_API_TOKEN="replace-with-a-secret-of-at-least-32-characters"
export PANDA_API_PRINCIPAL_ID="developer"
pnpm dev
```

Then authenticate execution resources:

```bash
curl \
  --header "Authorization: Bearer $PANDA_API_TOKEN" \
  http://127.0.0.1:4317/executions
```

`GET /health` remains public. The built-in dashboard has no bearer-token entry,
so use it with the default loopback mode until browser login/session support is
designed.

Use the returned ID to inspect the retained trace:

```bash
curl http://127.0.0.1:4317/executions/exe_REPLACE_ME/trace
```

The dashboard shows the Goal, criteria, dynamic route, source-linked operator
answers, and complete stored timeline. The daemon does not call an LLM or
GitHub action. Its one real v0.1 effect is policy-bounded below the execution
workspace. Terminal and waiting state survives restart in the default `file`
mode. Persisted `pending` or `running` work is failed on startup without Action
replay unless its Goal was already terminal, in which case the matching
Execution outcome is finalized. Memory mode intentionally starts empty after
every restart.

Flow Records use `GET`, `POST`, `PUT`, and `DELETE` routes below
`/flow-records`. They are stored in `.panda/panda.sqlite` by the Fastify daemon
and remain durable independently of the execution persistence mode. The React
page automatically imports valid records from the retired
`panda.flow-records.v1` local-storage key before removing that browser copy.

## 5. Repository map

```text
panda/
├── apps/
│   ├── cli/             Commander-based local CLI
│   ├── daemon/          Fastify HTTP and WebSocket process
│   └── dashboard/       React, Vite, and Tailwind execution UI
├── packages/
│   ├── shared/          Canonical contracts, factories, IDs, time, logging
│   ├── core/            Stores, coordinator, capabilities, policy, effects
│   └── sdk/             Typed HTTP client and public canonical types
├── examples/            Typed SDK usage
├── docs/                Requirements, architecture, plans, and records
├── scripts/             Repository utility scripts
├── package.json         Root commands and donation dependencies
├── pnpm-workspace.yaml  Workspace discovery
└── tsconfig.base.json   Shared strict TypeScript configuration
```

Generated output appears in package `dist/` directories and in
`apps/dashboard/dist-types/` and `apps/dashboard/dist/`. Edit source, not build
output.

### Workspace responsibilities

| Workspace | Main entry point | Responsibility |
| --- | --- | --- |
| `@panda/shared` | `packages/shared/src/index.ts` | Canonical domain and trace contracts, constructors, identities, time, events, and logging |
| `@panda/core` | `packages/core/src/index.ts` | Goal/Execution stores, capability registry and coordinator, policies, deterministic capabilities, Action connector, and effect observer |
| `@panda/sdk` | `packages/sdk/src/index.ts` | Typed Fetch client for health, execution, and Flow Record CRUD endpoints with structured errors |
| `@panda/daemon` | `apps/daemon/src/index.ts` | One canonical component graph, local state, SQLite Flow Records, HTTP API, and WebSocket trace fan-out |
| `@panda/cli` | `apps/cli/src/index.ts` | Initialization, local process launchers, health, and version output |
| `@panda/dashboard` | `apps/dashboard/src/App.tsx` | Request form, execution list/detail, Goal criteria, operator brief, and causal trace timeline |

Dependency direction stays toward shared contracts and runtime packages:

```text
@panda/shared
├── @panda/core ─────────────> @panda/daemon
└── @panda/sdk
    ├── @panda/cli
    └── @panda/dashboard
```

The daemon imports both shared and core directly. Avoid app-to-app imports or a
lower-level package depending on a higher-level app.

## 6. How an execution works

```text
Dashboard / custom caller
          |
      @panda/sdk
          |
  bearer principal boundary
          |
  POST /executions
          |
     Fastify daemon
          |
          +--> create Signal, Goal, and Execution
          +--> commit signal and goal trace records
          +--> coordinator invokes a capability-selected route
          +--> policy checks transitions and effect candidates
          +--> filesystem connector performs an authorized effect
          +--> independent observer reads the environment
          +--> Analysis verifies explicit Goal criteria
          +--> stores retain terminal state and causal trace
          +--> API returns a view; WebSocket announces committed records
```

Important properties:

- HTTP views, SDK reads, and WebSocket events all originate from the same
  daemon-owned stores.
- Each execution has distinct execution, goal, correlation, workspace, trace,
  and causation identities.
- The authenticated or local system principal owns the Goal, reaches every
  capability context, and is recorded in effect-policy evidence; credentials do
  not enter canonical records.
- The route is determined by capability results and policy, not by a fixed
  sequence.
- Connector completion is an Outcome, not proof. Independent observation and
  criteria evaluation determine whether the Goal is achieved.
- WebSocket delivery occurs after storage assigns a sequence. Reconnecting
  clients retrieve authoritative history through the trace endpoint.

## 7. Local interfaces

### HTTP and WebSocket

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/health` | Daemon identity and health |
| `POST` | `/executions` | Create an execution from `{ type?, source?, payload: { path?, content? } }` |
| `GET` | `/executions` | List retained local execution views |
| `GET` | `/executions/:id` | Read one execution view or structured `404` |
| `GET` | `/executions/:id/trace` | Read its sequence-stable trace or structured `404` |
| WebSocket | `/events` | Initial log event followed by committed `execution.recorded` events |

`/health` is public. When `PANDA_API_TOKEN` is set, every other listed HTTP and
WebSocket resource requires a Bearer header. Missing, malformed, and incorrect
credentials all return `401 AUTHENTICATION_REQUIRED`. Without a token, the
process accepts only a loopback listener. CORS defaults to
`http://127.0.0.1:5173` and `http://localhost:5173`; configure exact additional
origins with `PANDA_ALLOWED_ORIGINS`.

### SDK

```ts
const client = new PandaClient({
  baseUrl: "http://127.0.0.1:4317",
  apiToken: process.env.PANDA_API_TOKEN,
});

await client.health();
const execution = await client.createExecution({
  payload: { path: "proof.txt", content: "PANDA v0.1 completed" },
});
await client.listExecutions();
await client.getExecution(execution.executionId);
await client.getExecutionTrace(execution.executionId);
```

`PandaRequestError` preserves the daemon's structured error code, message,
optional issues, and HTTP status. `apiToken` is sent only as a Bearer header.
Retries, cancellation, timeouts, and a WebSocket client are not implemented.

### Dashboard and CLI

The dashboard URLs and the SDK default are currently fixed to port `4317`.
Changing `PANDA_PORT` does not reconfigure those consumers automatically.

```bash
pnpm --filter @panda/cli panda init
pnpm --filter @panda/cli panda dev
pnpm --filter @panda/cli panda daemon
pnpm --filter @panda/cli panda dashboard
pnpm --filter @panda/cli panda doctor
pnpm --filter @panda/cli panda version
```

`panda init` creates `panda/panda.config.json` below the current directory. It
does not initialize this monorepo or alter daemon runtime configuration.

## 8. Development workflow

Before changing code:

1. Read [Framework Requirements](requirements.md).
2. Identify the applicable [Guiding Principles and
   KPIs](guiding-principles-kpis.md) and turn them into acceptance evidence.
3. Read the relevant [Architecture](architecture/README.md) document and ADRs.
4. Check [Implementation Progress](progress.md), the
   [v0.1 Implementation Plan](v0.1-implementation-plan.md), and active phase.
5. Inspect affected source, tests, and recent history.
6. Define scope, non-goals, acceptance criteria, and validation.

Workspace consumers import built package exports. After changing
`packages/*/src`, rebuild the package and consumers or run the full build. The
root development command watches the daemon and dashboard, not package source.

```bash
pnpm --filter @panda/core... build
pnpm --filter @panda/daemon... build
pnpm build
pnpm typecheck
pnpm test
```

Node's built-in test runner covers shared, core, SDK, daemon, and dashboard
trace-presentation helpers. Tests live beside source as `src/*.test.ts`.

```bash
pnpm --filter @panda/core test
pnpm --filter @panda/sdk test
pnpm --filter @panda/daemon test
pnpm --filter @panda/dashboard test
```

There is no configured formatter, linter, coverage threshold, or dashboard
component-test runner.

### Public contracts and effects

When changing a cross-package or process contract, update producers,
consumers, API validation, SDK exports, examples, and tests together. Preserve
explicit identity, schema version, timestamps, provenance, correlation, and
causation where required.

Before adding a connector or effect, read
[Connectors](architecture/connectors.md), [Policies](architecture/policies.md),
and [Security](architecture/security.md). Keep input, network, decision, and
action responsibilities distinct. Validate boundary data, use least privilege,
return structured outcomes, and verify environmental effects separately.

## 9. Validation reference

| Command | Behavior |
| --- | --- |
| `pnpm dev` | Runs daemon and dashboard development processes |
| `pnpm build` | Builds every discovered workspace in dependency order |
| `pnpm typecheck` | Builds, then runs each workspace no-emit typecheck |
| `pnpm test` | Runs all workspace tests |
| `pnpm start` | Starts the already-built daemon |
| `pnpm run doctor` | Checks the default daemon health endpoint through the source CLI |
| `pnpm generate:wallets` | Generates sensitive seed phrases and public donation addresses |

For a cross-workspace change:

```bash
pnpm build
pnpm typecheck
pnpm test
git diff --check
```

The dashboard build can emit an existing Node experimental warning while
Tailwind loads its TypeScript config through CommonJS. A successful build is
still required; investigate actual errors or new warnings separately.

## 10. Documentation and GitHub delivery

A phase should document its objective, scope, non-goals, evidence,
dependencies, tasks, risks, acceptance criteria, validation, and limitations.
Include results for every applicable KPI from the [Guiding Principles and KPI
Scorecard](guiding-principles-kpis.md), or identify when the baseline will be
measured. Do not infer a KPI result from evidence that does not measure it.
If evidence changes an accepted design, update the relevant architecture
decision before implementation and assess dependent phases.

When publication is requested, follow the
[GitHub Pull Request Workflow](github-push-workflow.md): inspect the branch and
working tree, stage intended paths only, keep secrets and generated output out
of Git, commit with validation evidence, push a feature branch, open a pull
request, process required checks and review without bypasses, verify the merged
commit on `origin/main`, and delete the merged feature branch only after all
cleanup guards pass.

## 11. Architectural guardrails

- PANDA has exactly five fundamental capabilities: Perception, Analysis,
  Network, Decision, and Action.
- Capabilities are selectable responsibilities, not fixed loop stages.
- A capability may request any policy-permitted capability, itself, wait, or
  termination.
- Runtime state is execution-scoped; material records have distinct contracts
  and ownership.
- Proposed transitions and effects are checked before commitment.
- Decisions, connector calls, outcomes, evidence, verification, failures, and
  transitions remain causally traceable.
- Connectors isolate protocols and privileges behind responsibility-specific
  boundaries.
- Failure, denial, timeout, cancellation, partial effect, and unknown effect
  remain distinct from success.
- An LLM may reason inside a capability but is not the controller.
- PANDA remains model-independent, local-first, and usable without a broker,
  database, daemon, or LLM.

## 12. Known limitations

- The default file store is single-process and local; it has no database,
  backup, replication, cross-file transaction, or multi-writer coordination.
- API authentication supports one static bearer principal only; there is no
  TLS, browser login, roles/scopes, token issuance/rotation, authentication
  audit store, or per-resource multi-tenant authorization.
- Endpoint configuration is not shared across daemon, SDK, CLI, and dashboard.
- Only the bounded filesystem Action is implemented as a real effect.
- There is no LLM/provider integration, durable retry, automatic wait-event
  resumption, or general planner.
- Multiple agents, plugins, MCP, cloud sync, vector memory, mobile apps, and
  Docker deployment are not implemented.
- Linting, formatting, coverage enforcement, and browser component tests are
  not configured.

## 13. Troubleshooting

### A workspace import cannot find `dist/index.js`

```bash
pnpm build
```

Fresh clones do not contain ignored build output. Rebuild after changing
package source and restart the dev process if a consumer remains stale.

### `pnpm run doctor` cannot reach the daemon

```bash
curl http://127.0.0.1:4317/health
```

`doctor` currently uses the SDK's default endpoint.

### An API request returns `AUTHENTICATION_REQUIRED`

The daemon was started with `PANDA_API_TOKEN`. Pass the same value through the
SDK `apiToken` option or an `Authorization: Bearer ...` header. Do not put the
token in a URL, request body, trace, or committed configuration file. Health is
available without authentication and reports the active mode.

### Non-loopback startup fails before listening

`PANDA_HOST` names a non-loopback interface but `PANDA_API_TOKEN` is absent or
invalid. Configure a strong bearer token before binding outside loopback. This
guard does not provide TLS; use a trusted TLS terminator for traffic that leaves
the host.

### A local port is already in use

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Inspect ownership before stopping a process. A custom daemon port must also be
configured deliberately in its consumers.

### Executions disappeared

Check the `persistence` field returned by `/health`, the
`PANDA_PERSISTENCE` setting, and `PANDA_DATA_DIRECTORY`. State disappears after
restart only in explicit `memory` mode or when the daemon points at a different
data directory. If file-mode startup rejects state as corrupt, incompatible, or
incomplete, preserve the data directory for investigation; do not edit or
delete evidence until the failure is understood.

## 14. Definition of done

Use the [Guiding Principles and KPI Scorecard](guiding-principles-kpis.md)
alongside the checks below. Applicable KPI results need inspectable evidence;
missed targets need an explicit release decision or owned follow-up.

A PANDA change is complete when its documented acceptance criteria are met;
implementation follows current requirements and architecture; focused and
repository-wide validation pass in proportion to risk; API, SDK, examples, UI,
and docs agree; no secret, generated output, or unrelated user change is
included; and limitations or follow-up work are recorded.
