import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseChatSessionFile,
  listSessionIds
} from '../src/providers/copilot/chatSessionsParser';

function writeLines(filePath: string, lines: object[]): void {
  fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
}

describe('chatSessionsParser', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── listSessionIds ──────────────────────────────────────────────────────────

  describe('listSessionIds', () => {
    it('returns session IDs from .jsonl filenames', () => {
      fs.writeFileSync(path.join(tmpDir, 'abc123.jsonl'), '');
      fs.writeFileSync(path.join(tmpDir, 'def456.jsonl'), '');
      fs.writeFileSync(path.join(tmpDir, 'not-a-session.txt'), '');

      const ids = listSessionIds(tmpDir);
      expect(ids.sort()).toEqual(['abc123', 'def456']);
    });

    it('returns empty array for empty directory', () => {
      expect(listSessionIds(tmpDir)).toEqual([]);
    });

    it('returns empty array for nonexistent directory', () => {
      expect(listSessionIds(path.join(tmpDir, 'does-not-exist'))).toEqual([]);
    });
  });

  // ── parseChatSessionFile ────────────────────────────────────────────────────

  describe('parseChatSessionFile', () => {
    const SESSION_ID = 'test-session-1';
    const WORKSPACE_HASH = 'abc123hash';

    it('parses customTitle from kind=1 patches', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['customTitle'], v: 'My Test Session' }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);

      expect(result).not.toBeNull();
      expect(result!.sessionInfo.displayName).toBe('My Test Session');
      expect(result!.sessionInfo.sessionId).toBe(SESSION_ID);
      expect(result!.sessionInfo.workspaceHash).toBe(WORKSPACE_HASH);
    });

    it('falls back to timestamp-based title when no customTitle', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      // 2024-01-15 10:30:00 UTC
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1705314600000, requests: [] } }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);

      expect(result).not.toBeNull();
      expect(result!.sessionInfo.displayName).toMatch(/^Session \d{4}-\d{2}-\d{2}/);
    });

    it('uses last customTitle patch when multiple exist', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['customTitle'], v: 'First Title' },
        { kind: 1, k: ['customTitle'], v: 'Final Title' }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.sessionInfo.displayName).toBe('Final Title');
    });

    it('extracts completed turns from kind=1 patches', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['requests', 0, 'requestId'], v: 'req-001' },
        { kind: 1, k: ['requests', 0, 'timestamp'], v: 1700000001000 },
        { kind: 1, k: ['requests', 0, 'modelId'], v: 'copilot/claude-sonnet-4.6' },
        { kind: 1, k: ['requests', 0, 'message', 'text'], v: 'Hello there!' },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 42 },
        { kind: 1, k: ['requests', 0, 'elapsedMs'], v: 1500 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 1 },
        { kind: 1, k: ['requests', 0, 'modelState', 'completedAt'], v: 1700000002500 }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);

      expect(result!.turns).toHaveLength(1);
      const turn = result!.turns[0];
      expect(turn.requestId).toBe('req-001');
      expect(turn.modelId).toBe('copilot/claude-sonnet-4.6');
      expect(turn.completionTokens).toBe(42);
      expect(turn.elapsedMs).toBe(1500);
      expect(turn.messageText).toBe('Hello there!');
      expect(turn.isCompleted).toBe(true);
    });

    it('estimates prompt tokens from message text length', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      const messageText = 'A'.repeat(400); // 400 chars → ~100 tokens
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['requests', 0, 'requestId'], v: 'req-001' },
        { kind: 1, k: ['requests', 0, 'timestamp'], v: 1700000001000 },
        { kind: 1, k: ['requests', 0, 'modelId'], v: 'copilot/gpt-4o' },
        { kind: 1, k: ['requests', 0, 'message', 'text'], v: messageText },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 50 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 1 }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      const turn = result!.turns[0];
      expect(turn.estimatedPromptTokens).toBe(100);
    });

    it('skips in-progress turns (modelState.value !== 1)', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['requests', 0, 'requestId'], v: 'req-001' },
        { kind: 1, k: ['requests', 0, 'modelId'], v: 'copilot/gpt-4o' },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 20 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 0 } // in progress
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns).toHaveLength(0);
    });

    it('handles multiple turns including in-progress ones', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        // Completed turn
        { kind: 1, k: ['requests', 0, 'requestId'], v: 'req-001' },
        { kind: 1, k: ['requests', 0, 'modelId'], v: 'copilot/gpt-4o' },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 30 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 1 },
        // In-progress turn
        { kind: 1, k: ['requests', 1, 'requestId'], v: 'req-002' },
        { kind: 1, k: ['requests', 1, 'modelId'], v: 'copilot/gpt-4o' },
        { kind: 1, k: ['requests', 1, 'completionTokens'], v: 10 },
        { kind: 1, k: ['requests', 1, 'modelState', 'value'], v: 0 }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns).toHaveLength(1);
      expect(result!.turns[0].requestId).toBe('req-001');
    });

    it('estimates cache-eligible tokens from text before the ephemeral marker', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      // 80 chars of text then a cache breakpoint, then more text after.
      // Only the 80 chars before the marker are cache-eligible.
      // 80 / 4 = 20 tokens.
      const renderedBlocks = [
        { type: 1, text: 'a'.repeat(80) },
        { type: 3, cacheType: 'ephemeral' },
        { type: 1, text: 'b'.repeat(40) }
      ];
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['requests', 0, 'requestId'], v: 'req-001' },
        { kind: 1, k: ['requests', 0, 'modelId'], v: 'copilot/claude-sonnet-4.6' },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 20 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 1 },
        { kind: 1, k: ['requests', 0, 'result', 'metadata', 'renderedUserMessage'], v: renderedBlocks }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns[0].cacheEligibleTokens).toBe(20);
    });

    it('uses the latest ephemeral marker when multiple are present', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      // 40 chars, marker, 40 more chars, marker. Cumulative-before-last = 80.
      const renderedBlocks = [
        { type: 1, text: 'a'.repeat(40) },
        { type: 3, cacheType: 'ephemeral' },
        { type: 1, text: 'b'.repeat(40) },
        { type: 3, cacheType: 'ephemeral' },
        { type: 1, text: 'c'.repeat(8) }
      ];
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['requests', 0, 'requestId'], v: 'req-002' },
        { kind: 1, k: ['requests', 0, 'modelId'], v: 'copilot/claude-sonnet-4.6' },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 20 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 1 },
        { kind: 1, k: ['requests', 0, 'result', 'metadata', 'renderedUserMessage'], v: renderedBlocks }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns[0].cacheEligibleTokens).toBe(20);
    });

    it('returns 0 cache tokens when no ephemeral marker is present', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      const renderedBlocks = [{ type: 1, text: 'a'.repeat(400) }];
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 1, k: ['requests', 0, 'requestId'], v: 'req-003' },
        { kind: 1, k: ['requests', 0, 'modelId'], v: 'copilot/claude-sonnet-4.6' },
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 20 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 1 },
        { kind: 1, k: ['requests', 0, 'result', 'metadata', 'renderedUserMessage'], v: renderedBlocks }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns[0].cacheEligibleTokens).toBe(0);
    });

    it('survives malformed (truncated) JSON lines', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      const lines = [
        JSON.stringify({ kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } }),
        '{"kind": 1, "k": ["customTitle"], "v": "Partial...', // truncated
        JSON.stringify({ kind: 1, k: ['customTitle'], v: 'Good Title' })
      ];
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result).not.toBeNull();
      expect(result!.sessionInfo.displayName).toBe('Good Title');
    });

    it('returns null for a nonexistent file', () => {
      const result = parseChatSessionFile(
        path.join(tmpDir, 'missing.jsonl'),
        SESSION_ID,
        WORKSPACE_HASH
      );
      expect(result).toBeNull();
    });

    it('appends full request objects via kind=2 array splice (push to end)', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        // kind=2: splice into requests array. Omitting `i` means append.
        {
          kind: 2,
          k: ['requests'],
          v: [
            {
              requestId: 'req-001',
              timestamp: 1700000001000,
              modelId: 'copilot/gpt-4o',
              message: { text: 'Hello' },
              completionTokens: 42,
              elapsedMs: 1500,
              modelState: { value: 1, completedAt: 1700000002500 }
            }
          ]
        }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns).toHaveLength(1);
      expect(result!.turns[0].requestId).toBe('req-001');
      expect(result!.turns[0].modelId).toBe('copilot/gpt-4o');
      expect(result!.turns[0].completionTokens).toBe(42);
    });

    it('kind=2 inserts at explicit index when `i` is provided', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      const baseRequest = (id: string) => ({
        requestId: id,
        modelId: 'copilot/gpt-4o',
        completionTokens: 10,
        modelState: { value: 1 }
      });
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        { kind: 2, k: ['requests'], v: [baseRequest('a'), baseRequest('c')] },
        // Insert 'b' between 'a' and 'c' at index 1
        { kind: 2, k: ['requests'], i: 1, v: [baseRequest('b')] }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns.map(t => t.requestId)).toEqual(['a', 'b', 'c']);
    });

    it('kind=2 followed by kind=1 patches updates the appended request', () => {
      const filePath = path.join(tmpDir, `${SESSION_ID}.jsonl`);
      writeLines(filePath, [
        { kind: 0, v: { sessionId: SESSION_ID, creationDate: 1700000000000, requests: [] } },
        {
          kind: 2,
          k: ['requests'],
          v: [
            {
              requestId: 'req-001',
              modelId: 'copilot/gpt-4o',
              message: { text: 'Hi' },
              modelState: { value: 0 } // initially in-progress
            }
          ]
        },
        // Later patches complete the request
        { kind: 1, k: ['requests', 0, 'completionTokens'], v: 99 },
        { kind: 1, k: ['requests', 0, 'modelState', 'value'], v: 1 }
      ]);

      const result = parseChatSessionFile(filePath, SESSION_ID, WORKSPACE_HASH);
      expect(result!.turns).toHaveLength(1);
      expect(result!.turns[0].completionTokens).toBe(99);
    });
  });
});
