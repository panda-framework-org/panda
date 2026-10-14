import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FlowRecord } from "@panda/shared";
import { SqliteFlowRecordStore } from "./flow-record-store.js";

const fields = {
  title: "Investigate login issue",
  perception: "Customers cannot sign in.",
  analysis: "The identity provider is timing out.",
  network: "Web app, API, and identity provider.",
  decision: "Fail over to the secondary provider.",
  action: "Enable the failover and monitor authentication.",
};

test("SQLite flow records support durable CRUD", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "panda-flow-records-"));
  const databasePath = join(directory, "records.sqlite");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const timestamps = ["2026-08-28T10:00:00.000Z", "2026-08-28T11:00:00.000Z"];
  const first = new SqliteFlowRecordStore({
    databasePath,
    createId: () => "flow_record_1",
    now: () => timestamps.shift() ?? "2026-08-28T12:00:00.000Z",
  });

  const created = first.create(fields);
  assert.deepEqual(created, {
    id: "flow_record_1",
    ...fields,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  });
  const updated = first.update(created.id, {
    ...fields,
    action: "Failover enabled; watch the error rate.",
  });
  assert.equal(updated?.createdAt, created.createdAt);
  assert.equal(updated?.updatedAt, "2026-08-28T11:00:00.000Z");
  assert.equal(updated?.action, "Failover enabled; watch the error rate.");
  first.close();

  const second = new SqliteFlowRecordStore({ databasePath });
  assert.deepEqual(second.list(), [updated]);
  assert.equal(second.delete(created.id), true);
  assert.equal(second.delete(created.id), false);
  assert.deepEqual(second.list(), []);
  second.close();
});

test("legacy imports are transactional and idempotent", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "panda-flow-import-"));
  const store = new SqliteFlowRecordStore({ dataDirectory: directory });
  context.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const legacy: FlowRecord = {
    id: "flow-legacy-1",
    ...fields,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:30:00.000Z",
  };

  assert.deepEqual(store.import([legacy]), [legacy]);
  assert.deepEqual(store.import([legacy]), [legacy]);

  const newer = {
    ...legacy,
    action: "Imported the newest browser edit.",
    updatedAt: "2026-08-25T11:00:00.000Z",
  };
  assert.deepEqual(store.import([newer]), [newer]);
});
