import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  FlowRecord,
  PandaApiErrorResponse,
  PandaEvent,
  PandaExecutionView,
  TraceRecord,
} from "@panda/shared";
import { createDaemon, type PandaDaemonOptions } from "./server.js";

const apiToken = "phase-13-server-token-with-32-characters";

async function withDaemon(
  context: test.TestContext,
  options: Omit<PandaDaemonOptions, "dataDirectory"> = {},
) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "panda-daemon-test-"));
  const daemon = await createDaemon({ dataDirectory, ...options });
  context.after(async () => {
    await daemon.app.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });
  return { ...daemon, dataDirectory };
}

test("API-created execution succeeds and exposes the authoritative trace", async (context) => {
  const { app, runtime } = await withDaemon(context);
  const createdResponse = await app.inject({
    method: "POST",
    url: "/executions",
    payload: {
      source: "daemon-integration-test",
      payload: { path: "proof.txt", content: "PANDA API completed" },
    },
  });

  assert.equal(createdResponse.statusCode, 200);
  const created = createdResponse.json<PandaExecutionView>();
  assert.equal(created.executionId, created.execution.executionId);
  assert.equal(created.status, "succeeded");
  assert.equal(created.goal.status, "achieved");
  assert.equal(created.outcome?.status, "succeeded");
  assert.equal(created.outcome?.effectStatus, "completed");
  assert.equal(
    (created.verification?.result as { status?: string }).status,
    "verified",
  );
  assert.equal(
    created.traceUrl,
    `/executions/${created.executionId}/trace`,
  );

  const detail = await app.inject({
    method: "GET",
    url: `/executions/${created.executionId}`,
  });
  const listed = await app.inject({ method: "GET", url: "/executions" });
  const trace = await app.inject({
    method: "GET",
    url: created.traceUrl,
  });
  assert.deepEqual(detail.json(), created);
  assert.deepEqual(listed.json(), [created]);
  assert.deepEqual(
    trace.json(),
    JSON.parse(
      JSON.stringify(runtime.executionStore.getTrace(created.executionId)),
    ),
  );
  assert.equal(
    (trace.json<TraceRecord[]>().at(-1)?.payload as { outcome?: string }).outcome,
    "succeeded",
  );
});

test("flow-record API persists validated CRUD and legacy imports in SQLite", async (context) => {
  const { app } = await withDaemon(context);
  const payload = {
    title: "Investigate login issue",
    perception: "Customers cannot sign in.",
    analysis: "The identity provider is timing out.",
    network: "Web app, API, and identity provider.",
    decision: "Fail over to the secondary provider.",
    action: "Enable the failover and monitor authentication.",
  };
  const createdResponse = await app.inject({
    method: "POST",
    url: "/flow-records",
    payload,
  });

  assert.equal(createdResponse.statusCode, 201);
  const created = createdResponse.json<FlowRecord>();
  assert.equal(created.title, payload.title);
  assert.equal(created.createdAt, created.updatedAt);
  assert.deepEqual(
    (await app.inject({ method: "GET", url: "/flow-records" })).json(),
    [created],
  );

  const updatedResponse = await app.inject({
    method: "PUT",
    url: `/flow-records/${created.id}`,
    payload: { ...payload, action: "Failover enabled." },
  });
  assert.equal(updatedResponse.statusCode, 200);
  assert.equal(updatedResponse.json<FlowRecord>().action, "Failover enabled.");

  const legacy: FlowRecord = {
    id: "flow-legacy-api",
    ...payload,
    title: "Imported browser record",
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:30:00.000Z",
  };
  const importedResponse = await app.inject({
    method: "POST",
    url: "/flow-records/import",
    payload: { records: [legacy, legacy] },
  });
  assert.equal(importedResponse.statusCode, 200);
  assert.equal(
    importedResponse
      .json<FlowRecord[]>()
      .filter((record) => record.id === legacy.id).length,
    1,
  );

  const invalid = await app.inject({
    method: "POST",
    url: "/flow-records",
    payload: { ...payload, decision: "" },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(
    invalid.json<PandaApiErrorResponse>().error.code,
    "INVALID_FLOW_RECORD_INPUT",
  );

  const deleted = await app.inject({
    method: "DELETE",
    url: `/flow-records/${created.id}`,
  });
  assert.equal(deleted.statusCode, 204);
  const missing = await app.inject({
    method: "GET",
    url: `/flow-records/${created.id}`,
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(
    missing.json<PandaApiErrorResponse>().error.code,
    "FLOW_RECORD_NOT_FOUND",
  );
});

test("WebSocket clients receive every committed material execution record", async (context) => {
  const { app } = await withDaemon(context);
  const socket = await app.injectWS("/events");
  const events: PandaEvent[] = [];
  const terminal = new Promise<void>((resolve) => {
    socket.on("message", (message) => {
      const event = JSON.parse(message.toString()) as PandaEvent;
      events.push(event);
      if (
        event.type === "execution.recorded" &&
        (event.payload as TraceRecord).category === "termination"
      ) {
        resolve();
      }
    });
  });

  const response = await app.inject({
    method: "POST",
    url: "/executions",
    payload: { payload: { path: "events.txt", content: "event stream" } },
  });
  const created = response.json<PandaExecutionView>();
  await terminal;
  const records = events
    .filter(
      (event) =>
        event.type === "execution.recorded" &&
        event.executionId === created.executionId,
    )
    .map((event) => event.payload as TraceRecord);

  assert.ok(records.length > 10);
  assert.deepEqual(
    records.map((record) => record.sequence),
    records.map((_record, index) => index + 1),
  );
  assert.equal(records.at(0)?.category, "signal");
  assert.equal(records.at(-1)?.category, "termination");
  socket.terminate();
});

test("concurrent executions keep identity, workspace, and trace isolated", async (context) => {
  const { app, runtime } = await withDaemon(context);
  const [firstResponse, secondResponse] = await Promise.all([
    app.inject({
      method: "POST",
      url: "/executions",
      payload: { payload: { path: "proof.txt", content: "first content" } },
    }),
    app.inject({
      method: "POST",
      url: "/executions",
      payload: { payload: { path: "proof.txt", content: "second content" } },
    }),
  ]);
  const first = firstResponse.json<PandaExecutionView>();
  const second = secondResponse.json<PandaExecutionView>();

  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "succeeded");
  assert.notEqual(first.executionId, second.executionId);
  assert.notEqual(first.goal.id, second.goal.id);
  assert.equal(
    await readFile(
      join(runtime.policyEngine.workspaceFor(first.executionId), "proof.txt"),
      "utf8",
    ),
    "first content",
  );
  assert.equal(
    await readFile(
      join(runtime.policyEngine.workspaceFor(second.executionId), "proof.txt"),
      "utf8",
    ),
    "second content",
  );
  for (const record of runtime.getTrace(first.executionId) ?? []) {
    assert.equal(record.executionId, first.executionId);
    assert.notEqual(record.executionId, second.executionId);
  }
  for (const record of runtime.getTrace(second.executionId) ?? []) {
    assert.equal(record.executionId, second.executionId);
    assert.notEqual(record.executionId, first.executionId);
  }
});

test("invalid input and unknown executions return structured client errors", async (context) => {
  const { app } = await withDaemon(context);
  const invalid = await app.inject({
    method: "POST",
    url: "/executions",
    payload: { type: "unsupported", payload: "not-an-object" },
  });
  const missing = await app.inject({
    method: "GET",
    url: "/executions/exe_missing/trace",
  });

  assert.equal(invalid.statusCode, 400);
  assert.equal(
    invalid.json<PandaApiErrorResponse>().error.code,
    "INVALID_EXECUTION_INPUT",
  );
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json<PandaApiErrorResponse>().error, {
    code: "EXECUTION_NOT_FOUND",
    message: "Execution exe_missing was not found.",
  });
});

test("bearer mode protects API and WebSocket access while keeping health public", async (context) => {
  const { app, runtime } = await withDaemon(context, {
    authentication: {
      token: apiToken,
      principal: { id: "phase-13-operator", type: "service" },
    },
  });
  const health = await app.inject({ method: "GET", url: "/health" });
  const missing = await app.inject({ method: "GET", url: "/executions" });
  const invalid = await app.inject({
    method: "GET",
    url: "/executions",
    headers: { authorization: "Bearer invalid" },
  });

  assert.equal(health.statusCode, 200);
  assert.equal(health.json().authentication, "bearer");
  for (const response of [missing, invalid]) {
    assert.equal(response.statusCode, 401);
    assert.equal(
      response.json<PandaApiErrorResponse>().error.code,
      "AUTHENTICATION_REQUIRED",
    );
    assert.equal(
      response.headers["www-authenticate"],
      'Bearer realm="panda-daemon"',
    );
  }
  await assert.rejects(
    app.injectWS("/events"),
    /Unexpected server response: 401/,
  );

  const authorizedHeaders = { authorization: `Bearer ${apiToken}` };
  const createdResponse = await app.inject({
    method: "POST",
    url: "/executions",
    headers: authorizedHeaders,
    payload: {
      source: "authenticated-test",
      payload: { path: "principal.txt", content: "principal-bound" },
    },
  });
  assert.equal(createdResponse.statusCode, 200);
  const created = createdResponse.json<PandaExecutionView>();
  assert.deepEqual(created.goal.owner, {
    id: "phase-13-operator",
    type: "service",
  });
  const effectPolicy = runtime
    .getTrace(created.executionId)
    ?.find((record) => record.type === "policy.effect.allow");
  assert.equal(
    (effectPolicy?.payload as { inputs?: { principalId?: string } }).inputs
      ?.principalId,
    "phase-13-operator",
  );
  assert.equal(
    JSON.stringify(runtime.getTrace(created.executionId)).includes(apiToken),
    false,
  );

  const socket = await app.injectWS("/events", { headers: authorizedHeaders });
  socket.terminate();
});

test("CORS reflects only explicitly allowed browser origins", async (context) => {
  const { app } = await withDaemon(context, {
    allowedOrigins: ["https://console.example.test"],
  });
  const allowed = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://console.example.test" },
  });
  const denied = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://untrusted.example.test" },
  });

  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "https://console.example.test",
  );
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});

test("the retired runs route is not exposed", async (context) => {
  const { app } = await withDaemon(context);
  const response = await app.inject({
    method: "POST",
    url: "/runs",
    payload: { payload: { path: "legacy.txt", content: "retired" } },
  });

  assert.equal(response.statusCode, 404);
});
