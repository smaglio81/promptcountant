import * as vscode from 'vscode';
import { PromptAnalyzerDb } from '../storage/database';
import { parseChatSessionFile, resolveSessionFilePath } from '../providers/copilot/chatSessionsParser';
import { buildSessionDetailHtml } from './sessionDetailHtml';
import { TurnInfo } from '../types';

/**
 * A single reusable webview panel that renders the per-session breakdown.
 * Subsequent `show()` calls reuse the existing panel and update its content.
 */
export class SessionDetailPanel {
  private static _current: SessionDetailPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _lastSessionId: string | null = null;
  private _lastChatSessionsPath: string | null = null;
  private _parsedTurnsCache: { sessionId: string; turns: TurnInfo[] } | null = null;

  private constructor(
    _extensionUri: vscode.Uri,
    private readonly db: PromptAnalyzerDb
  ) {
    this._panel = vscode.window.createWebviewPanel(
      'promptcountant.sessionDetail',
      'Session Detail',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: {
        type: string;
        requestId?: string;
        sessionId?: string;
        chatSessionsPath?: string;
        workspacePath?: string | null;
      }) => {
        if (
          message.type === 'loadTurnDetail' &&
          message.requestId &&
          message.sessionId &&
          message.chatSessionsPath
        ) {
          this._sendTurnDetail(message.sessionId, message.requestId, message.chatSessionsPath);
        } else if (message.type === 'openInExplorer') {
          this._openInExplorer(message.workspacePath ?? null);
        } else if (message.type === 'openInCode') {
          this._openInCode(message.workspacePath ?? null);
        }
      },
      null,
      this._disposables
    );
  }

  static show(
    extensionUri: vscode.Uri,
    db: PromptAnalyzerDb,
    sessionId: string,
    chatSessionsPath: string
  ): void {
    if (SessionDetailPanel._current) {
      SessionDetailPanel._current._panel.reveal(vscode.ViewColumn.One);
    } else {
      SessionDetailPanel._current = new SessionDetailPanel(extensionUri, db);
    }
    SessionDetailPanel._current._loadSession(sessionId, chatSessionsPath);
  }

  private _loadSession(sessionId: string, chatSessionsPath: string): void {
    this._lastSessionId = sessionId;
    this._lastChatSessionsPath = chatSessionsPath;
    this._parsedTurnsCache = null;
    try {
      const sessions = this.db.getSessions();
      const session = sessions.find(s => s.session_id === sessionId) ?? null;
      const turns = this.db.getTurns(sessionId);

      let workspacePath: string | null = null;
      if (session) {
        const workspaces = this.db.getWorkspaces();
        workspacePath =
          workspaces.find(w => w.hash === session.workspace_hash)?.workspace_path ?? null;
      }

      this._panel.title = session?.display_name ?? 'Session Detail';
      this._panel.webview.html = buildSessionDetailHtml({
        session,
        turns,
        chatSessionsPath,
        workspacePath
      });
    } catch (err) {
      // Surface load errors so the panel is never silently blank.
      const message = (err as Error)?.message ?? String(err);
      this._panel.webview.html = `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding:16px; color: var(--vscode-errorForeground);">
        <h2>Failed to load session</h2>
        <pre>${escapeForError(message)}</pre>
      </body></html>`;
      vscode.window.showErrorMessage(`Promptcountant: failed to load session — ${message}`);
    }
  }

  private _sendTurnDetail(
    sessionId: string,
    requestId: string,
    chatSessionsPath: string
  ): void {
    if (!this._parsedTurnsCache || this._parsedTurnsCache.sessionId !== sessionId) {
      const filePath = resolveSessionFilePath(chatSessionsPath, sessionId);
      const parsed = parseChatSessionFile(filePath, sessionId, '');
      if (!parsed) return;
      this._parsedTurnsCache = { sessionId, turns: parsed.turns };
    }
    const turn = this._parsedTurnsCache.turns.find(t => t.requestId === requestId);
    if (!turn) return;
    this._panel.webview.postMessage({ type: 'turnDetail', data: turn });
  }

  private async _openInExplorer(workspacePath: string | null): Promise<void> {
    // Reveal the session file (.jsonl or legacy .json) in the OS file manager.
    // The workspacePath argument is kept for the existing webview message shape
    // but unused — we always target the data file the panel was built from.
    void workspacePath;
    const sessionId = this._lastSessionId;
    const chatSessionsPath = this._lastChatSessionsPath;
    if (!sessionId || !chatSessionsPath) {
      vscode.window.showWarningMessage(
        'Promptcountant: no session is loaded.'
      );
      return;
    }
    const sessionFilePath = resolveSessionFilePath(chatSessionsPath, sessionId);
    try {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(sessionFilePath));
    } catch (err) {
      vscode.window.showErrorMessage(
        `Promptcountant: could not reveal session file — ${(err as Error).message}`
      );
    }
  }

  private async _openInCode(workspacePath: string | null): Promise<void> {
    // For "Open in Code" we want to inspect the raw session payload, so we
    // open the session file (.jsonl or legacy .json) in a new editor tab. The
    // workspacePath parameter is retained for the webview message shape but
    // unused here — we know the chatSessionsPath/sessionId from state set
    // when the panel was last loaded.
    void workspacePath;
    const sessionId = this._lastSessionId;
    const chatSessionsPath = this._lastChatSessionsPath;
    if (!sessionId || !chatSessionsPath) {
      vscode.window.showWarningMessage(
        'Promptcountant: no session is loaded.'
      );
      return;
    }
    const sessionFilePath = resolveSessionFilePath(chatSessionsPath, sessionId);
    try {
      // Warn before opening files larger than 500 KB — these JSONL logs can
      // grow to several megabytes and may freeze the editor briefly.
      const LARGE_FILE_THRESHOLD_BYTES = 500 * 1024;
      let sizeBytes = 0;
      try {
        sizeBytes = (await vscode.workspace.fs.stat(vscode.Uri.file(sessionFilePath))).size;
      } catch {
        // If we can't stat, just attempt to open and let openTextDocument fail.
      }
      if (sizeBytes > LARGE_FILE_THRESHOLD_BYTES) {
        const sizeLabel = formatBytes(sizeBytes);
        const choice = await vscode.window.showWarningMessage(
          `This is a large file (${sizeLabel}). Are you sure you want to open it in Code?`,
          { modal: true },
          'Open'
        );
        if (choice !== 'Open') return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sessionFilePath));
      // Open in the active editor group (same tab grouping as the Details
      // View panel) per user request — keeps related tabs together rather
      // than spawning a new side group each time.
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
    } catch (err) {
      vscode.window.showErrorMessage(
        `Promptcountant: could not open session file — ${(err as Error).message}`
      );
    }
  }

  dispose(): void {
    SessionDetailPanel._current = undefined;
    this._panel.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }
}

function escapeForError(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
