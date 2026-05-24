import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { SCHEMA_SQL } from './schema';
import {
  WorkspaceInfo,
  SessionInfo,
  TurnInfo,
  PricingEntry,
  DbWorkspace,
  DbSession,
  DbTurn,
  ReportScope,
  ReportRow
} from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlDb = any;
type SqlValue = number | string | Uint8Array | null;

export class PromptAnalyzerDb {
  private _loadedMtime = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(
    private db: SqlDb,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly SQL: any,
    private readonly dbPath: string
  ) {}

  static async create(dbPath: string): Promise<PromptAnalyzerDb> {
    // Locate the WASM file relative to this file's compiled location (out/storage/).
    const wasmPath = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SQL: any = await initSqlJs({ locateFile: () => wasmPath });

    let db: SqlDb;
    let initialMtime = 0;
    if (fs.existsSync(dbPath)) {
      try { initialMtime = fs.statSync(dbPath).mtimeMs; } catch { /* ignore */ }
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    const instance = new PromptAnalyzerDb(db, SQL, dbPath);
    instance._loadedMtime = initialMtime;
    instance.initialize();
    return instance;
  }

  /**
   * Reloads the database from disk. Required because sql.js holds the entire
   * database in memory; when another process (e.g. the aggregation worker)
   * writes to the file, this instance does not automatically see the changes.
   * Call this before reading after an external write may have occurred.
   */
  reload(): boolean {
    if (!fs.existsSync(this.dbPath)) return false;
    // Read and parse the file before touching this.db so that a failure
    // (e.g. EBUSY on Windows during a concurrent write) leaves the
    // existing in-memory DB intact rather than a closed/broken instance.
    let fileBuffer: Buffer;
    let newDb: SqlDb;
    let mtime = 0;
    try {
      mtime = fs.statSync(this.dbPath).mtimeMs;
      fileBuffer = fs.readFileSync(this.dbPath);
      newDb = new this.SQL.Database(fileBuffer);
      // sql.js accepts any byte buffer on construction but throws on SQL ops.
      // Probe the new DB with the schema statements before swapping so that
      // a corrupt file is detected while this.db is still intact.
      // CREATE TABLE IF NOT EXISTS is a no-op on a healthy DB.
      newDb.exec(SCHEMA_SQL);
    } catch {
      // File may be partially written by the worker — keep existing state.
      return false;
    }
    try {
      this.db.close();
    } catch {
      // ignore — db may already be closed
    }
    this.db = newDb;
    this.migrate();
    this._loadedMtime = mtime;
    return true;
  }

  /**
   * Reloads only when the on-disk file is newer than the last load.
   * Use this instead of `reload()` for passive/background callers (e.g. the
   * sidebar `ready` handler) to avoid unnecessary I/O on the extension-host
   * event loop when nothing has changed.
   */
  reloadIfChanged(): void {
    if (!fs.existsSync(this.dbPath)) return;
    try {
      const mtime = fs.statSync(this.dbPath).mtimeMs;
      if (mtime <= this._loadedMtime) return;
      // reload() updates _loadedMtime internally on success.
      this.reload();
    } catch {
      // Stat may fail transiently (e.g. EBUSY during a write); keep existing state.
    }
  }

  private initialize(): void {
    this.db.exec(SCHEMA_SQL);
    this.migrate();
    this.save();
  }

  /**
   * Lightweight in-place migrations for schema additions. Sqlite's
   * `CREATE TABLE IF NOT EXISTS` does not add new columns to an existing
   * table, so we inspect the live schema and `ALTER TABLE` what's missing.
   */
  private migrate(): void {
    const turnsCols = this.query<{ name: string }>(`PRAGMA table_info(turns)`);
    const hasTurnCol = (n: string) => turnsCols.some(c => c.name === n);
    if (!hasTurnCol('resolved_model')) {
      this.db.run(`ALTER TABLE turns ADD COLUMN resolved_model TEXT`);
    }

    const sessionsCols = this.query<{ name: string }>(`PRAGMA table_info(sessions)`);
    const hasSessionCol = (n: string) => sessionsCols.some(c => c.name === n);
    if (!hasSessionCol('telemetry_disabled')) {
      this.db.run(`ALTER TABLE sessions ADD COLUMN telemetry_disabled INTEGER NOT NULL DEFAULT 0`);
    }
  }

  /** Flush in-memory database to disk. Called after every mutation. */
  save(): void {
    const data: Uint8Array = this.db.export();
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, Buffer.from(data));
    // Keep _loadedMtime in sync so reloadIfChanged() does not treat our own
    // writes as external changes requiring a reload.
    try { this._loadedMtime = fs.statSync(this.dbPath).mtimeMs; } catch { /* ignore */ }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  private query<T>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as T);
    }
    stmt.free();
    return results;
  }

  private queryOne<T>(sql: string, params: SqlValue[] = []): T | null {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    let result: T | null = null;
    if (stmt.step()) {
      result = stmt.getAsObject() as unknown as T;
    }
    stmt.free();
    return result;
  }

  private run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params);
  }

  private runTransaction(fn: () => void): void {
    this.db.run('BEGIN');
    try {
      fn();
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }

  // ─── Workspaces ─────────────────────────────────────────────────────────────

  upsertWorkspace(info: WorkspaceInfo): void {
    this.run(
      `INSERT INTO workspaces (hash, display_name, workspace_path)
       VALUES (?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET
         display_name   = excluded.display_name,
         workspace_path = excluded.workspace_path`,
      [info.hash, info.displayName, info.workspacePath ?? null]
    );
    this.save();
  }

  getWorkspaces(): DbWorkspace[] {
    return this.query<DbWorkspace>(
      `SELECT w.hash,
              w.display_name,
              w.workspace_path,
              MAX(t.timestamp) AS latest_activity,
              COUNT(DISTINCT s.session_id) AS session_count
       FROM workspaces w
       LEFT JOIN sessions s ON s.workspace_hash = w.hash
       LEFT JOIN turns    t ON t.session_id = s.session_id
       GROUP BY w.hash
       ORDER BY latest_activity DESC NULLS LAST`
    );
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  upsertSession(info: SessionInfo & { updatedAt?: number }): void {
    this.run(
      `INSERT INTO sessions (session_id, workspace_hash, display_name, created_at, updated_at, chat_sessions_path, telemetry_disabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         display_name       = excluded.display_name,
         updated_at         = excluded.updated_at,
         chat_sessions_path = excluded.chat_sessions_path,
         telemetry_disabled = excluded.telemetry_disabled`,
      [
        info.sessionId,
        info.workspaceHash,
        info.displayName,
        info.createdAt ?? null,
        info.updatedAt ?? null,
        info.chatSessionsPath,
        info.telemetryDisabled ? 1 : 0
      ]
    );
    this.save();
  }

  getSessions(workspaceHash?: string, search?: string): DbSession[] {
    const searchTerm = search?.trim();
    const useSearch = !!searchTerm;
    const useHash = !!workspaceHash && !useSearch;

    const whereClauses: string[] = [];
    const params: SqlValue[] = [];

    if (useHash) {
      whereClauses.push('s.workspace_hash = ?');
      params.push(workspaceHash!);
    }
    if (useSearch) {
      whereClauses.push("s.display_name LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(searchTerm!)}%`);
    }

    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    return this.query<DbSession>(
      `SELECT s.session_id,
              s.workspace_hash,
              s.display_name,
              s.created_at,
              s.updated_at,
              s.chat_sessions_path,
                s.telemetry_disabled,
                COUNT(t.id)           AS total_turns,
              SUM(t.estimated_cost) AS total_cost
       FROM sessions s
       LEFT JOIN turns t ON t.session_id = s.session_id AND t.is_completed = 1
       ${where}
       GROUP BY s.session_id
       ORDER BY COALESCE(s.updated_at, s.created_at) DESC NULLS LAST`,
      params
    );
  }

  // ─── Turns ──────────────────────────────────────────────────────────────────

  upsertTurns(turns: TurnInfo[]): void {
    this.runTransaction(() => {
      for (const t of turns) {
        this.run(
          `INSERT INTO turns
             (session_id, request_id, timestamp, model_id, resolved_model, completion_tokens,
              estimated_prompt_tokens, cache_eligible_tokens, elapsed_ms,
              message_text, estimated_cost, is_completed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id, request_id) DO UPDATE SET
             resolved_model          = excluded.resolved_model,
             completion_tokens       = excluded.completion_tokens,
             estimated_prompt_tokens = excluded.estimated_prompt_tokens,
             cache_eligible_tokens   = excluded.cache_eligible_tokens,
             elapsed_ms              = excluded.elapsed_ms,
             message_text            = excluded.message_text,
             estimated_cost          = excluded.estimated_cost,
             is_completed            = excluded.is_completed`,
          [
            t.sessionId,
            t.requestId,
            t.timestamp ?? null,
            t.modelId ?? null,
            t.resolvedModel ?? null,
            t.completionTokens ?? null,
            t.estimatedPromptTokens ?? null,
            t.cacheEligibleTokens ?? 0,
            t.elapsedMs ?? null,
            t.messageText ?? null,
            t.estimatedCost ?? null,
            t.isCompleted ? 1 : 0
          ]
        );
      }
    });
    // Note: deliberately NOT calling this.save() here. The caller (aggregator)
    // batches turns and may call upsertTurns many times per session; flushing
    // the entire sql.js DB to disk after every batch turns ingestion into
    // O(N²) I/O on large workspaces. Saves happen once per session via
    // setProcessedFile() and on close().
  }

  getTurns(sessionId: string): DbTurn[] {
    return this.query<DbTurn>(
      `SELECT * FROM turns WHERE session_id = ? ORDER BY timestamp ASC`,
      [sessionId]
    );
  }

  /** Returns the latest timestamp of a turn in the session (for updated_at). */
  getSessionLatestTurnTimestamp(sessionId: string): number | null {
    const row = this.queryOne<{ ts: number | null }>(
      `SELECT MAX(timestamp) AS ts FROM turns WHERE session_id = ?`,
      [sessionId]
    );
    return row?.ts ?? null;
  }

  // ─── Report ─────────────────────────────────────────────────────────────────

  /**
   * Returns the raw (workspace × session × turn) rows needed by the Report
   * panel, filtered by scope. We pull a flat row set and let pure-TS code in
   * `reportData.ts` do the bucketing/aggregation — keeps the SQL simple and
   * the aggregation logic 100% unit-testable.
   *
   * Only completed turns are included, matching `getSessions`' cost totals.
   */
  getReportRows(scope: ReportScope): ReportRow[] {
    const whereParts: string[] = ['t.is_completed = 1', 't.timestamp IS NOT NULL'];
    const params: SqlValue[] = [];
    if (scope.type === 'workspace') {
      whereParts.push('s.workspace_hash = ?');
      params.push(scope.workspaceHash);
    } else if (scope.type === 'session') {
      whereParts.push('s.session_id = ?');
      params.push(scope.sessionId);
    }
    const where = `WHERE ${whereParts.join(' AND ')}`;
    return this.query<ReportRow>(
      `SELECT w.hash                  AS workspace_hash,
              w.display_name          AS workspace_display_name,
              s.session_id            AS session_id,
              s.display_name          AS session_display_name,
              t.timestamp             AS timestamp,
              t.model_id              AS model_id,
              t.resolved_model        AS resolved_model,
              t.estimated_prompt_tokens AS input_tokens,
              t.completion_tokens     AS output_tokens,
              t.cache_eligible_tokens AS cache_tokens,
              t.estimated_cost        AS cost,
              t.elapsed_ms            AS duration_ms,
                s.telemetry_disabled    AS telemetry_disabled
         FROM turns t
       JOIN sessions s ON s.session_id = t.session_id
       JOIN workspaces w ON w.hash = s.workspace_hash
       ${where}
       ORDER BY t.timestamp ASC`,
      params
    );
  }

  // ─── Pricing ────────────────────────────────────────────────────────────────

  getPricingEntry(modelDisplayName: string): PricingEntry | null {
    const row = this.queryOne<{
      model: string;
      input_per_m: number;
      cached_input_per_m: number;
      output_per_m: number;
      cache_write_per_m: number | null;
    }>(
      `SELECT model, input_per_m, cached_input_per_m, output_per_m, cache_write_per_m
       FROM pricing_cache WHERE model = ? COLLATE NOCASE`,
      [modelDisplayName]
    );

    if (!row) return null;
    return {
      model: row.model,
      inputPerM: row.input_per_m,
      cachedInputPerM: row.cached_input_per_m,
      outputPerM: row.output_per_m,
      cacheWritePerM: row.cache_write_per_m
    };
  }

  setPricingEntries(entries: PricingEntry[], fetchedAt: number): void {
    this.runTransaction(() => {
      // Wipe before re-inserting so renamed/normalized model keys don't
      // accumulate alongside their old aliases (e.g. the slug-form rename
      // would otherwise leave both `Claude Sonnet 4.6` and `claude-sonnet-4.6`
      // in the table, with the wrong one winning lookups).
      this.run(`DELETE FROM pricing_cache`);
      for (const e of entries) {
        this.run(
          `INSERT INTO pricing_cache (model, input_per_m, cached_input_per_m, output_per_m, cache_write_per_m, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(model) DO UPDATE SET
             input_per_m        = excluded.input_per_m,
             cached_input_per_m = excluded.cached_input_per_m,
             output_per_m       = excluded.output_per_m,
             cache_write_per_m  = excluded.cache_write_per_m,
             fetched_at         = excluded.fetched_at`,
          [e.model, e.inputPerM, e.cachedInputPerM, e.outputPerM, e.cacheWritePerM ?? null, fetchedAt]
        );
      }
    });
    this.save();
  }

  /** Returns true if the pricing cache contains any entry whose model name
   *  isn't in slug form (lowercased, hyphen-separated). Used to detect a
   *  cache populated by a pre-normalization extension version so we can
   *  force a refetch. */
  hasNonSlugPricingEntries(): boolean {
    const row = this.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM pricing_cache
        WHERE model GLOB '*[A-Z ]*'`
    );
    return (row?.n ?? 0) > 0;
  }

  /** Returns the timestamp of the most recently fetched pricing entry, or null. */
  getPricingFetchedAt(): number | null {
    const row = this.queryOne<{ ts: number | null }>(
      `SELECT MAX(fetched_at) AS ts FROM pricing_cache`
    );
    return row?.ts ?? null;
  }

  // ─── Processed-file tracking ─────────────────────────────────────────────────

  getProcessedFile(filePath: string): { last_modified: number } | null {
    return this.queryOne<{ last_modified: number }>(
      `SELECT last_modified FROM processed_files WHERE file_path = ?`,
      [filePath]
    );
  }

  setProcessedFile(filePath: string, lastModified: number): void {
    this.run(
      `INSERT INTO processed_files (file_path, last_modified, processed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         last_modified = excluded.last_modified,
         processed_at  = excluded.processed_at`,
      [filePath, lastModified, Date.now()]
    );
    this.save();
  }

  /**
   * Recomputes `estimated_cost` for every stored turn using the supplied
   * pricing function. Much faster than clearing and re-parsing the JSONL
   * logs because all inputs (modelId, resolvedModel, tokens) are already
   * persisted on the turn row. Returns the number of turns updated.
   */
  recomputeAllCosts(priceFn: (turn: TurnInfo) => number | null): number {
    const rows = this.query<{
      id: number;
      session_id: string;
      request_id: string;
      timestamp: number | null;
      model_id: string | null;
      resolved_model: string | null;
      completion_tokens: number | null;
      estimated_prompt_tokens: number | null;
      cache_eligible_tokens: number;
      elapsed_ms: number | null;
    }>(
      `SELECT id, session_id, request_id, timestamp, model_id, resolved_model,
              completion_tokens, estimated_prompt_tokens, cache_eligible_tokens,
              elapsed_ms
         FROM turns`
    );
    let updated = 0;
    for (const r of rows) {
      const turn: TurnInfo = {
        requestId: r.request_id,
        sessionId: r.session_id,
        timestamp: r.timestamp ?? 0,
        modelId: r.model_id ?? '',
        resolvedModel: r.resolved_model,
        completionTokens: r.completion_tokens,
        estimatedPromptTokens: r.estimated_prompt_tokens,
        cacheEligibleTokens: r.cache_eligible_tokens ?? 0,
        elapsedMs: r.elapsed_ms,
        messageText: '',
        isCompleted: true,
        estimatedCost: null
      };
      const cost = priceFn(turn);
      this.run(`UPDATE turns SET estimated_cost = ? WHERE id = ?`, [cost, r.id]);
      updated++;
    }
    this.save();
    return updated;
  }

  /**
   * Clears all stored turns and the processed-files watermark so the next
   * background scan re-parses every session from scratch. Sessions metadata
   * is preserved. Prefer `recomputeAllCosts` unless the parser itself changed.
   */
  resetForReprocess(): void {
    this.run(`DELETE FROM turns`);
    this.run(`DELETE FROM processed_files`);
    this.save();
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  close(): void {
    this.save();
    this.db.close();
  }
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
