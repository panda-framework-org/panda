import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import {
  PANDA_V01_EXECUTION_REQUEST_TYPE,
  nowIso,
  type PandaApiErrorResponse,
  type PandaEvent,
  type PandaHealthResponse,
  type PrincipalReference,
} from "@panda/shared";
import {
  PandaDaemonRuntime,
  type PandaDaemonRuntimeOptions,
} from "./execution-runtime.js";
import {
  DEFAULT_PANDA_ALLOWED_ORIGINS,
  LOCAL_API_PRINCIPAL,
  authenticateBearerAuthorization,
  normalizeAllowedOrigins,
  validateBearerAuthentication,
  type PandaBearerAuthentication,
} from "./api-security.js";
import {
  SqliteFlowRecordStore,
  type FlowRecordStore,
} from "./flow-record-store.js";

const executionSchema = z
  .object({
    type: z.literal(PANDA_V01_EXECUTION_REQUEST_TYPE).optional(),
    source: z.string().trim().min(1).optional(),
    payload: z
      .object({
        path: z.string().optional(),
        content: z.string().optional(),
      })
      .strict(),
  })
  .strict();

const flowRecordFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    perception: z.string().trim().min(1).max(10_000),
    analysis: z.string().trim().min(1).max(10_000),
    network: z.string().trim().min(1).max(10_000),
    decision: z.string().trim().min(1).max(10_000),
    action: z.string().trim().min(1).max(10_000),
  })
  .strict();

const flowRecordSchema = flowRecordFieldsSchema.extend({
  id: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const flowRecordImportSchema = z
  .object({
    records: z.array(flowRecordSchema).max(500),
  })
  .strict();

export interface PandaDaemonOptions extends PandaDaemonRuntimeOptions {
  readonly runtime?: PandaDaemonRuntime;
  readonly flowRecordStore?: FlowRecordStore;
  readonly flowRecordDatabasePath?: string;
  readonly authentication?: PandaBearerAuthentication;
  readonly allowedOrigins?: readonly string[];
}

export interface PandaDaemon {
  readonly app: FastifyInstance;
  readonly runtime: PandaDaemonRuntime;
  readonly flowRecordStore: FlowRecordStore;
}

export async function createDaemon(
  options: PandaDaemonOptions = {},
): Promise<PandaDaemon> {
  const runtime = options.runtime ?? new PandaDaemonRuntime(options);
  const flowRecordStore =
    options.flowRecordStore ??
    new SqliteFlowRecordStore({
      dataDirectory: options.dataDirectory,
      databasePath: options.flowRecordDatabasePath,
    });
  const authentication =
    options.authentication === undefined
      ? undefined
      : validateBearerAuthentication(options.authentication);
  const allowedOrigins = normalizeAllowedOrigins(
    options.allowedOrigins ?? DEFAULT_PANDA_ALLOWED_ORIGINS,
  );
  const requestPrincipals = new WeakMap<FastifyRequest, PrincipalReference>();
  const clients = new Set<{ send: (payload: string) => void }>();
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: [...allowedOrigins] });
  await app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    if (
      request.method === "OPTIONS" ||
      request.url.split("?", 1)[0] === "/health"
    ) {
      return;
    }
    if (authentication === undefined) {
      requestPrincipals.set(request, LOCAL_API_PRINCIPAL);
      return;
    }
    const principal = authenticateBearerAuthorization(
      request.headers.authorization,
      authentication,
    );
    if (principal === undefined) {
      return reply
        .header("www-authenticate", 'Bearer realm="panda-daemon"')
        .code(401)
        .send(authenticationError());
    }
    requestPrincipals.set(request, principal);
  });

  const unsubscribe = runtime.subscribe((record) => {
    const event: PandaEvent = {
      type: "execution.recorded",
      executionId: record.executionId,
      payload: record,
      createdAt: nowIso(),
    };
    const serialized = JSON.stringify(event);
    for (const client of clients) {
      try {
        client.send(serialized);
      } catch {
        clients.delete(client);
      }
    }
  });
  app.addHook("onClose", async () => unsubscribe());
  app.addHook("onClose", async () => flowRecordStore.close());

  app.get("/health", async () =>
    ({
      ok: true,
      name: "panda-daemon",
      version: "0.1.0",
      persistence: runtime.persistence,
      flowRecordsPersistence: "sqlite",
      authentication: authentication === undefined ? "none" : "bearer",
    }) satisfies PandaHealthResponse,
  );

  app.post("/executions", async (request, reply) => {
    const parsed = executionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error));
    }
    return runtime.createExecution(
      parsed.data,
      requireRequestPrincipal(request, requestPrincipals),
    );
  });

  app.get("/executions", async () => runtime.listExecutionViews());

  app.get("/executions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const view = runtime.getExecutionView(id);
    return view ?? reply.code(404).send(notFoundError(id));
  });

  app.get("/executions/:id/trace", async (request, reply) => {
    const { id } = request.params as { id: string };
    const trace = runtime.getTrace(id);
    return trace ?? reply.code(404).send(notFoundError(id));
  });

  app.get("/flow-records", async () => flowRecordStore.list());

  app.get("/flow-records/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = flowRecordStore.get(id);
    return record ?? reply.code(404).send(flowRecordNotFoundError(id));
  });

  app.post("/flow-records", async (request, reply) => {
    const parsed = flowRecordFieldsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(flowRecordValidationError(parsed.error));
    }
    return reply.code(201).send(flowRecordStore.create(parsed.data));
  });

  app.put("/flow-records/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = flowRecordFieldsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(flowRecordValidationError(parsed.error));
    }
    const updated = flowRecordStore.update(id, parsed.data);
    return updated ?? reply.code(404).send(flowRecordNotFoundError(id));
  });

  app.delete("/flow-records/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!flowRecordStore.delete(id)) {
      return reply.code(404).send(flowRecordNotFoundError(id));
    }
    return reply.code(204).send();
  });

  app.post("/flow-records/import", async (request, reply) => {
    const parsed = flowRecordImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(flowRecordValidationError(parsed.error));
    }
    return reply.code(200).send(flowRecordStore.import(parsed.data.records));
  });

  app.get("/events", { websocket: true }, (connection) => {
    clients.add(connection);
    connection.send(
      JSON.stringify({
        type: "log",
        payload: { message: "Connected to PANDA daemon events." },
        createdAt: nowIso(),
      } satisfies PandaEvent),
    );
    connection.on("close", () => clients.delete(connection));
  });

  app.setErrorHandler((error, _request, reply) => {
    const response: PandaApiErrorResponse = {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "The PANDA daemon could not complete the request.",
      },
    };
    app.log.error(error);
    return reply.code(500).send(response);
  });

  await app.ready();
  return { app, runtime, flowRecordStore };
}

function validationError(error: z.ZodError): PandaApiErrorResponse {
  return {
    error: {
      code: "INVALID_EXECUTION_INPUT",
      message: "The execution request does not match the PANDA v0.1 contract.",
      issues: error.flatten().fieldErrors,
    },
  };
}

function notFoundError(executionId: string): PandaApiErrorResponse {
  return {
    error: {
      code: "EXECUTION_NOT_FOUND",
      message: `Execution ${executionId} was not found.`,
    },
  };
}

function flowRecordValidationError(error: z.ZodError): PandaApiErrorResponse {
  return {
    error: {
      code: "INVALID_FLOW_RECORD_INPUT",
      message: "The flow record does not match the required contract.",
      issues: error.flatten().fieldErrors,
    },
  };
}

function flowRecordNotFoundError(id: string): PandaApiErrorResponse {
  return {
    error: {
      code: "FLOW_RECORD_NOT_FOUND",
      message: `Flow record ${id} was not found.`,
    },
  };
}

function authenticationError(): PandaApiErrorResponse {
  return {
    error: {
      code: "AUTHENTICATION_REQUIRED",
      message: "A valid PANDA API bearer token is required.",
    },
  };
}

function requireRequestPrincipal(
  request: FastifyRequest,
  principals: WeakMap<FastifyRequest, PrincipalReference>,
): PrincipalReference {
  const principal = principals.get(request);
  if (principal === undefined) {
    throw new Error(
      "The authenticated API principal was not attached to the request.",
    );
  }
  return principal;
}
