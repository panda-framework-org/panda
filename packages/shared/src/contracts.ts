import { createId, nowIso } from "./identifiers.js";

export const PANDA_SCHEMA_VERSION = "0.1" as const;

export const PANDA_CAPABILITIES = Object.freeze([
  "perception",
  "analysis",
  "network",
  "decision",
  "action",
] as const);

export type PandaCapability = (typeof PANDA_CAPABILITIES)[number];
export type PandaSchemaVersion = typeof PANDA_SCHEMA_VERSION;

export type RecordProducer =
  | { kind: "capability"; capability: PandaCapability }
  | { kind: "connector"; connectorId: string }
  | { kind: "runtime"; component: string };

/** Identity carried by every material PANDA v0.1 contract record. */
export interface CanonicalRecord {
  readonly id: string;
  readonly schemaVersion: PandaSchemaVersion;
  readonly executionId: string;
  readonly goalId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly producer: RecordProducer;
  readonly timestamp: string;
}

export type CanonicalRecordInput<TRecord extends CanonicalRecord> = Omit<
  TRecord,
  "id" | "schemaVersion" | "timestamp"
> &
  Partial<Pick<TRecord, "id" | "schemaVersion" | "timestamp">>;

type KindedRecord = CanonicalRecord & { readonly kind: string };
type KindedRecordInput<TRecord extends KindedRecord> = Omit<
  CanonicalRecordInput<TRecord>,
  "kind"
>;

export function createCanonicalRecord<TRecord extends CanonicalRecord>(
  prefix: string,
  input: CanonicalRecordInput<TRecord>,
): TRecord {
  return {
    ...input,
    id: input.id ?? createId(prefix),
    schemaVersion: input.schemaVersion ?? PANDA_SCHEMA_VERSION,
    timestamp: input.timestamp ?? nowIso(),
  } as TRecord;
}

export interface PrincipalReference {
  readonly id: string;
  readonly type: "human" | "service" | "system";
}

export interface ExecutionContext extends CanonicalRecord {
  readonly invocationId?: string;
  readonly activeCapability?: PandaCapability;
  readonly deadline?: string;
  readonly principal?: PrincipalReference;
  readonly invocationHistory: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}

export function createExecutionContext(
  input: CanonicalRecordInput<ExecutionContext>,
): ExecutionContext {
  return createCanonicalRecord("ctx", input);
}

export type GoalStatus =
  | "pending"
  | "active"
  | "suspended"
  | "awaiting-human"
  | "achieved"
  | "failed"
  | "cancelled";

export interface GoalCriterion {
  readonly id: string;
  readonly description: string;
  readonly evidenceType?: string;
  readonly expected?: unknown;
}

export interface Goal extends CanonicalRecord {
  readonly kind: "goal";
  readonly revision: number;
  readonly objective: string;
  readonly priority: number;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly GoalCriterion[];
  readonly failureCriteria: readonly GoalCriterion[];
  readonly status: GoalStatus;
  readonly owner: PrincipalReference;
  readonly parentGoalId?: string;
  readonly dependencyGoalIds: readonly string[];
  readonly deadline?: string;
  readonly statusReason?: string;
}

export type GoalInput = Omit<
  KindedRecordInput<Goal>,
  "goalId" | "revision"
> & {
  readonly goalId?: string;
  readonly revision?: number;
};

export function createGoal(input: GoalInput): Goal {
  const goalId = input.goalId ?? input.id ?? createId("goal");

  return createCanonicalRecord("goal", {
    ...input,
    id: input.id ?? goalId,
    goalId,
    revision: input.revision ?? 0,
    kind: "goal",
  });
}

export type ExecutionStatus =
  | "pending"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TerminalOutcome = "succeeded" | "failed" | "cancelled";

export interface PandaExecution extends CanonicalRecord {
  readonly kind: "execution";
  readonly status: ExecutionStatus;
  readonly activeCapability?: PandaCapability;
  readonly goalIds: readonly string[];
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly deadline?: string;
  readonly terminalOutcome?: TerminalOutcome;
  readonly statusReason?: string;
}

export type PandaExecutionInput = Omit<
  KindedRecordInput<PandaExecution>,
  "executionId"
> & {
  readonly executionId?: string;
};

export function createPandaExecution(input: PandaExecutionInput): PandaExecution {
  const executionId = input.executionId ?? input.id ?? createId("exe");

  return createCanonicalRecord("exe", {
    ...input,
    id: input.id ?? executionId,
    executionId,
    kind: "execution",
  });
}

export interface Provenance {
  readonly kind: "human" | "system" | "connector" | "capability" | "external";
  readonly sourceId: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface Signal<TPayload = unknown> extends CanonicalRecord {
  readonly kind: "signal";
  readonly type: string;
  readonly source: string;
  readonly occurredAt?: string;
  readonly receivedAt: string;
  readonly provenance: Provenance;
  readonly payload: TPayload;
}

export function createSignal<TPayload>(
  input: KindedRecordInput<Signal<TPayload>>,
): Signal<TPayload> {
  return createCanonicalRecord("sig", { ...input, kind: "signal" });
}

export type ValidationStatus =
  | "valid"
  | "invalid"
  | "incomplete"
  | "stale"
  | "duplicate"
  | "unvalidated";

export interface Observation<TPayload = unknown> extends CanonicalRecord {
  readonly kind: "observation";
  readonly type: string;
  readonly source: string;
  readonly observedAt?: string;
  readonly receivedAt: string;
  readonly confidence?: number;
  readonly quality?: number;
  readonly uncertainty?: string;
  readonly validationStatus: ValidationStatus;
  readonly provenance: Provenance;
  readonly payload: TPayload;
}

export function createObservationRecord<TPayload>(
  input: KindedRecordInput<Observation<TPayload>>,
): Observation<TPayload> {
  return createCanonicalRecord("obs", { ...input, kind: "observation" });
}

export interface EvidenceReference {
  readonly id: string;
  readonly kind: "record" | "artifact" | "fact" | "measurement" | "policy";
  readonly description?: string;
  readonly uri?: string;
  readonly contentHash?: string;
}

export interface InformationNeed {
  readonly field: string;
  readonly reason: string;
  readonly required: boolean;
}

export interface AssessmentOption<TValue = unknown> {
  readonly id: string;
  readonly description: string;
  readonly value?: TValue;
}

export interface Assessment<TResult = unknown, TOption = unknown>
  extends CanonicalRecord {
  readonly kind: "assessment";
  readonly summary: string;
  readonly method: string;
  readonly confidence: number;
  readonly evidence: readonly EvidenceReference[];
  readonly assumptions: readonly string[];
  readonly informationNeeds: readonly InformationNeed[];
  readonly options: readonly AssessmentOption<TOption>[];
  readonly result: TResult;
}

export function createAssessment<TResult, TOption = unknown>(
  input: KindedRecordInput<Assessment<TResult, TOption>>,
): Assessment<TResult, TOption> {
  return createCanonicalRecord("asm", { ...input, kind: "assessment" });
}

export interface DecisionOption<TIntent = unknown> {
  readonly id: string;
  readonly description: string;
  readonly intent?: TIntent;
}

export interface Decision<TIntent = unknown> extends CanonicalRecord {
  readonly kind: "decision";
  readonly selectedOption: DecisionOption<TIntent>;
  readonly alternatives: readonly DecisionOption<TIntent>[];
  readonly decisiveEvidence: readonly EvidenceReference[];
  readonly decisiveConstraints: readonly string[];
  readonly rationale: string;
  readonly nextStep: NextStep;
}

export function createDecision<TIntent>(
  input: KindedRecordInput<Decision<TIntent>>,
): Decision<TIntent> {
  return createCanonicalRecord("dec", { ...input, kind: "decision" });
}

export interface AuthorizationReference {
  readonly policyId: string;
  readonly evaluationId?: string;
  readonly approvalId?: string;
}

export interface ActionRequest<TParameters = unknown> extends CanonicalRecord {
  readonly kind: "action-request";
  readonly actionType: string;
  readonly target: string;
  readonly connectorId: string;
  readonly parameters: TParameters;
  readonly authorization?: AuthorizationReference;
  readonly idempotencyKey: string;
  readonly timeoutMs?: number;
}

export function createActionRequest<TParameters>(
  input: KindedRecordInput<ActionRequest<TParameters>>,
): ActionRequest<TParameters> {
  return createCanonicalRecord("actreq", { ...input, kind: "action-request" });
}

export type OutcomeStatus =
  | "succeeded"
  | "failed"
  | "rejected"
  | "cancelled"
  | "timeout"
  | "indeterminate"
  | "partial";

export type EffectStatus =
  | "none"
  | "attempted"
  | "completed"
  | "partial"
  | "unknown";

export interface OutcomeError {
  readonly code: string;
  readonly message: string;
}

export interface Outcome<TData = unknown, TEffect = unknown>
  extends CanonicalRecord {
  readonly kind: "outcome";
  readonly actionRequestId: string;
  readonly status: OutcomeStatus;
  readonly effectStatus: EffectStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly data?: TData;
  readonly observedEffect?: TEffect;
  readonly error?: OutcomeError;
}

export function createOutcome<TData = unknown, TEffect = unknown>(
  input: KindedRecordInput<Outcome<TData, TEffect>>,
): Outcome<TData, TEffect> {
  return createCanonicalRecord("out", { ...input, kind: "outcome" });
}

export type FailureCategory =
  | "perception"
  | "analysis"
  | "network"
  | "decision"
  | "action"
  | "connector"
  | "policy-violation"
  | "timeout"
  | "cancellation"
  | "invalid-contract"
  | "conflict"
  | "internal-runtime";

export interface FailureCause {
  readonly failureId?: string;
  readonly code?: string;
  readonly message: string;
}

export interface Failure<TPartialResult = unknown> extends CanonicalRecord {
  readonly kind: "failure";
  readonly category: FailureCategory;
  readonly failedOperation: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: FailureCause;
  readonly evidence: readonly EvidenceReference[];
  readonly effectStatus: EffectStatus;
  readonly partialResult?: TPartialResult;
}

export function createFailure<TPartialResult = unknown>(
  input: KindedRecordInput<Failure<TPartialResult>>,
): Failure<TPartialResult> {
  return createCanonicalRecord("fail", { ...input, kind: "failure" });
}

export type NextStep =
  | {
      readonly kind: "invoke";
      readonly target: PandaCapability;
      readonly reason: string;
      readonly payloadRef?: string;
    }
  | { readonly kind: "wait"; readonly reason: string; readonly resumeOn?: string }
  | {
      readonly kind: "terminate";
      readonly outcome: TerminalOutcome;
      readonly reason: string;
    };

export interface TransitionRequest extends CanonicalRecord {
  readonly kind: "transition-request";
  readonly sourceCapability: PandaCapability;
  readonly sourceInvocationId: string;
  readonly triggerId: string;
  readonly nextStep: NextStep;
}

export function createTransitionRequest(
  input: KindedRecordInput<TransitionRequest>,
): TransitionRequest {
  return createCanonicalRecord("trnreq", { ...input, kind: "transition-request" });
}

export type PolicyEvaluationPoint = "transition" | "effect";
export type PolicyEvaluationResult = "allow" | "deny" | "require";

export interface PolicyEvaluation extends CanonicalRecord {
  readonly kind: "policy-evaluation";
  readonly point: PolicyEvaluationPoint;
  readonly policyId: string;
  readonly result: PolicyEvaluationResult;
  readonly reason: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}

export function createPolicyEvaluation(
  input: KindedRecordInput<PolicyEvaluation>,
): PolicyEvaluation {
  return createCanonicalRecord("pol", { ...input, kind: "policy-evaluation" });
}

export interface ConnectorInvocation extends CanonicalRecord {
  readonly kind: "connector-invocation";
  readonly connectorId: string;
  readonly actionRequestId: string;
  readonly status: "completed" | "failed";
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outcomeId?: string;
}

export function createConnectorInvocation(
  input: KindedRecordInput<ConnectorInvocation>,
): ConnectorInvocation {
  return createCanonicalRecord("conninv", {
    ...input,
    kind: "connector-invocation",
  });
}

export interface PolicyEvaluationSummary {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly result: PolicyEvaluationResult;
  readonly reason: string;
}

export interface TransitionRecord extends CanonicalRecord {
  readonly kind: "transition-record";
  readonly requestId: string;
  readonly sourceCapability: PandaCapability;
  readonly sourceInvocationId: string;
  readonly triggerId: string;
  readonly nextStep: NextStep;
  readonly policy?: PolicyEvaluationSummary;
  readonly status: "committed" | "rejected";
  readonly rejectionReason?: string;
}

export function createTransitionRecord(
  input: KindedRecordInput<TransitionRecord>,
): TransitionRecord {
  return createCanonicalRecord("trn", { ...input, kind: "transition-record" });
}

export type TraceCategory =
  | "signal"
  | "goal"
  | "goal-status"
  | "capability-invocation"
  | "observation"
  | "assessment"
  | "decision"
  | "transition"
  | "policy-evaluation"
  | "action-request"
  | "connector-invocation"
  | "outcome"
  | "failure"
  | "wait"
  | "termination";

export interface TraceRecord<TPayload = unknown> extends CanonicalRecord {
  readonly kind: "trace-record";
  readonly category: TraceCategory;
  readonly type: string;
  readonly payload: TPayload;
  /** Assigned by the Phase 2 execution store. */
  readonly sequence?: number;
}

export type StoredPandaTraceRecord<TPayload = unknown> = TraceRecord<TPayload> & {
  readonly sequence: number;
};

export function createTraceRecord<TPayload>(
  input: KindedRecordInput<TraceRecord<TPayload>>,
): TraceRecord<TPayload> {
  return createCanonicalRecord("trace", { ...input, kind: "trace-record" });
}

export const PANDA_V01_EXECUTION_REQUEST_TYPE = "demo.file.requested" as const;

export interface PandaExecutionCreateInput {
  readonly type?: typeof PANDA_V01_EXECUTION_REQUEST_TYPE;
  readonly source?: string;
  readonly payload: {
    readonly path?: string;
    readonly content?: string;
  };
}

export interface PandaExecutionView {
  readonly executionId: string;
  readonly status: ExecutionStatus;
  readonly execution: PandaExecution;
  readonly goal: Goal;
  readonly outcome?: Outcome;
  readonly verification?: Assessment;
  readonly traceUrl: string;
}

export interface FlowRecordFields {
  readonly title: string;
  readonly perception: string;
  readonly analysis: string;
  readonly network: string;
  readonly decision: string;
  readonly action: string;
}

export interface FlowRecord extends FlowRecordFields {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type FlowRecordCreateInput = FlowRecordFields;
export type FlowRecordUpdateInput = FlowRecordFields;

export interface FlowRecordImportInput {
  readonly records: readonly FlowRecord[];
}

export type PandaApiAuthenticationMode = "none" | "bearer";

export interface PandaHealthResponse {
  readonly ok: boolean;
  readonly name: string;
  readonly version: string;
  readonly persistence: "file" | "memory";
  readonly flowRecordsPersistence: "sqlite";
  readonly authentication: PandaApiAuthenticationMode;
}

export interface PandaApiErrorDetail {
  readonly code: string;
  readonly message: string;
  readonly issues?: Readonly<Record<string, readonly string[] | undefined>>;
}

export interface PandaApiErrorResponse {
  readonly error: PandaApiErrorDetail;
}
