import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveWorkspaceHash,
  discoverWorkspaces
} from '../src/providers/copilot/workspaceResolver';

describe('workspaceResolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-ws-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createWorkspaceHash(
    hash: string,
    workspaceJsonContent: object | null,
    hasChatSessions: boolean
  ): string {
    const hashDir = path.join(tmpDir, hash);
    fs.mkdirSync(hashDir);

    if (workspaceJsonContent !== null) {
      fs.writeFileSync(
        path.join(hashDir, 'workspace.json'),
        JSON.stringify(workspaceJsonContent),
        'utf8'
      );
    }

    if (hasChatSessions) {
      const chatSessionsDir = path.join(hashDir, 'chatSessions');
      fs.mkdirSync(chatSessionsDir, { recursive: true });
    }

    return hashDir;
  }

  describe('resolveWorkspaceHash', () => {
    it('returns null if chatSessions directory does not exist', () => {
      fs.mkdirSync(path.join(tmpDir, 'nohash'));
      const result = resolveWorkspaceHash(tmpDir, 'nohash');
      expect(result).toBeNull();
    });

    it('returns unknown workspace if workspace.json is missing', () => {
      createWorkspaceHash('abc1', null, true);
      const result = resolveWorkspaceHash(tmpDir, 'abc1');
      expect(result).not.toBeNull();
      expect(result!.workspaceInfo.displayName).toBe('(unknown workspace)');
      expect(result!.workspaceInfo.workspacePath).toBeNull();
    });

    it('resolves folder URI to display name on current platform', () => {
      // Use a platform-appropriate URI
      const isWindows = process.platform === 'win32';
      const folderUri = isWindows
        ? 'file:///c%3A/Users/test/my-project'
        : 'file:///home/test/my-project';

      createWorkspaceHash('abc2', { folder: folderUri }, true);
      const result = resolveWorkspaceHash(tmpDir, 'abc2');

      expect(result).not.toBeNull();
      expect(result!.workspaceInfo.displayName).toBe('my-project');
      expect(result!.workspaceInfo.hash).toBe('abc2');
    });

    it('extracts workspace name from .code-workspace path', () => {
      const isWindows = process.platform === 'win32';
      const workspaceUri = isWindows
        ? 'file:///c%3A/projects/my-mono.code-workspace'
        : 'file:///home/test/my-mono.code-workspace';

      createWorkspaceHash('abc3', { workspace: workspaceUri }, true);
      const result = resolveWorkspaceHash(tmpDir, 'abc3');

      expect(result!.workspaceInfo.displayName).toBe('my-mono');
    });

    it('handles malformed workspace.json gracefully', () => {
      const hashDir = path.join(tmpDir, 'abc4');
      fs.mkdirSync(hashDir);
      fs.mkdirSync(path.join(hashDir, 'chatSessions'), { recursive: true });
      fs.writeFileSync(path.join(hashDir, 'workspace.json'), '{bad json}', 'utf8');

      const result = resolveWorkspaceHash(tmpDir, 'abc4');
      expect(result!.workspaceInfo.displayName).toBe('(unknown workspace)');
    });

    it('returns the chatSessions path', () => {
      createWorkspaceHash('abc5', { folder: 'file:///home/x/proj' }, true);
      const result = resolveWorkspaceHash(tmpDir, 'abc5');
      expect(result!.chatSessionsPath).toContain('chatSessions');
    });
  });

  describe('discoverWorkspaces', () => {
    it('returns empty array for empty workspaceStorage', () => {
      expect(discoverWorkspaces(tmpDir)).toHaveLength(0);
    });

    it('returns empty array for nonexistent path', () => {
      expect(discoverWorkspaces(path.join(tmpDir, 'missing'))).toHaveLength(0);
    });

    it('discovers multiple workspaces with Copilot sessions', () => {
      createWorkspaceHash('hash1', { folder: 'file:///home/a/proj-a' }, true);
      createWorkspaceHash('hash2', { folder: 'file:///home/a/proj-b' }, true);
      createWorkspaceHash('hash3', { folder: 'file:///home/a/proj-c' }, false); // no copilot sessions

      const results = discoverWorkspaces(tmpDir);
      expect(results).toHaveLength(2);
      const names = results.map(r => r.workspaceInfo.displayName);
      expect(names).toContain('proj-a');
      expect(names).toContain('proj-b');
    });

    it('ignores non-directory entries', () => {
      fs.writeFileSync(path.join(tmpDir, 'somefile.txt'), 'data');
      createWorkspaceHash('valid1', { folder: 'file:///home/x/p' }, true);
      const results = discoverWorkspaces(tmpDir);
      expect(results).toHaveLength(1);
    });
  });
});
