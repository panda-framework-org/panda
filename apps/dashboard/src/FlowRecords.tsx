import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { PandaClient, PandaRequestError } from "@panda/sdk";
import type {
  FlowRecord,
  FlowRecordCreateInput,
} from "@panda/shared";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Check,
  Database,
  Eye,
  GitBranch,
  Network,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";

const STORAGE_KEY = "panda.flow-records.v1";

type FlowField =
  | "perception"
  | "analysis"
  | "network"
  | "decision"
  | "action";

type FlowFormValue = FlowRecordCreateInput;

interface FlowStepDefinition {
  readonly key: FlowField;
  readonly label: string;
  readonly prompt: string;
  readonly placeholder: string;
  readonly Icon: LucideIcon;
}

const FLOW_STEPS: FlowStepDefinition[] = [
  {
    key: "perception",
    label: "Perception",
    prompt: "What did you observe?",
    placeholder: "Describe the signal, event, or input you received…",
    Icon: Eye,
  },
  {
    key: "analysis",
    label: "Analysis",
    prompt: "What does it mean?",
    placeholder: "Capture your interpretation, context, or key findings…",
    Icon: BrainCircuit,
  },
  {
    key: "network",
    label: "Network",
    prompt: "Who or what is involved?",
    placeholder: "List people, systems, dependencies, or connections…",
    Icon: Network,
  },
  {
    key: "decision",
    label: "Decision",
    prompt: "What did you choose?",
    placeholder: "Record the decision and why it was selected…",
    Icon: GitBranch,
  },
  {
    key: "action",
    label: "Action",
    prompt: "What happens next?",
    placeholder: "Describe the action, owner, or next step…",
    Icon: Zap,
  },
];

const EMPTY_FORM: FlowFormValue = {
  title: "",
  perception: "",
  analysis: "",
  network: "",
  decision: "",
  action: "",
};

export function FlowRecords() {
  const client = useMemo(() => new PandaClient(), []);
  const [records, setRecords] = useState<FlowRecord[]>([]);
  const [form, setForm] = useState<FlowFormValue>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string>();
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const loadDatabaseRecords = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      let storedRecords = await client.listFlowRecords();
      const legacyRecords = loadLegacyRecords();
      if (legacyRecords.length > 0) {
        storedRecords = await client.importFlowRecords(legacyRecords);
        window.localStorage.removeItem(STORAGE_KEY);
        setNotice(
          `${legacyRecords.length} browser-saved ${legacyRecords.length === 1 ? "record" : "records"} moved to SQLite`,
        );
      }
      setRecords(storedRecords);
    } catch (loadError) {
      setError(describeRequestError(loadError, "Could not load flow records."));
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadDatabaseRecords();
  }, [loadDatabaseRecords]);

  useEffect(() => {
    document.title = "Flow Records · PANDA";
    return () => {
      document.title = "PANDA Dashboard";
    };
  }, []);

  useEffect(() => {
    if (notice === undefined) return;
    const timeout = window.setTimeout(() => setNotice(undefined), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length === 0) return records;
    return records.filter((record) =>
      [
        record.title,
        record.perception,
        record.analysis,
        record.network,
        record.decision,
        record.action,
      ].some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [query, records]);

  const formIsComplete =
    form.title.trim().length > 0 &&
    FLOW_STEPS.every(({ key }) => form[key].trim().length > 0);

  function updateForm(field: keyof FlowFormValue, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(undefined);
  }

  async function saveRecord() {
    if (!formIsComplete || isSaving) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const input = trimForm(form);
      const saved =
        editingId === undefined
          ? await client.createFlowRecord(input)
          : await client.updateFlowRecord(editingId, input);
      setRecords((current) => [
        saved,
        ...current.filter((record) => record.id !== saved.id),
      ]);
      setNotice(
        editingId === undefined ? "Flow record created" : "Flow record updated",
      );
      resetForm();
    } catch (saveError) {
      setError(describeRequestError(saveError, "Could not save the flow record."));
    } finally {
      setIsSaving(false);
    }
  }

  function editRecord(record: FlowRecord) {
    setForm({
      title: record.title,
      perception: record.perception,
      analysis: record.analysis,
      network: record.network,
      decision: record.decision,
      action: record.action,
    });
    setEditingId(record.id);
    setPendingDeleteId(undefined);
    window.requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  async function deleteRecord(id: string) {
    if (deletingId !== undefined) return;
    setDeletingId(id);
    setError(undefined);
    try {
      await client.deleteFlowRecord(id);
      setRecords((current) => current.filter((record) => record.id !== id));
      setPendingDeleteId(undefined);
      if (editingId === id) resetForm();
      setNotice("Flow record deleted");
    } catch (deleteError) {
      setError(
        describeRequestError(deleteError, "Could not delete the flow record."),
      );
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <main className="app-shell flow-records-page">
      <header className="topbar flow-records-topbar">
        <a className="brand-lockup brand-link" href="#/" aria-label="PANDA home">
          <span className="brand-mark" aria-hidden="true">
            <Activity size={18} />
          </span>
          <span>
            <span className="brand-name">PANDA</span>
            <span className="brand-subtitle">Execution observatory</span>
          </span>
        </a>
        <nav className="app-navigation" aria-label="Main navigation">
          <a href="#/">Home</a>
          <a href="#/browser-companion">Browser companion</a>
          <a className="active" href="#/flow-records" aria-current="page">
            <Database size={14} /> Flow records
          </a>
        </nav>
      </header>

      <section className="flow-records-hero">
        <div>
          <a className="back-link" href="#/">
            <ArrowLeft size={14} /> Back to dashboard
          </a>
          <div className="eyebrow">
            <Database size={13} /> Structured knowledge log
          </div>
          <h1>Turn thinking into a traceable flow.</h1>
          <p>
            Capture what you perceived, how you analyzed it, the network around
            it, the decision you made, and the action that followed.
          </p>
        </div>
        <div className="flow-record-count" aria-label={`${records.length} saved records`}>
          <span>{records.length.toString().padStart(2, "0")}</span>
          <small>saved {records.length === 1 ? "record" : "records"}</small>
        </div>
      </section>

      <section className="flow-step-map" aria-label="Data flow">
        {FLOW_STEPS.map(({ key, label, Icon }, index) => (
          <div className="flow-step-map-item" key={key}>
            <div className={`flow-step-chip flow-step-${key}`}>
              <span>
                <Icon size={16} />
              </span>
              <small>0{index + 1}</small>
              <strong>{label}</strong>
            </div>
            {index < FLOW_STEPS.length - 1 && (
              <ArrowRight className="flow-step-arrow" size={16} aria-hidden="true" />
            )}
          </div>
        ))}
      </section>

      <section className="flow-records-layout">
        <div className="flow-entry-panel panel" ref={formRef}>
          <div className="flow-entry-heading">
            <div>
              <span className="section-kicker">
                {editingId === undefined ? "New record" : "Editing record"}
              </span>
              <h2>
                {editingId === undefined ? "Capture a complete flow" : "Update this flow"}
              </h2>
            </div>
            {editingId !== undefined && (
              <button className="flow-icon-button" type="button" onClick={resetForm}>
                <X size={16} />
                <span className="sr-only">Cancel editing</span>
              </button>
            )}
          </div>

          <form
            className="flow-entry-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveRecord();
            }}
          >
            <label className="flow-title-field" htmlFor="flow-title">
              <span>Record name</span>
              <input
                id="flow-title"
                value={form.title}
                onChange={(event) => updateForm("title", event.target.value)}
                placeholder="e.g. Investigate customer login issue"
                autoComplete="off"
                required
              />
            </label>

            <div className="flow-form-steps">
              {FLOW_STEPS.map(({ key, label, prompt, placeholder, Icon }, index) => (
                <label className={`flow-form-step flow-step-${key}`} key={key} htmlFor={`flow-${key}`}>
                  <span className="flow-form-marker">
                    <Icon size={16} />
                  </span>
                  <span className="flow-form-copy">
                    <span className="flow-form-label">
                      <span>0{index + 1} · {label}</span>
                      <small>{prompt}</small>
                    </span>
                    <textarea
                      id={`flow-${key}`}
                      value={form[key]}
                      onChange={(event) => updateForm(key, event.target.value)}
                      placeholder={placeholder}
                      rows={3}
                      required
                    />
                  </span>
                </label>
              ))}
            </div>

            <div className="flow-form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={!formIsComplete || isSaving}
              >
                {editingId === undefined ? <Plus size={15} /> : <Save size={15} />}
                {isSaving
                  ? "Saving…"
                  : editingId === undefined
                    ? "Create record"
                    : "Save changes"}
              </button>
              <button className="button button-quiet" type="button" onClick={resetForm}>
                <RotateCcw size={14} /> Clear
              </button>
              {!formIsComplete && (
                <span className="flow-required-note">Complete all fields to save</span>
              )}
            </div>
          </form>
        </div>

        <div className="flow-record-list-panel">
          <div className="flow-list-heading">
            <div>
              <span className="section-kicker">Saved records</span>
              <h2>Your flow history</h2>
            </div>
            <span className="count-pill">{records.length}</span>
          </div>

          {error !== undefined && (
            <div className="flow-api-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void loadDatabaseRecords()}>
                Try again
              </button>
            </div>
          )}

          <label className="flow-search" htmlFor="flow-search">
            <Search size={15} />
            <input
              id="flow-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search every step…"
            />
            {query.length > 0 && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>

          <div className="flow-record-list" aria-live="polite">
            {isLoading ? (
              <FlowLoadingState />
            ) : filteredRecords.length === 0 ? (
              <FlowEmptyState hasRecords={records.length > 0} query={query} />
            ) : (
              filteredRecords.map((record) => (
                <FlowRecordCard
                  key={record.id}
                  record={record}
                  confirmingDelete={pendingDeleteId === record.id}
                  deleting={deletingId === record.id}
                  onEdit={() => editRecord(record)}
                  onRequestDelete={() => setPendingDeleteId(record.id)}
                  onCancelDelete={() => setPendingDeleteId(undefined)}
                  onDelete={() => void deleteRecord(record.id)}
                />
              ))
            )}
          </div>
        </div>
      </section>

      {notice !== undefined && (
        <div className="flow-notice" role="status">
          <Check size={15} /> {notice}
        </div>
      )}
    </main>
  );
}

function FlowRecordCard({
  record,
  confirmingDelete,
  deleting,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onDelete,
}: {
  record: FlowRecord;
  confirmingDelete: boolean;
  deleting: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="flow-record-card panel">
      <header className="flow-record-card-header">
        <div>
          <span>{formatDate(record.updatedAt)}</span>
          <h3>{record.title}</h3>
        </div>
        <div className="flow-card-actions">
          <button type="button" onClick={onEdit} aria-label={`Edit ${record.title}`}>
            <Pencil size={14} /> Edit
          </button>
          <button className="danger" type="button" onClick={onRequestDelete} aria-label={`Delete ${record.title}`}>
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="flow-record-details">
        {FLOW_STEPS.map(({ key, label, Icon }, index) => (
          <div className={`flow-record-detail flow-step-${key}`} key={key}>
            <span className="flow-record-detail-marker">
              <Icon size={14} />
            </span>
            <div>
              <small>0{index + 1} · {label}</small>
              <p>{record[key]}</p>
            </div>
          </div>
        ))}
      </div>

      {confirmingDelete && (
        <div className="flow-delete-confirm" role="alert">
          <span>Delete this record? This can’t be undone.</span>
          <div>
            <button type="button" onClick={onCancelDelete} disabled={deleting}>
              Cancel
            </button>
            <button
              className="confirm"
              type="button"
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete record"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function FlowLoadingState() {
  return (
    <div className="flow-empty-state" aria-label="Loading flow records">
      <span><Database size={21} /></span>
      <h3>Loading database records…</h3>
      <p>Reading the durable flow history from the PANDA daemon.</p>
    </div>
  );
}

function FlowEmptyState({ hasRecords, query }: { hasRecords: boolean; query: string }) {
  return (
    <div className="flow-empty-state">
      <span><Database size={21} /></span>
      <h3>{hasRecords ? "No matching records" : "No flow records yet"}</h3>
      <p>
        {hasRecords
          ? `Nothing matches “${query}”. Try a different search.`
          : "Complete the five-step form to create your first record."}
      </p>
    </div>
  );
}

function trimForm(form: FlowFormValue): FlowFormValue {
  return {
    title: form.title.trim(),
    perception: form.perception.trim(),
    analysis: form.analysis.trim(),
    network: form.network.trim(),
    decision: form.decision.trim(),
    action: form.action.trim(),
  };
}

function loadLegacyRecords(): FlowRecord[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFlowRecord).sort((first, second) =>
      second.updatedAt.localeCompare(first.updatedAt),
    );
  } catch {
    return [];
  }
}

function isFlowRecord(value: unknown): value is FlowRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return [
    "id",
    "title",
    "perception",
    "analysis",
    "network",
    "decision",
    "action",
    "createdAt",
    "updatedAt",
  ].every((key) => typeof record[key] === "string");
}

function describeRequestError(error: unknown, fallback: string): string {
  if (error instanceof PandaRequestError) return error.detail.message;
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return fallback;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
