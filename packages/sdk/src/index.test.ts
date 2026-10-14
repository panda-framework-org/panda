import assert from "node:assert/strict";
import test from "node:test";
import { PandaClient, PandaRequestError } from "./index.js";

test("uses encoded canonical execution and trace endpoints", async (context) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    requests.push({ url: String(url), init });
    return Response.json(url.toString().endsWith("/trace") ? [] : []);
  });
  const client = new PandaClient({ baseUrl: "http://daemon.test/" });

  await client.listExecutions();
  await client.getExecution("exe/with space");
  await client.getExecutionTrace("exe/with space");

  assert.deepEqual(
    requests.map((request) => request.url),
    [
      "http://daemon.test/executions",
      "http://daemon.test/executions/exe%2Fwith%20space",
      "http://daemon.test/executions/exe%2Fwith%20space/trace",
    ],
  );
});

test("posts the typed execution request", async (context) => {
  let request: { url: string; init?: RequestInit } | undefined;
  context.mock.method(globalThis, "fetch", async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    request = { url: String(url), init };
    return Response.json({ executionId: "exe_sdk", status: "succeeded" });
  });
  const client = new PandaClient({ baseUrl: "http://daemon.test" });
  await client.createExecution({
    source: "sdk-test",
    payload: { path: "proof.txt", content: "sdk content" },
  });

  assert.equal(request?.url, "http://daemon.test/executions");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    source: "sdk-test",
    payload: { path: "proof.txt", content: "sdk content" },
  });
});

test("uses the flow-record CRUD and import endpoints", async (context) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    requests.push({ url: String(url), init });
    return init?.method === "DELETE"
      ? new Response(undefined, { status: 204 })
      : Response.json([]);
  });
  const client = new PandaClient({ baseUrl: "http://daemon.test" });
  const fields = {
    title: "Flow",
    perception: "Observed",
    analysis: "Analyzed",
    network: "Connected",
    decision: "Decided",
    action: "Acted",
  };
  const record = {
    id: "flow-1",
    ...fields,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };

  await client.listFlowRecords();
  await client.createFlowRecord(fields);
  await client.updateFlowRecord("flow/with space", fields);
  await client.deleteFlowRecord("flow/with space");
  await client.importFlowRecords([record]);

  assert.deepEqual(
    requests.map(({ url, init }) => [url, init?.method ?? "GET"]),
    [
      ["http://daemon.test/flow-records", "GET"],
      ["http://daemon.test/flow-records", "POST"],
      ["http://daemon.test/flow-records/flow%2Fwith%20space", "PUT"],
      ["http://daemon.test/flow-records/flow%2Fwith%20space", "DELETE"],
      ["http://daemon.test/flow-records/import", "POST"],
    ],
  );
  assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), {
    records: [record],
  });
});

test(
  "sends a configured bearer token without adding it to request bodies",
  async (context) => {
    let request: { url: string; init?: RequestInit } | undefined;
    context.mock.method(globalThis, "fetch", async (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      request = { url: String(url), init };
      return Response.json([]);
    });
    const token = "sdk-phase-13-token-with-32-characters";
    const client = new PandaClient({
      baseUrl: "http://daemon.test",
      apiToken: token,
    });

    await client.listExecutions();

    const headers = new Headers(request?.init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${token}`);
    assert.equal(request?.init?.body, undefined);
    assert.throws(
      () => new PandaClient({ apiToken: " " }),
      /must not be empty/,
    );
  },
);

test("preserves structured daemon errors", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: {
          code: "EXECUTION_NOT_FOUND",
          message: "Execution exe_missing was not found.",
        },
      },
      { status: 404 },
    ),
  );

  await assert.rejects(
    () => new PandaClient().getExecution("exe_missing"),
    (error) => {
      assert.ok(error instanceof PandaRequestError);
      assert.equal(error.status, 404);
      assert.equal(error.detail.code, "EXECUTION_NOT_FOUND");
      return true;
    },
  );
});
