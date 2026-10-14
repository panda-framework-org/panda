import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Database,
  FileCode2,
  Layers3,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { PandaClient, PandaRequestError } from "@panda/sdk";
import type {
  PandaEvent,
  PandaExecutionCreateInput,
  PandaExecutionView,
  PandaHealthResponse,
  StoredPandaTraceRecord,
} from "@panda/shared";
import {
  executionFlow,
  executionInsights,
  orderTrace,
  producerLabel,
  traceCause,
  traceVisualKind,
  type ExecutionFlowKind,
  type TraceVisualKind,
} from "./trace-view";

const DEFAULT_PATH = "proof.txt";
const DEFAULT_CONTENT = "PANDA v0.1 completed";
const DAEMON_EVENTS_URL = "ws://127.0.0.1:4317/events";

type ConnectionState = "connecting" | "connected" | "disconnected";
type DaemonState = "checking" | "online" | "offline";

interface ExecutionSummary {
  readonly active: number;
  readonly waiting: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly total: number;
  readonly latestUpdate?: string;
}

interface OperatorAnswer {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly sourceSequence?: number;
}

interface ExecutionDecisionView {
  readonly sequence: number;
  readonly selectedOption: string;
  readonly rationale: string;
  readonly alternatives: string[];
  readonly constraints: string[];
  readonly evidence: string[];
}

export function App() {
  const client = useMemo(() => new PandaClient(), []);
  const selectedIdRef = useRef<string | undefined>(undefined);
  const websocketRefreshRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const shouldRevealFlowRef = useRef(false);
  const pendingDashboardExecutionRef = useRef(false);
  const liveExecutionIdRef = useRef<string | undefined>(undefined);
  const [executions, setExecutions] = useState<PandaExecutionView[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selected, setSelected] = useState<PandaExecutionView>();
  const [trace, setTrace] = useState<StoredPandaTraceRecord[]>([]);
  const [path, setPath] = useState(DEFAULT_PATH);
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");
  const [daemonState, setDaemonState] = useState<DaemonState>("checking");
  const [health, setHealth] = useState<PandaHealthResponse>();
  const [error, setError] = useState<string>();
  const executionSummary = useMemo(
    () => summarizeExecutions(executions),
    [executions],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!shouldRevealFlowRef.current || trace.length === 0) return;
    shouldRevealFlowRef.current = false;
    window.requestAnimationFrame(() => {
      document.getElementById("execution-flow-map")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [trace]);

  const refreshExecutions = useCallback(
    async (preferredId?: string) => {
      const views = await client.listExecutions();
      const ordered = [...views].sort((first, second) =>
        second.execution.updatedAt.localeCompare(first.execution.updatedAt),
      );
      setExecutions(ordered);
      const nextId =
        preferredId ??
        selectedIdRef.current ??
        ordered.at(0)?.executionId;
      if (nextId !== undefined) {
        setSelectedId(nextId);
      }
      return ordered;
    },
    [client],
  );

  const refreshSelection = useCallback(
    async (executionId: string) => {
      const [view, storedTrace] = await Promise.all([
        client.getExecution(executionId),
        client.getExecutionTrace(executionId),
      ]);
      setSelected(view);
      setTrace(orderTrace(storedTrace));
    },
    [client],
  );

  const refreshHealth = useCallback(async () => {
    try {
      const response = await client.health();
      setHealth(response);
      setDaemonState(response.ok ? "online" : "offline");
    } catch {
      setHealth(undefined);
      setDaemonState("offline");
    }
  }, [client]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    setError(undefined);
    try {
      await Promise.all([refreshHealth(), refreshExecutions()]);
      const current = selectedIdRef.current;
      if (current !== undefined) {
        await refreshSelection(current);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshExecutions, refreshHealth, refreshSelection]);

  useEffect(() => {
    let active = true;
    void Promise.all([refreshHealth(), refreshExecutions()])
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setIsRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [refreshExecutions, refreshHealth]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshHealth();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [refreshHealth]);

  useEffect(() => {
    if (selectedId === undefined) {
      setSelected(undefined);
      setTrace([]);
      return;
    }
    let active = true;
    setError(undefined);
    setSelected(undefined);
    setTrace([]);
    void Promise.all([
      client.getExecution(selectedId),
      client.getExecutionTrace(selectedId),
    ])
      .then(([view, storedTrace]) => {
        if (!active) return;
        setSelected(view);
        setTrace(orderTrace(storedTrace));
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [client, selectedId]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!active) return;
      setConnection("connecting");
      socket = new WebSocket(DAEMON_EVENTS_URL);
      socket.onopen = () => {
        if (active) setConnection("connected");
      };
      socket.onclose = () => {
        if (!active) return;
        setConnection("disconnected");
        reconnectTimer = setTimeout(connect, 2_000);
      };
      socket.onerror = () => {
        if (active) setConnection("disconnected");
      };
      socket.onmessage = (message) => {
        let event: PandaEvent;
        try {
          event = JSON.parse(message.data) as PandaEvent;
        } catch {
          return;
        }
        if (event.type !== "execution.recorded") return;
        const eventExecutionId = event.executionId;
        if (eventExecutionId === undefined) return;

        if (
          pendingDashboardExecutionRef.current &&
          liveExecutionIdRef.current === undefined &&
          isDashboardSignalEvent(event)
        ) {
          liveExecutionIdRef.current = eventExecutionId;
          selectedIdRef.current = eventExecutionId;
          setSelectedId(eventExecutionId);
        }

        const current =
          liveExecutionIdRef.current === eventExecutionId
            ? eventExecutionId
            : selectedIdRef.current ?? eventExecutionId;
        if (websocketRefreshRef.current !== undefined) return;
        websocketRefreshRef.current = setTimeout(() => {
          websocketRefreshRef.current = undefined;
          void Promise.all([
            refreshExecutions(current),
            refreshSelection(current),
          ]).catch((caught) => setError(errorMessage(caught)));
        }, 55);
      };
    };

    connect();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      if (websocketRefreshRef.current !== undefined) {
        clearTimeout(websocketRefreshRef.current);
      }
      socket?.close();
    };
  }, [refreshExecutions, refreshSelection]);

  async function createExecution() {
    setIsCreating(true);
    setError(undefined);
    shouldRevealFlowRef.current = true;
    pendingDashboardExecutionRef.current = true;
    liveExecutionIdRef.current = undefined;
    const request: PandaExecutionCreateInput = {
      source: "dashboard",
      payload: { path, content },
    };
    try {
      const view = await client.createExecution(request);
      selectedIdRef.current = view.executionId;
      setSelectedId(view.executionId);
      setSelected(view);
      await Promise.all([
        refreshExecutions(view.executionId),
        refreshSelection(view.executionId),
      ]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsCreating(false);
      pendingDashboardExecutionRef.current = false;
      liveExecutionIdRef.current = undefined;
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Activity size={18} />
          </span>
          <div>
            <div className="brand-name">PANDA</div>
            <div className="brand-subtitle">Execution observatory</div>
          </div>
        </div>
        <div className="topbar-actions">
          <a className="topbar-flow-link" href="#/flow-records">
            <Database size={14} />
            Flow records
          </a>
          <a className="topbar-flow-link" href="#/browser-companion">Browser companion</a>
          <ConnectionBadge state={connection} />
          <button
            className="button button-quiet"
            type="button"
            onClick={() => void refreshAll()}
            disabled={isRefreshing}
          >
            <RefreshCw size={15} className={isRefreshing ? "spin" : ""} />
            Refresh dashboard
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">
            <Sparkles size={13} /> Canonical runtime trace
          </div>
          <h1>Follow an execution from intent to evidence.</h1>
          <p>
            One operator view for the goal, dynamic route, policy boundary,
            real effect, and independent verification.
          </p>
          <a className="home-flow-link" href="#/flow-records">
            Open flow records <ArrowRight size={14} />
          </a>
        </div>
        <div className="hero-stat" aria-label="Active execution count">
          <span>{executionSummary.active.toString().padStart(2, "0")}</span>
          <small>executions active now</small>
        </div>
      </section>

      <ExecutionFlowMap
        trace={trace}
        executionId={selected?.executionId}
        status={selected?.status}
      />

      <RuntimeOverview
        daemonState={daemonState}
        health={health}
        connection={connection}
        summary={executionSummary}
      />

      <section className="operator-console-section">
        <div className="section-heading-row operator-console-heading">
          <div>
            <span className="section-kicker">Operator console</span>
            <h2>Send new input, question the analysis, inspect the decision</h2>
          </div>
          <span>All answers link back to canonical trace evidence.</span>
        </div>
        <div className="operator-console-grid">
          <ExecutionForm
            path={path}
            content={content}
            isCreating={isCreating}
            onPathChange={setPath}
            onContentChange={setContent}
            onSubmit={() => void createExecution()}
          />
          <ExecutionQuestionConsole
            executionId={selected?.executionId}
            trace={trace}
          />
          <DecisionInspector trace={trace} />
        </div>
      </section>

      {error !== undefined && (
        <div className="error-banner" role="alert">
          <XCircle size={17} />
          <span>{error}</span>
        </div>
      )}

      <section className="workspace-grid">
        <aside className="control-rail">
          <ExecutionList
            executions={executions}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>

        <section className="trace-workspace">
          {selected === undefined ? (
            <EmptyDashboard />
          ) : (
            <>
              <ExecutionHeader view={selected} traceCount={trace.length} />
              <InsightGrid trace={trace} />
              <TraceTimeline trace={trace} />
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function RuntimeOverview({
  daemonState,
  health,
  connection,
  summary,
}: {
  daemonState: DaemonState;
  health?: PandaHealthResponse;
  connection: ConnectionState;
  summary: ExecutionSummary;
}) {
  const daemonLabel =
    daemonState === "online"
      ? "Online"
      : daemonState === "checking"
        ? "Checking"
        : "Offline";
  const streamLabel =
    connection === "connected"
      ? "Connected"
      : connection === "connecting"
        ? "Connecting"
        : "Disconnected";
  const daemonDetail =
    health === undefined
      ? "Waiting for daemon health"
      : `v${health.version} · ${health.persistence} state · ${health.authentication} auth`;

  return (
    <section
      className="runtime-overview panel"
      aria-label="Live runtime overview"
      aria-live="polite"
    >
      <RuntimeMetric
        icon={<Activity size={15} />}
        label="PANDA daemon"
        value={daemonLabel}
        detail={daemonDetail}
        tone={daemonState}
      />
      <RuntimeMetric
        icon={
          connection === "connected" ? (
            <Wifi size={15} />
          ) : (
            <WifiOff size={15} />
          )
        }
        label="Live stream"
        value={streamLabel}
        detail="Real-time trace events"
        tone={connection === "connected" ? "online" : connection}
      />
      <RuntimeMetric
        icon={<Clock3 size={15} />}
        label="Active now"
        value={summary.active.toString()}
        detail="Running or pending"
      />
      <RuntimeMetric
        icon={<CircleDot size={15} />}
        label="Waiting"
        value={summary.waiting.toString()}
        detail="Paused for a next step"
      />
      <RuntimeMetric
        icon={<CheckCircle2 size={15} />}
        label="Succeeded"
        value={summary.succeeded.toString()}
        detail="Verified outcomes"
        tone="online"
      />
      <RuntimeMetric
        icon={<Layers3 size={15} />}
        label="Total executions"
        value={summary.total.toString()}
        detail={
          summary.latestUpdate === undefined
            ? "No activity recorded"
            : `Latest ${formatTimestamp(summary.latestUpdate)}`
        }
        supplementary={
          summary.failed > 0
            ? `${summary.failed} failed or cancelled`
            : "No failures"
        }
        tone={summary.failed > 0 ? "offline" : undefined}
      />
    </section>
  );
}

function RuntimeMetric({
  icon,
  label,
  value,
  detail,
  supplementary,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  supplementary?: string;
  tone?: string;
}) {
  return (
    <article
      className={`runtime-metric${tone === undefined ? "" : ` tone-${tone}`}`}
    >
      <div className="runtime-metric-label">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
      {supplementary !== undefined && <small>{supplementary}</small>}
    </article>
  );
}

function ExecutionForm({
  path,
  content,
  isCreating,
  onPathChange,
  onContentChange,
  onSubmit,
}: {
  path: string;
  content: string;
  isCreating: boolean;
  onPathChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = path.trim().length > 0 && !isCreating;
  return (
    <section className="panel request-panel" id="new-perception-input">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">1 · New perception</span>
          <h2>Send new input through PANDA</h2>
        </div>
        <span className="request-scope">
          <ShieldCheck size={14} />
          Sandboxed
        </span>
      </div>
      <p className="request-description">
        Starts a new execution. Perception receives this file request, then
        PANDA analyzes, decides, acts, and verifies it.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <label className="field-label" htmlFor="request-path">
          File name
        </label>
        <input
          id="request-path"
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          placeholder="proof.txt"
          autoComplete="off"
          aria-describedby="request-path-note"
        />
        <div className="field-note" id="request-path-note">
          Saved only inside this run’s workspace—not in your project.
        </div>
        <label className="field-label" htmlFor="request-content">
          Text to put in the file
        </label>
        <textarea
          id="request-content"
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          rows={5}
        />
        <button
          className="button button-primary button-full"
          type="submit"
          disabled={!canSubmit}
        >
          <Play size={15} fill="currentColor" />
          {isCreating ? "Moving through PANDA…" : "Send through the system"}
        </button>
        <p className="button-explanation">
          Current input type: sandboxed file request. This creates canonical
          runtime records.
        </p>
      </form>
    </section>
  );
}

function ExecutionQuestionConsole({
  executionId,
  trace,
}: {
  executionId?: string;
  trace: StoredPandaTraceRecord[];
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<OperatorAnswer>();
  const suggestedQuestions = [
    "What did Perception receive?",
    "What did Analysis conclude?",
    "Why was this action selected?",
    "How was the result verified?",
  ];

  useEffect(() => {
    setQuestion("");
    setAnswer(undefined);
  }, [executionId]);

  function ask(value: string) {
    const normalized = value.trim();
    if (normalized.length === 0 || trace.length === 0) return;
    setQuestion(normalized);
    setAnswer(answerOperatorQuestion(trace, normalized));
  }

  return (
    <section className="panel question-console">
      <div>
        <span className="section-kicker">2 · Ask analysis</span>
        <h2>Ask about the selected run</h2>
        <p>
          Get a trace-grounded answer from stored Perception, Analysis,
          Decision, effect, and verification records.
        </p>
      </div>
      <form
        className="question-form"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <label className="field-label" htmlFor="operator-question">
          Your question
        </label>
        <textarea
          id="operator-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Why did PANDA choose this action?"
          rows={3}
          disabled={trace.length === 0}
        />
        <button
          className="button button-quiet question-submit"
          type="submit"
          disabled={question.trim().length === 0 || trace.length === 0}
        >
          <Sparkles size={14} /> Ask this run
        </button>
      </form>
      <div className="question-suggestions" aria-label="Suggested questions">
        {suggestedQuestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion}
            onClick={() => ask(suggestion)}
            disabled={trace.length === 0}
          >
            {suggestion}
          </button>
        ))}
      </div>
      {answer !== undefined ? (
        <div className="operator-answer" aria-live="polite">
          <span>{answer.label}</span>
          <strong>{answer.value}</strong>
          {answer.detail !== undefined && <p>{answer.detail}</p>}
          {answer.sourceSequence !== undefined && (
            <a href={`#trace-${answer.sourceSequence}`}>
              Open supporting record #{answer.sourceSequence} <ArrowRight size={12} />
            </a>
          )}
        </div>
      ) : (
        <div className="operator-answer empty">
          {trace.length === 0
            ? "Select or create a run before asking a question."
            : "Ask a question or choose a suggestion."}
        </div>
      )}
      <p className="console-boundary-note">
        Read-only query: asking does not change the execution or create new
        analytics.
      </p>
    </section>
  );
}

function DecisionInspector({ trace }: { trace: StoredPandaTraceRecord[] }) {
  const decisions = executionDecisions(trace);
  const decision = decisions.at(-1);
  return (
    <section className="panel decision-inspector">
      <div className="decision-inspector-heading">
        <div>
          <span className="section-kicker">3 · View decisions</span>
          <h2>Decision inspector</h2>
        </div>
        <span className="count-pill">{decisions.length}</span>
      </div>
      {decision === undefined ? (
        <div className="decision-empty">
          No Decision record exists for the selected run yet.
        </div>
      ) : (
        <div className="decision-content">
          <div className="decision-selected">
            <span>Selected option</span>
            <strong>{decision.selectedOption}</strong>
          </div>
          <div>
            <span className="decision-label">Rationale</span>
            <p>{decision.rationale}</p>
          </div>
          {decision.alternatives.length > 0 && (
            <div>
              <span className="decision-label">Alternatives considered</span>
              <ul>
                {decision.alternatives.map((alternative) => (
                  <li key={alternative}>{alternative}</li>
                ))}
              </ul>
            </div>
          )}
          {decision.constraints.length > 0 && (
            <div>
              <span className="decision-label">Decisive constraints</span>
              <ul>
                {decision.constraints.map((constraint) => (
                  <li key={constraint}>{constraint}</li>
                ))}
              </ul>
            </div>
          )}
          {decision.evidence.length > 0 && (
            <div>
              <span className="decision-label">Decisive evidence</span>
              <ul>
                {decision.evidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            </div>
          )}
          <a className="decision-source" href={`#trace-${decision.sequence}`}>
            Inspect Decision record #{decision.sequence} <ArrowRight size={12} />
          </a>
        </div>
      )}
    </section>
  );
}

function ExecutionList({
  executions,
  selectedId,
  onSelect,
}: {
  executions: PandaExecutionView[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel execution-panel">
      <div className="panel-heading compact">
        <div>
          <span className="section-kicker">Runtime index</span>
          <h2>Executions</h2>
        </div>
        <span className="count-pill">{executions.length}</span>
      </div>
      <div className="execution-list">
        {executions.length === 0 ? (
          <div className="rail-empty">No executions recorded in this process.</div>
        ) : (
          executions.map((view) => {
            const active = view.executionId === selectedId;
            return (
              <button
                key={view.executionId}
                type="button"
                className={`execution-card${active ? " selected" : ""}`}
                onClick={() => onSelect(view.executionId)}
                aria-pressed={active}
              >
                <div className="execution-card-topline">
                  <StatusBadge status={view.status} />
                  <span>{formatTimestamp(view.execution.updatedAt)}</span>
                </div>
                <strong>{view.goal.objective}</strong>
                <div className="execution-state">
                  <CircleDot size={12} />
                  {view.execution.activeCapability !== undefined
                    ? `Active · ${view.execution.activeCapability}`
                    : `Terminal · ${view.execution.terminalOutcome ?? view.status}`}
                </div>
                <code>{shortId(view.executionId)}</code>
                <ArrowRight className="execution-arrow" size={16} />
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function ExecutionHeader({
  view,
  traceCount,
}: {
  view: PandaExecutionView;
  traceCount: number;
}) {
  const { execution, goal } = view;
  return (
    <section className="execution-header panel">
      <div className="execution-title-row">
        <div>
          <div className="execution-meta-row">
            <StatusBadge status={view.status} />
            <span className="mono-label">{view.executionId}</span>
          </div>
          <h2>{goal.objective}</h2>
          <p>{execution.statusReason ?? goal.statusReason ?? "No status reason recorded."}</p>
        </div>
        <div className="trace-count">
          <Layers3 size={17} />
          <strong>{traceCount}</strong>
          <span>stored records</span>
        </div>
      </div>

      <div className="execution-facts">
        <Fact
          label="Runtime state"
          value={
            execution.activeCapability !== undefined
              ? `Active in ${execution.activeCapability}`
              : `Terminal: ${execution.terminalOutcome ?? execution.status}`
          }
        />
        <Fact label="Goal state" value={goal.status} />
        <Fact label="Updated" value={formatTimestamp(execution.updatedAt)} />
      </div>

      <div className="criteria-layout">
        <div>
          <h3>Success criteria</h3>
          <ol className="criteria-list">
            {goal.successCriteria.map((criterion) => (
              <li key={criterion.id}>
                <CheckCircle2 size={15} />
                <span>
                  {criterion.description}
                  <code>
                    {criterion.evidenceType ?? "evidence unspecified"} ={" "}
                    {formatExpected(criterion.expected)}
                  </code>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Constraints</h3>
          {goal.constraints.length === 0 ? (
            <p className="not-recorded">Not recorded</p>
          ) : (
            <ul className="constraint-list">
              {goal.constraints.map((constraint) => (
                <li key={constraint}>{constraint}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ExecutionFlowMap({
  trace,
  executionId,
  status,
}: {
  trace: StoredPandaTraceRecord[];
  executionId?: string;
  status?: PandaExecutionView["status"];
}) {
  const steps = executionFlow(trace);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [replayCount, setReplayCount] = useState<number>();
  const isLive = status === "pending" || status === "running";
  const isReplaying =
    replayCount !== undefined && replayCount < steps.length;
  const visibleSteps =
    replayCount === undefined ? steps : steps.slice(0, replayCount);

  useEffect(() => {
    setReplayCount(undefined);
  }, [executionId]);

  useEffect(() => {
    if (replayCount === undefined || replayCount >= steps.length) return;
    const timer = window.setTimeout(() => {
      setReplayCount((current) =>
        current === undefined ? undefined : Math.min(current + 1, steps.length),
      );
    }, 560);
    return () => window.clearTimeout(timer);
  }, [replayCount, steps.length]);

  useEffect(() => {
    if (!isLive && !isReplaying) return;
    window.requestAnimationFrame(() => {
      diagramRef.current?.scrollTo({
        left: diagramRef.current.scrollWidth,
        behavior: "smooth",
      });
    });
  }, [isLive, isReplaying, visibleSteps.length]);

  return (
    <section className="flow-map-section panel" id="execution-flow-map">
      <div className="section-heading-row flow-map-heading">
        <div>
          <span className="section-kicker">Live execution graph</span>
          <h2>Watch the request move through PANDA</h2>
        </div>
        <div className="flow-map-controls">
          {isLive && (
            <span className="flow-live-badge">
              <i aria-hidden="true" /> Live · step {steps.length}
            </span>
          )}
          {!isLive && steps.length > 1 && (
            <button
              className="flow-replay-button"
              type="button"
              onClick={() => setReplayCount(1)}
              disabled={isReplaying}
            >
              <Play size={13} fill="currentColor" />
              {isReplaying ? "Replaying…" : "Replay steps"}
            </button>
          )}
        </div>
      </div>
      {steps.length === 0 ? (
        <div className="flow-map-empty">
          Create a file or select a previous run to see its route.
        </div>
      ) : (
        <>
          <div
            className="flow-diagram"
            aria-label="Execution flow diagram"
            aria-live="polite"
            ref={diagramRef}
          >
            <ol className="flow-track">
              {visibleSteps.map((step, index) => {
                const active =
                  index === visibleSteps.length - 1 &&
                  (isLive || isReplaying);
                return (
                  <li className="flow-hop" key={step.id}>
                    <a
                      className={`flow-node kind-${step.kind}${active ? " is-active" : " is-complete"}`}
                      href={`#trace-${step.sourceSequence}`}
                      aria-label={`${index + 1}. ${step.label}: ${step.detail}. Open trace record ${step.sourceSequence}.`}
                    >
                      <div className="flow-node-topline">
                        <span className="flow-node-icon">
                          <FlowNodeIcon kind={step.kind} />
                        </span>
                        <code>#{step.sourceSequence}</code>
                      </div>
                      <small>{step.system}</small>
                      <strong>{step.label}</strong>
                      <span>{step.detail}</span>
                    </a>
                    {index < visibleSteps.length - 1 && (
                      <span
                        className="flow-edge is-complete"
                        aria-hidden="true"
                      >
                        <ArrowRight size={18} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="flow-map-note">
            New nodes appear as the run advances. Select one to inspect its
            exact trace record.
          </p>
        </>
      )}
    </section>
  );
}

function FlowNodeIcon({ kind }: { kind: ExecutionFlowKind }) {
  const Icon =
    kind === "input"
      ? FileCode2
      : kind === "perception"
        ? CircleDot
        : kind === "analysis"
          ? Sparkles
          : kind === "network"
            ? Wifi
            : kind === "decision"
              ? Route
              : kind === "action"
                ? Play
                : kind === "policy"
                  ? ShieldCheck
                  : kind === "connector"
                    ? Layers3
                    : kind === "success"
                      ? CheckCircle2
                      : kind === "waiting"
                        ? Clock3
                        : kind === "failure"
                          ? XCircle
                          : Activity;
  return <Icon size={16} />;
}

function InsightGrid({ trace }: { trace: StoredPandaTraceRecord[] }) {
  const iconById = {
    input: CircleDot,
    route: Route,
    decision: Sparkles,
    authorization: ShieldCheck,
    request: FileCode2,
    effect: Activity,
    verification: CheckCircle2,
  } as const;
  return (
    <section className="insight-section">
      <div className="section-heading-row">
        <div>
          <span className="section-kicker">Record-derived answers</span>
          <h2>Operator brief</h2>
        </div>
        <span>Every answer cites stored evidence.</span>
      </div>
      <div className="insight-grid">
        {executionInsights(trace).map((insight) => {
          const Icon = iconById[insight.id];
          return (
            <article className="insight-card" key={insight.id}>
              <div className="insight-icon">
                <Icon size={16} />
              </div>
              <span>{insight.label}</span>
              <strong>{insight.value}</strong>
              {insight.detail !== undefined && <p>{insight.detail}</p>}
              <small>
                {insight.sourceSequence === undefined
                  ? "Source · Not recorded"
                  : (
                      <a href={`#trace-${insight.sourceSequence}`}>
                        Source · #{insight.sourceSequence}
                      </a>
                    )}
              </small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TraceTimeline({ trace }: { trace: StoredPandaTraceRecord[] }) {
  const ordered = orderTrace(trace);
  return (
    <section className="timeline-section panel">
      <div className="section-heading-row timeline-heading">
        <div>
          <span className="section-kicker">Sequence is authoritative</span>
          <h2>Causal timeline</h2>
        </div>
        <VisualLegend />
      </div>
      {ordered.length === 0 ? (
        <div className="timeline-empty">No trace records are stored.</div>
      ) : (
        <ol className="timeline-list">
          {ordered.map((record) => (
            <TraceRow key={record.id} record={record} trace={ordered} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TraceRow({
  record,
  trace,
}: {
  record: StoredPandaTraceRecord;
  trace: StoredPandaTraceRecord[];
}) {
  const kind = traceVisualKind(record.category);
  const cause = traceCause(record, trace);
  const causeLabel =
    cause.state === "root"
      ? "Root record"
      : cause.state === "resolved"
        ? `Direct cause · #${cause.sequence}`
        : "Direct cause · unresolved";
  return (
    <li className={`timeline-row kind-${kind}`} id={`trace-${record.sequence}`}>
      <div className="timeline-sequence">#{record.sequence}</div>
      <div className="timeline-node" aria-hidden="true" />
      <article>
        <div className="timeline-topline">
          <div className="timeline-labels">
            <span className="kind-label">{visualKindLabel(kind)}</span>
            <span className="category-label">{record.category}</span>
          </div>
          <time dateTime={record.timestamp}>{formatTimestamp(record.timestamp)}</time>
        </div>
        <h3>{record.type}</h3>
        <div className="record-grid">
          <div>
            <span>Producer</span>
            <strong>{producerLabel(record)}</strong>
          </div>
          <div>
            <span>Record ID</span>
            <code>{record.id}</code>
          </div>
          <div>
            <span>{causeLabel}</span>
            {cause.state === "resolved" ? (
              <a href={`#trace-${cause.sequence}`}>
                <code>{cause.id}</code>
              </a>
            ) : (
              <code>{cause.id ?? "—"}</code>
            )}
          </div>
        </div>
        <details className="payload-details">
          <summary>Inspect exact payload</summary>
          <pre>{JSON.stringify(record.payload, null, 2)}</pre>
        </details>
      </article>
    </li>
  );
}

function VisualLegend() {
  const kinds: TraceVisualKind[] = [
    "observed",
    "inference",
    "decision",
    "authorization",
    "effect",
    "runtime",
    "failure",
  ];
  return (
    <div className="visual-legend" aria-label="Trace kind legend">
      {kinds.map((kind) => (
        <span key={kind} className={`legend-${kind}`}>
          {visualKindLabel(kind)}
        </span>
      ))}
    </div>
  );
}

function EmptyDashboard() {
  return (
    <section className="empty-dashboard panel">
      <div className="empty-radar" aria-hidden="true">
        <Activity size={29} />
      </div>
      <span className="section-kicker">No run selected</span>
      <h2>Create a file to see how PANDA works.</h2>
      <p>
        PANDA will show each check, decision, file write, and verification here
        in the order it happened.
      </p>
    </section>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const Icon = state === "connected" ? Wifi : WifiOff;
  return (
    <span className={`connection-badge ${state}`}>
      <Icon size={14} />
      {state === "connected"
        ? "Live records"
        : state === "connecting"
          ? "Connecting"
          : "Trace reads only"}
    </span>
  );
}

function StatusBadge({ status }: { status: PandaExecutionView["status"] }) {
  const Icon =
    status === "succeeded"
      ? CheckCircle2
      : status === "failed" || status === "cancelled"
        ? XCircle
        : Clock3;
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={12} />
      {status}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function visualKindLabel(kind: TraceVisualKind): string {
  const labels: Record<TraceVisualKind, string> = {
    observed: "Observed fact",
    inference: "Inference",
    decision: "Decision",
    authorization: "Authorization",
    effect: "External effect",
    failure: "Failure",
    runtime: "Runtime control",
  };
  return labels[kind];
}

function errorMessage(error: unknown): string {
  if (error instanceof PandaRequestError) {
    return `${error.detail.code}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return "The dashboard could not read canonical daemon state.";
}

function answerOperatorQuestion(
  trace: readonly StoredPandaTraceRecord[],
  question: string,
): OperatorAnswer {
  const normalized = question.toLowerCase();
  const insights = executionInsights(trace);
  const byId = new Map(insights.map((insight) => [insight.id, insight]));
  const analysisRecord = orderTrace(trace).find(
    (record) => record.category === "assessment",
  );

  if (/analysis|assess|conclude|finding/.test(normalized)) {
    const payload = analysisRecord?.payload;
    return {
      label: "Analysis conclusion",
      value:
        isObjectRecord(payload) && typeof payload.summary === "string"
          ? payload.summary
          : "No Analysis assessment is stored for this run.",
      detail:
        isObjectRecord(payload) && typeof payload.method === "string"
          ? `Method · ${payload.method}`
          : undefined,
      sourceSequence: analysisRecord?.sequence,
    };
  }

  const id = /decision|why|choose|selected|option/.test(normalized)
    ? "decision"
    : /authoriz|policy|allow|deny|safe/.test(normalized)
      ? "authorization"
      : /verify|verified|success|result|goal|end/.test(normalized)
        ? "verification"
        : /effect|occur|happen|wrote|filesystem/.test(normalized)
          ? "effect"
          : /action|execute|connector/.test(normalized)
            ? "request"
            : /route|flow|step|through|capabilit/.test(normalized)
              ? "route"
              : "input";
  const answer = byId.get(id);
  return answer === undefined
    ? { label: "Stored evidence", value: "Not recorded" }
    : {
        label: answer.label,
        value: answer.value,
        detail: answer.detail,
        sourceSequence: answer.sourceSequence,
      };
}

function executionDecisions(
  trace: readonly StoredPandaTraceRecord[],
): ExecutionDecisionView[] {
  return orderTrace(trace).flatMap((record) => {
    if (record.category !== "decision" || !isObjectRecord(record.payload)) {
      return [];
    }
    const selected = record.payload.selectedOption;
    const alternatives = record.payload.alternatives;
    const evidence = record.payload.decisiveEvidence;
    return [
      {
        sequence: record.sequence,
        selectedOption:
          isObjectRecord(selected) && typeof selected.description === "string"
            ? selected.description
            : "Selected option not recorded",
        rationale:
          typeof record.payload.rationale === "string"
            ? record.payload.rationale
            : "Rationale not recorded",
        alternatives: Array.isArray(alternatives)
          ? alternatives.flatMap((alternative) =>
              isObjectRecord(alternative) &&
              typeof alternative.description === "string"
                ? [alternative.description]
                : [],
            )
          : [],
        constraints: Array.isArray(record.payload.decisiveConstraints)
          ? record.payload.decisiveConstraints.filter(
              (constraint): constraint is string =>
                typeof constraint === "string",
            )
          : [],
        evidence: Array.isArray(evidence)
          ? evidence.flatMap((item) => {
              if (!isObjectRecord(item) || typeof item.id !== "string") {
                return [];
              }
              return [
                typeof item.description === "string"
                  ? `${item.description} · ${item.id}`
                  : item.id,
              ];
            })
          : [],
      },
    ];
  });
}

function isDashboardSignalEvent(event: PandaEvent): boolean {
  if (!isObjectRecord(event.payload)) return false;
  if (event.payload.category !== "signal") return false;
  const signal = event.payload.payload;
  return isObjectRecord(signal) && signal.source === "dashboard";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeExecutions(
  executions: readonly PandaExecutionView[],
): ExecutionSummary {
  let active = 0;
  let waiting = 0;
  let succeeded = 0;
  let failed = 0;
  let latestUpdate: string | undefined;

  for (const view of executions) {
    if (view.status === "pending" || view.status === "running") active += 1;
    if (view.status === "waiting") waiting += 1;
    if (view.status === "succeeded") succeeded += 1;
    if (view.status === "failed" || view.status === "cancelled") failed += 1;
    if (
      latestUpdate === undefined ||
      view.execution.updatedAt.localeCompare(latestUpdate) > 0
    ) {
      latestUpdate = view.execution.updatedAt;
    }
  }

  return {
    active,
    waiting,
    succeeded,
    failed,
    total: executions.length,
    latestUpdate,
  };
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function shortId(id: string): string {
  return id.length > 23 ? `${id.slice(0, 12)}…${id.slice(-7)}` : id;
}

function formatExpected(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "not recorded" : serialized;
}
