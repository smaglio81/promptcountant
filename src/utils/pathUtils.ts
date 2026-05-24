import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Derives the workspaceStorage directory from the extension's globalStorageUri.
 * globalStorageUri is: .../User/globalStorage/<extension-id>/
 * Going up 2 levels gives: .../User/
 * Appending 'workspaceStorage' gives the target directory.
 */
export function getWorkspaceStoragePathFromGlobal(globalStorageFsPath: string): string {
  const userDir = path.dirname(path.dirname(globalStorageFsPath));
  return path.join(userDir, 'workspaceStorage');
}

/**
 * Resolves a VS Code workspace.json folder URI to an absolute file-system path.
 * Handles both Windows (file:///C:/...) and POSIX (file:///home/...) forms.
 */
export function resolveWorkspaceFolderUri(folderUri: string): string {
  const url = new URL(folderUri);
  // pathname is URL-encoded; decode it
  let fsPath = decodeURIComponent(url.pathname);
  // On Windows the pathname starts with /C:/... — strip leading slash
  if (process.platform === 'win32' && fsPath.startsWith('/')) {
    fsPath = fsPath.slice(1);
  }
  // Normalise separators
  return path.normalize(fsPath);
}

/**
 * Returns the leaf segment of a path as a display name.
 * e.g. "/home/user/my-project" → "my-project"
 */
export function leafName(fsPath: string): string {
  return path.basename(fsPath) || fsPath;
}

/**
 * Returns true if the given directory exists and is accessible.
 */
export function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Best-effort default workspaceStorage path for the current platform,
 * used as a fallback when extension context is not available (e.g., in tests).
 */
export function defaultWorkspaceStoragePath(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32': {
      const appData = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
      // Try Insiders first, fall back to stable
      const insiders = path.join(appData, 'Code - Insiders', 'User', 'workspaceStorage');
      if (directoryExists(insiders)) return insiders;
      return path.join(appData, 'Code', 'User', 'workspaceStorage');
    }
    case 'darwin': {
      const base = path.join(home, 'Library', 'Application Support');
      const insiders = path.join(base, 'Code - Insiders', 'User', 'workspaceStorage');
      if (directoryExists(insiders)) return insiders;
      return path.join(base, 'Code', 'User', 'workspaceStorage');
    }
    default: {
      const configBase = process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config');
      const insiders = path.join(configBase, 'Code - Insiders', 'User', 'workspaceStorage');
      if (directoryExists(insiders)) return insiders;
      return path.join(configBase, 'Code', 'User', 'workspaceStorage');
    }
  }
}
