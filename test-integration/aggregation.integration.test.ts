import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverWorkspaces } from '../src/providers/copilot/workspaceResolver';
import {
  listSessionIds,
  parseChatSessionFile
} from '../src/providers/copilot/chatSessionsParser';
import { defaultWorkspaceStoragePath } from '../src/utils/pathUtils';
import { PromptAnalyzerDb } from '../src/storage/database';
import { runAggregation } from '../src/workers/aggregator';
import { WorkerMessage } from '../src/types';

/**
 * Integration tests that exercise the real Copilot chat session data on the
 * developer's machine. These tests are skipped automatically if no
 * workspaceStorage directory with Copilot data is found, so they don't fail
 * for contributors who have never used Copilot Chat.
 */
const realWorkspaceStorage = defaultWorkspaceStoragePath();
const hasRealData =
  fs.existsSync(realWorkspaceStorage) &&
  discoverWorkspaces(realWorkspaceStorage).length > 0;

const describeIfData = hasRealData ? describe : describe.skip;

describeIfData('integration: real Copilot workspaceStorage', () => {
  it('discovers at least one workspace with chatSessions', () => {
    const results = discoverWorkspaces(realWorkspaceStorage);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(fs.existsSync(r.chatSessionsPath)).toBe(true);
      expect(r.workspaceInfo.hash).toMatch(/^[0-9a-f]+$/i);
    }
  });

  it('lists session IDs for discovered workspaces', () => {
    const results = discoverWorkspaces(realWorkspaceStorage);
    let totalSessions = 0;
    for (const r of results) {
      const ids = listSessionIds(r.chatSessionsPath);
      totalSessions += ids.length;
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f-]+$/i);
      }
    }
    expect(totalSessions).toBeGreaterThan(0);
  });

  it('parses at least one real session file with non-zero turns', () => {
    const results = discoverWorkspaces(realWorkspaceStorage);
    let parsedAny = false;
    let turnsFound = 0;

    outer: for (const r of results) {
      const ids = listSessionIds(r.chatSessionsPath);
      for (const id of ids) {
        const filePath = path.join(r.chatSessionsPath, `${id}.jsonl`);
        const parsed = parseChatSessionFile(filePath, id, r.workspaceInfo.hash);
        if (!parsed) continue;
        parsedAny = true;
        expect(parsed.sessionInfo.sessionId).toBe(id);
        expect(typeof parsed.sessionInfo.displayName).toBe('string');
        turnsFound += parsed.turns.length;
        if (turnsFound > 0) break outer;
      }
    }

    expect(parsedAny).toBe(true);
    // We expect at least one session somewhere on the machine to have turns
    expect(turnsFound).toBeGreaterThan(0);
  });

  it('runs full aggregation end-to-end into a temp database', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-int-'));
    const dbPath = path.join(tmpDir, 'integration.db');

    const messages: WorkerMessage[] = [];
    await runAggregation(dbPath, [realWorkspaceStorage], msg => messages.push(msg));

    const db = await PromptAnalyzerDb.create(dbPath);
    try {
      const workspaces = db.getWorkspaces();
      const sessions = db.getSessions();

      expect(workspaces.length).toBeGreaterThan(0);
      expect(sessions.length).toBeGreaterThan(0);

      // At least one 'progress' message and one 'complete' message
      expect(messages.some(m => m.type === 'progress')).toBe(true);
      expect(messages.some(m => m.type === 'complete')).toBe(true);
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

if (!hasRealData) {
  // eslint-disable-next-line no-console
  console.warn(
    `[integration] No Copilot workspaceStorage data found at ${realWorkspaceStorage} — skipping integration tests.`
  );
}
