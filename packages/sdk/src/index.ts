import type {
  FlowRecord,
  FlowRecordCreateInput,
  FlowRecordUpdateInput,
  PandaApiErrorDetail,
  PandaApiErrorResponse,
  PandaExecutionCreateInput,
  PandaExecutionView,
  PandaHealthResponse,
  StoredPandaTraceRecord,
} from "@panda/shared";

export type {
  Assessment,
  FlowRecord,
  FlowRecordCreateInput,
  FlowRecordUpdateInput,
  Goal,
  Outcome,
  PandaApiErrorDetail,
  PandaApiErrorResponse,
  PandaExecution,
  PandaExecutionCreateInput,
  PandaExecutionView,
  PandaHealthResponse,
  StoredPandaTraceRecord,
} from "@panda/shared";

export interface PandaClientOptions {
  baseUrl?: string;
  apiToken?: string;
}

export class PandaRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: PandaApiErrorDetail,
  ) {
    super(detail.message);
    this.name = "PandaRequestError";
  }
}

export class PandaClient {
  private readonly baseUrl: string;
  private readonly apiToken?: string;

  constructor(options: PandaClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://127.0.0.1:4317").replace(
      /\/$/,
      "",
    );
    if (options.apiToken !== undefined && options.apiToken.trim() === "") {
      throw new TypeError("The PANDA API token must not be empty.");
    }
    this.apiToken = options.apiToken;
  }

  async health() {
    return this.request<PandaHealthResponse>("/health");
  }

  async listExecutions() {
    return this.request<PandaExecutionView[]>("/executions");
  }

  async createExecution(input: PandaExecutionCreateInput) {
    return this.request<PandaExecutionView>("/executions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getExecution(id: string) {
    return this.request<PandaExecutionView>(
      `/executions/${encodeURIComponent(id)}`,
    );
  }

  async getExecutionTrace(id: string) {
    return this.request<StoredPandaTraceRecord[]>(
      `/executions/${encodeURIComponent(id)}/trace`,
    );
  }

  async listFlowRecords() {
    return this.request<FlowRecord[]>("/flow-records");
  }

  async createFlowRecord(input: FlowRecordCreateInput) {
    return this.request<FlowRecord>("/flow-records", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateFlowRecord(id: string, input: FlowRecordUpdateInput) {
    return this.request<FlowRecord>(
      `/flow-records/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      },
    );
  }

  async deleteFlowRecord(id: string) {
    return this.request<void>(`/flow-records/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async importFlowRecords(records: readonly FlowRecord[]) {
    return this.request<FlowRecord[]>("/flow-records/import", {
      method: "POST",
      body: JSON.stringify({ records }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (this.apiToken !== undefined) {
      headers.set("authorization", `Bearer ${this.apiToken}`);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await readError(response);
      throw new PandaRequestError(response.status, body.error);
    }

    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }
}

async function readError(response: Response): Promise<PandaApiErrorResponse> {
  try {
    const body = (await response.json()) as Partial<PandaApiErrorResponse>;
    if (
      body.error !== undefined &&
      typeof body.error.code === "string" &&
      typeof body.error.message === "string"
    ) {
      return body as PandaApiErrorResponse;
    }
  } catch {
    // Fall through to a stable client-side representation.
  }
  return {
    error: {
      code: "PANDA_REQUEST_FAILED",
      message: `PANDA request failed: ${response.status} ${response.statusText}`,
    },
  };
}
