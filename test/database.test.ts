import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PromptAnalyzerDb } from '../src/storage/database';
import { WorkspaceInfo, SessionInfo, TurnInfo, PricingEntry } from '../src/types';

describe('PromptAnalyzerDb', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: PromptAnalyzerDb;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-db-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    db = await PromptAnalyzerDb.create(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Workspaces ──────────────────────────────────────────────────────────────

  describe('workspaces', () => {
    const workspace: WorkspaceInfo = {
      hash: 'abc123',
      displayName: 'my-project',
      workspacePath: '/home/user/my-project'
    };

    it('inserts and retrieves a workspace', () => {
      db.upsertWorkspace(workspace);
      const workspaces = db.getWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].hash).toBe('abc123');
      expect(workspaces[0].display_name).toBe('my-project');
    });

    it('updates workspace on re-upsert', () => {
      db.upsertWorkspace(workspace);
      db.upsertWorkspace({ ...workspace, displayName: 'renamed-project' });
      const workspaces = db.getWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].display_name).toBe('renamed-project');
    });

    it('handles null workspacePath', () => {
      db.upsertWorkspace({ ...workspace, workspacePath: null });
      const workspaces = db.getWorkspaces();
      expect(workspaces[0].workspace_path).toBeNull();
    });
  });

  // ── Sessions ────────────────────────────────────────────────────────────────

  describe('sessions', () => {
    const workspace: WorkspaceInfo = {
      hash: 'ws1',
      displayName: 'project-one',
      workspacePath: null
    };

    const session: SessionInfo = {
      sessionId: 'sess-abc',
      workspaceHash: 'ws1',
      displayName: 'My Chat Session',
      chatSessionsPath: '/some/path',
      telemetryDisabled: false,
      createdAt: 1700000000000
    };

    beforeEach(() => {
      db.upsertWorkspace(workspace);
    });

    it('inserts and retrieves a session', () => {
      db.upsertSession(session);
      const sessions = db.getSessions('ws1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe('sess-abc');
      expect(sessions[0].display_name).toBe('My Chat Session');
    });

    it('updates display_name on re-upsert', () => {
      db.upsertSession(session);
      db.upsertSession({ ...session, displayName: 'Renamed Session' });
      const sessions = db.getSessions('ws1');
      expect(sessions[0].display_name).toBe('Renamed Session');
    });

    it('filters sessions by workspace hash', () => {
      db.upsertWorkspace({ hash: 'ws2', displayName: 'other', workspacePath: null });
      db.upsertSession(session);
      db.upsertSession({ ...session, sessionId: 'sess-2', workspaceHash: 'ws2' });

      const ws1Sessions = db.getSessions('ws1');
      expect(ws1Sessions).toHaveLength(1);
      expect(ws1Sessions[0].session_id).toBe('sess-abc');
    });

    it('filters sessions by search term', () => {
      db.upsertSession(session);
      db.upsertSession({ ...session, sessionId: 'sess-xyz', displayName: 'Different Topic' });

      const results = db.getSessions(undefined, 'Chat');
      expect(results).toHaveLength(1);
      expect(results[0].session_id).toBe('sess-abc');
    });

    it('returns all sessions when no filter', () => {
      db.upsertSession(session);
      db.upsertSession({ ...session, sessionId: 'sess-2', displayName: 'Another' });
      expect(db.getSessions()).toHaveLength(2);
    });
  });

  // ── Turns ───────────────────────────────────────────────────────────────────

  describe('turns', () => {
    const workspace: WorkspaceInfo = {
      hash: 'wsh',
      displayName: 'test-ws',
      workspacePath: null
    };

    const session: SessionInfo = {
      sessionId: 's1',
      workspaceHash: 'wsh',
      displayName: 'Test Session',
      chatSessionsPath: '/path/to/sessions',
      telemetryDisabled: false,
      createdAt: 1700000000000
    };

    const turn: TurnInfo = {
      requestId: 'req-1',
      sessionId: 's1',
      timestamp: 1700000001000,
      modelId: 'copilot/claude-sonnet-4.6',
      completionTokens: 250,
      estimatedPromptTokens: 100,
      cacheEligibleTokens: 50,
      elapsedMs: 2000,
      messageText: 'Tell me about TypeScript.',
      isCompleted: true,
      estimatedCost: 0.005
    };

    beforeEach(() => {
      db.upsertWorkspace(workspace);
      db.upsertSession(session);
    });

    it('inserts and retrieves turns', () => {
      db.upsertTurns([turn]);
      const turns = db.getTurns('s1');
      expect(turns).toHaveLength(1);
      expect(turns[0].request_id).toBe('req-1');
      expect(turns[0].completion_tokens).toBe(250);
      expect(turns[0].model_id).toBe('copilot/claude-sonnet-4.6');
    });

    it('updates turn on re-upsert', () => {
      db.upsertTurns([turn]);
      db.upsertTurns([{ ...turn, completionTokens: 999 }]);
      const turns = db.getTurns('s1');
      expect(turns).toHaveLength(1);
      expect(turns[0].completion_tokens).toBe(999);
    });

    it('inserts multiple turns in a transaction', () => {
      const turn2: TurnInfo = { ...turn, requestId: 'req-2', timestamp: 1700000002000 };
      const turn3: TurnInfo = { ...turn, requestId: 'req-3', timestamp: 1700000003000 };
      db.upsertTurns([turn, turn2, turn3]);
      expect(db.getTurns('s1')).toHaveLength(3);
    });

    it('aggregates total_turns in getSessions', () => {
      db.upsertTurns([turn, { ...turn, requestId: 'req-2' }]);
      const sessions = db.getSessions('wsh');
      expect(sessions[0].total_turns).toBe(2);
    });

    it('aggregates total_cost in getSessions', () => {
      db.upsertTurns([
        { ...turn, estimatedCost: 0.01 },
        { ...turn, requestId: 'req-2', estimatedCost: 0.02 }
      ]);
      const sessions = db.getSessions('wsh');
      expect(sessions[0].total_cost).toBeCloseTo(0.03, 5);
    });
  });

  // ── Pricing cache ───────────────────────────────────────────────────────────

  describe('pricing cache', () => {
    const entries: PricingEntry[] = [
      { model: 'Claude Sonnet 4.6', inputPerM: 3, cachedInputPerM: 0.3, outputPerM: 15, cacheWritePerM: 3.75 },
      { model: 'GPT-4.1', inputPerM: 2, cachedInputPerM: 0.5, outputPerM: 8, cacheWritePerM: null }
    ];

    it('returns null when pricing table is empty', () => {
      expect(db.getPricingEntry('Claude Sonnet 4.6')).toBeNull();
      expect(db.getPricingFetchedAt()).toBeNull();
    });

    it('stores and retrieves pricing entries', () => {
      db.setPricingEntries(entries, 1700000000000);
      const entry = db.getPricingEntry('Claude Sonnet 4.6');
      expect(entry).not.toBeNull();
      expect(entry!.inputPerM).toBe(3);
      expect(entry!.outputPerM).toBe(15);
      expect(entry!.cacheWritePerM).toBe(3.75);
    });

    it('lookup is case-insensitive', () => {
      db.setPricingEntries(entries, 1700000000000);
      const entry = db.getPricingEntry('claude sonnet 4.6');
      expect(entry).not.toBeNull();
    });

    it('returns null for unknown model', () => {
      db.setPricingEntries(entries, 1700000000000);
      expect(db.getPricingEntry('Unknown Model X')).toBeNull();
    });

    it('returns fetchedAt timestamp', () => {
      db.setPricingEntries(entries, 1700000000000);
      expect(db.getPricingFetchedAt()).toBe(1700000000000);
    });

    it('handles null cacheWritePerM', () => {
      db.setPricingEntries(entries, 1700000000000);
      const gpt = db.getPricingEntry('GPT-4.1');
      expect(gpt!.cacheWritePerM).toBeNull();
    });
  });

  // ── Processed files ─────────────────────────────────────────────────────────

  describe('processed files', () => {
    it('returns null for an untracked file', () => {
      expect(db.getProcessedFile('/some/path.jsonl')).toBeNull();
    });

    it('stores and retrieves processed file record', () => {
      db.setProcessedFile('/path/to/file.jsonl', 1700000000000);
      const record = db.getProcessedFile('/path/to/file.jsonl');
      expect(record).not.toBeNull();
      expect(record!.last_modified).toBe(1700000000000);
    });

    it('updates record on re-set', () => {
      db.setProcessedFile('/path/file.jsonl', 1700000000000);
      db.setProcessedFile('/path/file.jsonl', 1700000099000);
      const record = db.getProcessedFile('/path/file.jsonl');
      expect(record!.last_modified).toBe(1700000099000);
    });
  });

  // ── reload / reloadIfChanged ────────────────────────────────────────────────

  describe('reload', () => {
    it('returns false when the db file does not exist', async () => {
      const missingPath = path.join(tmpDir, 'nonexistent.db');
      const freshDb = await PromptAnalyzerDb.create(missingPath);
      fs.unlinkSync(missingPath);
      expect(freshDb.reload()).toBe(false);
      freshDb.close();
    });

    it('returns false and preserves in-memory state when file is corrupt', () => {
      const workspace: WorkspaceInfo = {
        hash: 'reload-ws',
        displayName: 'reload-test',
        workspacePath: null
      };
      db.upsertWorkspace(workspace);
      // Overwrite the on-disk file with garbage so the parse fails.
      fs.writeFileSync(dbPath, Buffer.from('this is not a valid sqlite database'));
      expect(db.reload()).toBe(false);
      // In-memory state must still be intact.
      expect(db.getWorkspaces()).toHaveLength(1);
      expect(db.getWorkspaces()[0].hash).toBe('reload-ws');
    });

    it('returns true and reflects new data after a successful reload', async () => {
      // Write a second db to the same path with an extra workspace.
      const db2 = await PromptAnalyzerDb.create(dbPath);
      db2.upsertWorkspace({ hash: 'from-other', displayName: 'other', workspacePath: null });
      db2.save();
      db2.close();

      expect(db.reload()).toBe(true);
      expect(db.getWorkspaces().some(w => w.hash === 'from-other')).toBe(true);
    });

    it('updates _loadedMtime on a successful reload', () => {
      // Manually zero _loadedMtime to simulate a stale state, then verify
      // that reload() updates it from the on-disk file stat.
      (db as unknown as { _loadedMtime: number })._loadedMtime = 0;
      db.reload();
      expect((db as unknown as { _loadedMtime: number })._loadedMtime).toBeGreaterThan(0);
    });

    it('does NOT update _loadedMtime when reload fails', () => {
      fs.writeFileSync(dbPath, Buffer.from('garbage'));
      const mtimeBefore = (db as unknown as { _loadedMtime: number })._loadedMtime;
      db.reload();
      expect((db as unknown as { _loadedMtime: number })._loadedMtime).toBe(mtimeBefore);
    });
  });

  describe('reloadIfChanged', () => {
    it('skips reload when mtime is unchanged', () => {
      db.save();
      const currentMtime = fs.statSync(dbPath).mtimeMs;
      // Manually set _loadedMtime so the guard thinks the file was already loaded.
      (db as unknown as { _loadedMtime: number })._loadedMtime = currentMtime;

      const reloadSpy = jest.spyOn(db, 'reload');
      db.reloadIfChanged();
      expect(reloadSpy).not.toHaveBeenCalled();
      reloadSpy.mockRestore();
    });

    it('calls reload when the file mtime has advanced', () => {
      db.save();
      const currentMtime = fs.statSync(dbPath).mtimeMs;
      (db as unknown as { _loadedMtime: number })._loadedMtime = currentMtime;

      // Advance the on-disk mtime without changing the content.
      const futureMtime = currentMtime + 2000;
      fs.utimesSync(dbPath, new Date(futureMtime), new Date(futureMtime));

      const reloadSpy = jest.spyOn(db, 'reload');
      db.reloadIfChanged();
      expect(reloadSpy).toHaveBeenCalled();
      reloadSpy.mockRestore();
    });
  });

  // ── resetForReprocess ───────────────────────────────────────────────────────

  describe('resetForReprocess', () => {
    it('clears turns, sessions, workspaces, and processed_files', () => {
      const workspace: WorkspaceInfo = {
        hash: 'wsr', displayName: 'reset-ws', workspacePath: null
      };
      const session: SessionInfo = {
        sessionId: 'sess-reset', workspaceHash: 'wsr', displayName: 'Reset Session',
        chatSessionsPath: '/p', telemetryDisabled: false, createdAt: null
      };
      const turn: TurnInfo = {
        requestId: 'req-r1', sessionId: 'sess-reset', timestamp: 1700000000000,
        modelId: 'copilot/gpt-4o', completionTokens: 10,
        estimatedPromptTokens: 5, cacheEligibleTokens: 0,
        elapsedMs: null, messageText: '', isCompleted: true, estimatedCost: null
      };

      db.upsertWorkspace(workspace);
      db.upsertSession(session);
      db.upsertTurns([turn]);
      db.setProcessedFile('/path/file.jsonl', 1700000000000);

      db.resetForReprocess();

      expect(db.getWorkspaces()).toHaveLength(0);
      expect(db.getSessions()).toHaveLength(0);
      expect(db.getTurns('sess-reset')).toHaveLength(0);
      expect(db.getProcessedFile('/path/file.jsonl')).toBeNull();
    });
  });
});
