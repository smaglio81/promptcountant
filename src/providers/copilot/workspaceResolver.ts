import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceInfo } from '../../types';
import { resolveWorkspaceFolderUri, leafName } from '../../utils/pathUtils';

const CHAT_SESSIONS_SUBDIR = 'chatSessions';

export interface WorkspaceDiscoveryResult {
  workspaceInfo: WorkspaceInfo;
  chatSessionsPath: string;
}

/**
 * Reads workspace.json from a workspaceStorage hash directory and returns
 * a WorkspaceInfo, or null if the hash has no Copilot sessions or is not
 * a valid workspace folder.
 */
export function resolveWorkspaceHash(
  workspaceStoragePath: string,
  hash: string
): WorkspaceDiscoveryResult | null {
  const hashDir = path.join(workspaceStoragePath, hash);
  const chatSessionsPath = path.join(hashDir, CHAT_SESSIONS_SUBDIR);

  // Skip if there are no Copilot chat sessions here
  if (!directoryExistsSync(chatSessionsPath)) {
    return null;
  }

  const workspaceJsonPath = path.join(hashDir, 'workspace.json');
  let displayName = '(unknown workspace)';
  let workspacePath: string | null = null;

  if (fileExistsSync(workspaceJsonPath)) {
    try {
      const raw = fs.readFileSync(workspaceJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, string>;

      if (parsed['folder']) {
        const resolved = resolveWorkspaceFolderUri(parsed['folder']);
        workspacePath = resolved;
        displayName = leafName(resolved);
      } else if (parsed['workspace']) {
        const resolved = resolveWorkspaceFolderUri(parsed['workspace']);
        workspacePath = resolved;
        // e.g. "my-project.code-workspace" → "my-project"
        const base = path.basename(resolved, '.code-workspace');
        displayName = base || leafName(resolved);
      }
    } catch {
      // Malformed workspace.json — keep default display name
    }
  }

  return {
    workspaceInfo: { hash, displayName, workspacePath },
    chatSessionsPath
  };
}

/**
 * Discovers all workspace hashes that have GitHub Copilot chat sessions.
 * Returns results sorted by most recent chatSessions directory mtime.
 */
export function discoverWorkspaces(workspaceStoragePath: string): WorkspaceDiscoveryResult[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspaceStoragePath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: Array<WorkspaceDiscoveryResult & { mtime: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hash = entry.name;
    // VS Code workspace hash folders are hex strings (typically 32 chars)
    // Non-hash directories (e.g. 'ext-dev') always lack workspace.json
    const result = resolveWorkspaceHash(workspaceStoragePath, hash);
    if (!result) continue;

    let mtime = 0;
    try {
      mtime = fs.statSync(result.chatSessionsPath).mtimeMs;
    } catch {
      // ignore
    }
    results.push({ ...result, mtime });
  }

  // Sort by most recent activity first
  results.sort((a, b) => b.mtime - a.mtime);
  return results.map(({ workspaceInfo, chatSessionsPath }) => ({ workspaceInfo, chatSessionsPath }));
}

function directoryExistsSync(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function fileExistsSync(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
