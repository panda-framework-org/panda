import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import type {
  FlowRecord,
  FlowRecordCreateInput,
  FlowRecordUpdateInput,
} from "@panda/shared";

export interface FlowRecordStore {
  list(): FlowRecord[];
  get(id: string): FlowRecord | undefined;
  create(input: FlowRecordCreateInput): FlowRecord;
  update(id: string, input: FlowRecordUpdateInput): FlowRecord | undefined;
  delete(id: string): boolean;
  import(records: readonly FlowRecord[]): FlowRecord[];
  close(): void;
}

export interface SqliteFlowRecordStoreOptions {
  readonly dataDirectory?: string;
  readonly databasePath?: string;
  readonly now?: () => string;
  readonly createId?: () => string;
}

interface FlowRecordRow {
  readonly id: string;
  readonly title: string;
  readonly perception: string;
  readonly analysis: string;
  readonly network: string;
  readonly decision: string;
  readonly action: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const FLOW_RECORD_COLUMNS = `
  id,
  title,
  perception,
  analysis,
  network,
  decision,
  action,
  created_at,
  updated_at
`;

export class SqliteFlowRecordStore implements FlowRecordStore {
  readonly databasePath: string;
  private readonly database: Database.Database;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: SqliteFlowRecordStoreOptions = {}) {
    this.databasePath = resolve(
      options.databasePath ??
        join(options.dataDirectory ?? ".panda", "panda.sqlite"),
    );
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
    mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
    this.database = new Database(this.databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.migrate();
  }

  list(): FlowRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${FLOW_RECORD_COLUMNS}
         FROM flow_records
         ORDER BY updated_at DESC, id ASC`,
      )
      .all() as FlowRecordRow[];
    return rows.map(toFlowRecord);
  }

  get(id: string): FlowRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT ${FLOW_RECORD_COLUMNS}
         FROM flow_records
         WHERE id = ?`,
      )
      .get(id) as FlowRecordRow | undefined;
    return row === undefined ? undefined : toFlowRecord(row);
  }

  create(input: FlowRecordCreateInput): FlowRecord {
    const timestamp = this.now();
    const record: FlowRecord = {
      id: this.createId(),
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.insert(record);
    return record;
  }

  update(id: string, input: FlowRecordUpdateInput): FlowRecord | undefined {
    const updatedAt = this.now();
    const result = this.database
      .prepare(
        `UPDATE flow_records
         SET title = @title,
             perception = @perception,
             analysis = @analysis,
             network = @network,
             decision = @decision,
             action = @action,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({ id, ...input, updatedAt });
    return result.changes === 0 ? undefined : this.get(id);
  }

  delete(id: string): boolean {
    const result = this.database
      .prepare("DELETE FROM flow_records WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  import(records: readonly FlowRecord[]): FlowRecord[] {
    const insert = this.database.prepare(
      `INSERT INTO flow_records (${FLOW_RECORD_COLUMNS})
       VALUES (
         @id,
         @title,
         @perception,
         @analysis,
         @network,
         @decision,
         @action,
         @createdAt,
         @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         perception = excluded.perception,
         analysis = excluded.analysis,
         network = excluded.network,
         decision = excluded.decision,
         action = excluded.action,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > flow_records.updated_at`,
    );
    const importRecords = this.database.transaction(
      (items: readonly FlowRecord[]) => {
        for (const record of items) insert.run(record);
      },
    );
    importRecords(records);
    return this.list();
  }

  close(): void {
    if (this.database.open) this.database.close();
  }

  private insert(record: FlowRecord): void {
    this.database
      .prepare(
        `INSERT INTO flow_records (${FLOW_RECORD_COLUMNS})
         VALUES (
           @id,
           @title,
           @perception,
           @analysis,
           @network,
           @decision,
           @action,
           @createdAt,
           @updatedAt
         )`,
      )
      .run(record);
  }

  private migrate(): void {
    const version = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    if (version > 1) {
      throw new Error(
        `The flow-record database schema version ${version} is newer than this PANDA daemon supports.`,
      );
    }
    if (version === 1) return;

    this.database.exec(`
      CREATE TABLE flow_records (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        perception TEXT NOT NULL,
        analysis TEXT NOT NULL,
        network TEXT NOT NULL,
        decision TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX flow_records_updated_at
        ON flow_records(updated_at DESC);
      PRAGMA user_version = 1;
    `);
  }
}

function toFlowRecord(row: FlowRecordRow): FlowRecord {
  return {
    id: row.id,
    title: row.title,
    perception: row.perception,
    analysis: row.analysis,
    network: row.network,
    decision: row.decision,
    action: row.action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
