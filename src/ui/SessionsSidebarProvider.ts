import * as vscode from 'vscode';
import { PromptAnalyzerDb } from '../storage/database';
import { DbWorkspace, DbSession, ReportScope } from '../types';

interface WorkspacePayload {
  hash: string;
  displayName: string;
  workspacePath: string | null;
  /** chatSessions directory for this workspace (used by "Open chat folder"). */
  chatSessionsPath: string | null;
  sessionCount: number;
  latestActivity: number | null;
  latestActivityLabel: string;
  costLabel: string;
  cost: number;
  sessions: SessionPayload[];
}

interface SessionPayload {
  sessionId: string;
  displayName: string;
  chatSessionsPath: string;
  totalTurns: number;
  costLabel: string;
  updatedAt: number | null;
}

interface IncomingMessage {
  type: string;
  sessionId?: string;
  chatSessionsPath?: string;
  workspacePath?: string | null;
  workspaceHash?: string;
}

/**
 * The entire sidebar — a single Webview that renders both the filter input
 * and the tree (Copilot → workspaces → sessions). This replaces the prior
 * combination of a native TreeView and a separate webview filter view.
 *
 * Why a single webview:
 *   - Lets the filter input sit directly above the tree with no padding.
 *   - Matches the goals.md "search bar at the top of the panel" requirement
 *     literally (it is now a real text input, not a popup).
 *   - Allows a custom HTML right-click context menu on workspace rows
 *     (e.g. "Open in Explorer") that posts back to the extension host.
 */
export class SessionsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'promptcountant.sessions';

  private _view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly db: PromptAnalyzerDb,
    private readonly handlers: {
      onOpenSession: (sessionId: string, chatSessionsPath: string) => void;
      onOpenInExplorer: (workspacePath: string | null) => void;
      onOpenReport: (scope: ReportScope) => void;
      onRevealSessionFile: (sessionId: string, chatSessionsPath: string) => void;
    }
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: IncomingMessage) => {
      switch (msg.type) {
        case 'ready':
          // Reload from disk before posting — the worker may have completed
          // while _view was null (sidebar not yet open), so the in-memory DB
          // could be stale. Uses mtime guard to skip unnecessary I/O when
          // the file has not changed since the last load.
          this.db.reloadIfChanged();
          this.postData();
          break;
        case 'refresh':
          this.db.reload();
          this.postData();
          break;
        case 'openSession':
          if (msg.sessionId && msg.chatSessionsPath) {
            this.handlers.onOpenSession(msg.sessionId, msg.chatSessionsPath);
          }
          break;
        case 'openInExplorer':
          this.handlers.onOpenInExplorer(msg.workspacePath ?? null);
          break;
        case 'revealSessionFile':
          if (msg.sessionId && msg.chatSessionsPath) {
            this.handlers.onRevealSessionFile(msg.sessionId, msg.chatSessionsPath);
          }
          break;
        case 'openReport': {
          const scope: ReportScope = msg.sessionId
            ? { type: 'session', sessionId: msg.sessionId }
            : msg.workspaceHash
            ? { type: 'workspace', workspaceHash: msg.workspaceHash }
            : { type: 'all' };
          this.handlers.onOpenReport(scope);
          break;
        }
      }
    });
  }

  refresh(): void {
    if (!this._view) return;
    this.postData();
  }

  /** Update the "scanning…" status line shown when the tree is empty
   *  or appended below the tree while data is loading. */
  setStatus(message: string | null): void {
    this._view?.webview.postMessage({ type: 'status', message });
  }

  collapseAll(): void {
    this._view?.webview.postMessage({ type: 'collapseAll' });
  }

  private postData(): void {
    if (!this._view) return;
    const workspaces = this.db.getWorkspaces();
    const payload: WorkspacePayload[] = workspaces.map(w =>
      this.toWorkspacePayload(w, this.db.getSessions(w.hash))
    );
    const totalCost = payload.reduce((sum, w) => sum + w.cost, 0);
    this._view.webview.postMessage({ type: 'data', workspaces: payload, totalCost });
  }

  private toWorkspacePayload(w: DbWorkspace, sessions: DbSession[]): WorkspacePayload {
    // All sessions under one workspace share the same chatSessions directory,
    // so the first session's path is representative. If a workspace has no
    // sessions yet, we leave it null and the "open chat folder" action is
    // disabled.
    const chatSessionsPath = sessions[0]?.chat_sessions_path ?? null;
    const workspaceCost = sessions.reduce((sum, s) => sum + (s.total_cost ?? 0), 0);
    return {
      hash: w.hash,
      displayName: w.display_name,
      workspacePath: w.workspace_path,
      chatSessionsPath,
      sessionCount: w.session_count,
      latestActivity: w.latest_activity,
      latestActivityLabel: formatCompactDate(w.latest_activity),
      costLabel: workspaceCost > 0 ? `$${workspaceCost.toFixed(2)}` : '',
      cost: workspaceCost,
      sessions: sessions.map(s => ({
        sessionId: s.session_id,
        displayName: s.display_name,
        chatSessionsPath: s.chat_sessions_path,
        totalTurns: s.total_turns,
        costLabel: s.total_cost != null ? `$${s.total_cost.toFixed(2)}` : '',
        updatedAt: s.updated_at
      }))
    };
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .filter-wrap {
      position: relative;
      padding: 4px 8px 6px 8px;
      flex: 0 0 auto;
    }
    .filter-wrap input {
      box-sizing: border-box;
      width: 100%;
      padding: 3px 24px 3px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      outline: none;
    }
    .filter-wrap input:focus { border-color: var(--vscode-focusBorder); }
    .filter-wrap input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .filter-clear {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      cursor: pointer;
      display: none;
      padding: 0;
      line-height: 1;
      font-size: 14px;
    }
    .scan-status {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px 4px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBar-background, transparent);
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      flex: 0 0 auto;
      overflow: hidden;
    }
    .scan-status[hidden] { display: none; }
    .scan-spinner {
      width: 10px;
      height: 10px;
      border: 1.5px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .scan-status-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .filter-clear.visible { display: inline-block; }

    .tree {
      flex: 1 1 auto;
      overflow: auto;
      padding: 2px 0 6px 0;
    }
    .row {
      display: flex;
      align-items: center;
      padding: 1px 8px 1px 6px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      line-height: 22px;
    }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .row .twisty {
      display: inline-block;
      width: 16px;
      text-align: center;
      flex: 0 0 16px;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      opacity: 0.85;
    }
    .row .twisty.empty { visibility: hidden; }
    .row .icon {
      width: 16px;
      margin-right: 4px;
      flex: 0 0 16px;
      text-align: center;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .row .icon svg { display: block; }
    .row .label {
      flex: 0 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row .desc {
      margin-left: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 0 1 auto;
    }
    .row .cost {
      margin-left: auto;
      padding-left: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      flex: 0 0 auto;
    }
    .level-0 { padding-left: 6px; }
    .level-1 { padding-left: 18px; }
    .level-2 { padding-left: 36px; }

    .empty-msg {
      padding: 10px 14px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    .ctx-menu {
      position: fixed;
      z-index: 100;
      min-width: 160px;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      padding: 4px 0;
      display: none;
    }
    .ctx-menu.visible { display: block; }
    .ctx-menu-item {
      padding: 4px 16px;
      cursor: pointer;
      white-space: nowrap;
    }
    .ctx-menu-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }
    .ctx-menu-item.disabled {
      opacity: 0.5;
      cursor: default;
    }
    .ctx-menu-item.disabled:hover { background: transparent; color: inherit; }
  </style>
</head>
<body>
  <div class="filter-wrap">
    <input id="filter" type="text" placeholder="Filter workspaces &amp; sessions…" autocomplete="off" spellcheck="false" />
    <button id="filter-clear" class="filter-clear" aria-label="Clear filter" title="Clear filter">×</button>
  </div>
  <div id="scan-status" class="scan-status" role="status" aria-live="polite" hidden>
    <div class="scan-spinner" aria-hidden="true"></div>
    <span id="scan-status-text" class="scan-status-text"></span>
  </div>
  <div id="tree" class="tree"></div>
  <div id="ctx-menu" class="ctx-menu" role="menu"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const state = {
      data: [], // [{hash, displayName, ..., sessions:[]}]
      totalCost: 0,
      expanded: new Set(), // workspace hashes the user has explicitly opened
      providerExpanded: true, // Copilot root: starts expanded
      filter: '',
      status: 'Starting scan…'
    };

    // Persist UI state across reloads of the webview
    const prev = vscode.getState();
    if (prev) {
      if (Array.isArray(prev.expanded)) state.expanded = new Set(prev.expanded);
      if (typeof prev.providerExpanded === 'boolean') state.providerExpanded = prev.providerExpanded;
      if (typeof prev.filter === 'string') state.filter = prev.filter;
    }

    function persist() {
      vscode.setState({
        expanded: Array.from(state.expanded),
        providerExpanded: state.providerExpanded,
        filter: state.filter
      });
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function matchesFilter(workspace, session) {
      if (!state.filter) return true;
      const f = state.filter.toLowerCase();
      return (
        session.displayName.toLowerCase().includes(f) ||
        workspace.displayName.toLowerCase().includes(f)
      );
    }

    function render() {
      // Update the persistent scan-status banner (shown whenever a scan is running,
      // regardless of whether the tree has data).
      const scanStatusEl = document.getElementById('scan-status');
      const scanStatusText = document.getElementById('scan-status-text');
      if (state.status) {
        scanStatusText.textContent = state.status;
        scanStatusEl.removeAttribute('hidden');
      } else {
        scanStatusEl.setAttribute('hidden', '');
      }

      const tree = document.getElementById('tree');
      if (!state.data || state.data.length === 0) {
        tree.innerHTML = '<div class="empty-msg">No Copilot sessions found yet.</div>';
        return;
      }

      const filterActive = state.filter.length > 0;
      const out = [];

      // Inline SVG for the Copilot root icon. From vscode-icons/vscode-icons
      // (MIT-licensed), recolored via currentColor to match the tree foreground.
      const copilotSvg = '<svg width="16" height="16" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path fill="currentColor" d="M12.13 3.72c-.5-.01-1 .01-1.53.07-2.15.24-3.76.93-4.77 2.21-.99 1.25-1.21 2.83-1.21 4.35 0 1 .1 2 .44 2.9-.11.4-.17.75-.22 1.07l-.06.38A5.14 5.14 0 0 0 2 18.3v3.41c.22 1.46 6.01 6.56 14 6.56 8.14 0 14-5.3 14-6.64v-3.28c-.12-1.09-1.17-2.99-2.79-3.66a8.1 8.1 0 0 0-.29-1.45c.36-.9.46-1.9.46-2.9 0-1.52-.23-3.1-1.22-4.35-1.01-1.28-2.61-1.97-4.77-2.2-2.1-.24-3.95.05-5.15 1.33l-.25.29a4.95 4.95 0 0 0-3.87-1.7zm-.06 2.63c1.01.03 1.51.3 1.76.57.36.39.63 1.19.43 2.83a4.6 4.6 0 0 1-1.08 2.71c-.53.54-1.38.95-2.87.95-1.62 0-2.24-.35-2.52-.66-.32-.35-.54-1.01-.54-2.4 0-1.34.21-2.18.64-2.72.41-.52 1.22-1.03 3-1.23a8.3 8.3 0 0 1 1.18-.05zm7.85 0c.34-.01.73 0 1.19.05 1.78.2 2.58.7 3 1.23.42.54.64 1.38.64 2.72 0 1.39-.23 2.05-.54 2.4-.28.31-.9.66-2.52.66-1.5 0-2.35-.41-2.87-.95a4.6 4.6 0 0 1-1.08-2.71c-.2-1.64.07-2.44.42-2.83.26-.27.76-.54 1.76-.57zM16 13a5.64 5.64 0 0 0 .95 1.3c1.13 1.16 2.73 1.74 4.74 1.74a7.7 7.7 0 0 0 3.02-.51l.04.2v7.44c-.73.57-4.76 2.51-8.75 2.51s-8.02-1.94-8.76-2.5v-7.45l.04-.2a7.7 7.7 0 0 0 3.02.5c2.01 0 3.61-.57 4.75-1.73A5.67 5.67 0 0 0 16 13zm-3.06 4.78a1.31 1.31 0 0 0-1.31 1.32v2.62a1.31 1.31 0 0 0 2.62 0V19.1a1.31 1.31 0 0 0-1.31-1.32zm5.96.01a1.31 1.31 0 0 0-1.15 1.3v2.63a1.31 1.31 0 0 0 2.63 0V19.1a1.31 1.31 0 0 0-1.48-1.3z"/>' +
        '</svg>';
      const folderIcon = '📁';
      const chatIcon = '💬';

      // Provider row: "Copilot"
      const providerTwisty = state.providerExpanded ? '▼' : '▶';
      out.push(
        '<div class="row level-0" data-action="toggle-provider">' +
          '<span class="twisty">' + providerTwisty + '</span>' +
          '<span class="icon copilot">' + copilotSvg + '</span>' +
          '<span class="label">Copilot</span>' +
          (state.totalCost > 0 ? '<span class="cost">' + escapeHtml('$' + state.totalCost.toFixed(2)) + '</span>' : '') +
        '</div>'
      );

      if (state.providerExpanded) {
        for (const ws of state.data) {
          // Filter the sessions for this workspace
          const visibleSessions = ws.sessions.filter(s => matchesFilter(ws, s));
          if (filterActive && visibleSessions.length === 0) continue;

          // When filtering, force-expand matching workspaces so the user
          // immediately sees what matched. Otherwise: collapsed unless the
          // user explicitly expanded this workspace.
          const expanded = filterActive ? true : state.expanded.has(ws.hash);
          const twisty = expanded ? '▼' : '▶';
          const desc = [
            '(' + ws.sessionCount + ')',
            ws.latestActivityLabel
          ].filter(Boolean).join('  ');

          out.push(
            '<div class="row level-1" data-action="toggle-ws" data-hash="' + escapeHtml(ws.hash) + '" ' +
                 'data-path="' + escapeHtml(ws.workspacePath || '') + '" ' +
                 'data-chat-path="' + escapeHtml(ws.chatSessionsPath || '') + '" ' +
                 'title="' + escapeHtml(ws.workspacePath || ws.displayName) + '">' +
              '<span class="twisty">' + twisty + '</span>' +
              '<span class="icon">' + folderIcon + '</span>' +
              '<span class="label">' + escapeHtml(ws.displayName) + '</span>' +
              '<span class="desc">' + escapeHtml(desc) + '</span>' +
              (ws.costLabel ? '<span class="cost">' + escapeHtml(ws.costLabel) + '</span>' : '') +
            '</div>'
          );

          if (expanded) {
            for (const s of visibleSessions) {
              const turnsLabel = s.totalTurns + ' turn' + (s.totalTurns === 1 ? '' : 's');
              out.push(
                '<div class="row level-2" data-action="open-session" ' +
                    'data-session="' + escapeHtml(s.sessionId) + '" ' +
                    'data-chat-path="' + escapeHtml(s.chatSessionsPath) + '" ' +
                    'title="' + escapeHtml(s.displayName) + '">' +
                  '<span class="twisty empty">·</span>' +
                  '<span class="icon">' + chatIcon + '</span>' +
                  '<span class="label">' + escapeHtml(s.displayName) + '</span>' +
                  '<span class="desc">' + escapeHtml(turnsLabel) + '</span>' +
                  (s.costLabel ? '<span class="cost">' + escapeHtml(s.costLabel) + '</span>' : '') +
                '</div>'
              );
            }
          }
        }
      }

      tree.innerHTML = out.join('');
    }

    // ── Events ───────────────────────────────────────────────────────────────
    const tree = document.getElementById('tree');
    tree.addEventListener('click', e => {
      const row = e.target.closest('.row');
      if (!row) return;
      const action = row.dataset.action;
      if (action === 'toggle-provider') {
        state.providerExpanded = !state.providerExpanded;
        persist();
        render();
      } else if (action === 'toggle-ws') {
        const h = row.dataset.hash;
        if (state.expanded.has(h)) state.expanded.delete(h);
        else state.expanded.add(h);
        persist();
        render();
      } else if (action === 'open-session') {
        vscode.postMessage({
          type: 'openSession',
          sessionId: row.dataset.session,
          chatSessionsPath: row.dataset.chatPath
        });
      }
    });

    // Right-click context menu.
    // Provider "Copilot" row: "Report" (global scope).
    // Workspaces: "Report" + "Open chat folder in Explorer".
    // Sessions:   "Report" + "Details View" (same as double-click).
    // Suppress the default browser menu (with Cut/Copy/Paste) on all rows.
    const ctxMenu = document.getElementById('ctx-menu');
    document.addEventListener('contextmenu', e => {
      const row = e.target.closest('.row');
      if (!row) {
        ctxMenu.classList.remove('visible');
        return;
      }
      const action = row.dataset.action;
      if (action === 'toggle-provider') {
        e.preventDefault();
        ctxMenu.innerHTML =
          '<div class="ctx-menu-item" data-cmd="openReport" data-scope="all">' +
            'Report' +
          '</div>';
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
        ctxMenu.classList.add('visible');
      } else if (action === 'toggle-ws') {
        e.preventDefault();
        const chatPath = row.dataset.chatPath || '';
        const wsHash = row.dataset.hash || '';
        const disabledExp = !chatPath;
        ctxMenu.innerHTML =
          '<div class="ctx-menu-item" data-cmd="openReport" data-scope="workspace" ' +
              'data-hash="' + escapeHtml(wsHash) + '">' +
            'Report' +
          '</div>' +
          '<div class="ctx-menu-item' + (disabledExp ? ' disabled' : '') + '" data-cmd="openChatFolder" ' +
              'data-path="' + escapeHtml(chatPath) + '">' +
            'Open chat folder in Explorer' +
          '</div>';
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
        ctxMenu.classList.add('visible');
      } else if (action === 'open-session') {
        e.preventDefault();
        const sessId = row.dataset.session || '';
        const chatPath = row.dataset.chatPath || '';
        const disabled = !sessId || !chatPath;
        ctxMenu.innerHTML =
          '<div class="ctx-menu-item" data-cmd="openReport" data-scope="session" ' +
              'data-session="' + escapeHtml(sessId) + '">' +
            'Report' +
          '</div>' +
          '<div class="ctx-menu-item' + (disabled ? ' disabled' : '') + '" data-cmd="openSession" ' +
              'data-session="' + escapeHtml(sessId) + '" ' +
              'data-chat-path="' + escapeHtml(chatPath) + '">' +
            'Details View' +
          '</div>' +
          '<div class="ctx-menu-item' + (disabled ? ' disabled' : '') + '" data-cmd="revealSessionFile" ' +
              'data-session="' + escapeHtml(sessId) + '" ' +
              'data-chat-path="' + escapeHtml(chatPath) + '">' +
            'Reveal in Explorer' +
          '</div>';
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
        ctxMenu.classList.add('visible');
      } else {
        e.preventDefault();
        ctxMenu.classList.remove('visible');
      }
    });

    ctxMenu.addEventListener('click', e => {
      const item = e.target.closest('.ctx-menu-item');
      if (!item || item.classList.contains('disabled')) return;
      const cmd = item.dataset.cmd;
      if (cmd === 'openChatFolder') {
        vscode.postMessage({ type: 'openInExplorer', workspacePath: item.dataset.path || null });
      } else if (cmd === 'openSession') {
        vscode.postMessage({
          type: 'openSession',
          sessionId: item.dataset.session,
          chatSessionsPath: item.dataset.chatPath
        });
      } else if (cmd === 'revealSessionFile') {
        vscode.postMessage({
          type: 'revealSessionFile',
          sessionId: item.dataset.session,
          chatSessionsPath: item.dataset.chatPath
        });
      } else if (cmd === 'openReport') {
        const scope = item.dataset.scope;
        const payload = { type: 'openReport' };
        if (scope === 'workspace') payload.workspaceHash = item.dataset.hash || '';
        else if (scope === 'session') payload.sessionId = item.dataset.session || '';
        vscode.postMessage(payload);
      }
      ctxMenu.classList.remove('visible');
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#ctx-menu')) ctxMenu.classList.remove('visible');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') ctxMenu.classList.remove('visible');
    });

    // Filter input
    const input = document.getElementById('filter');
    const clearBtn = document.getElementById('filter-clear');
    input.value = state.filter;
    clearBtn.classList.toggle('visible', state.filter.length > 0);

    let filterTimer = null;
    input.addEventListener('input', () => {
      const v = input.value;
      clearBtn.classList.toggle('visible', v.length > 0);
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        state.filter = v.trim();
        persist();
        render();
      }, 120);
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.remove('visible');
      state.filter = '';
      persist();
      render();
      input.focus();
    });

    // ── Bootstrap ────────────────────────────────────────────────────────────
    window.addEventListener('message', evt => {
      const msg = evt.data;
      if (msg.type === 'data') {
        state.data = msg.workspaces || [];
        state.totalCost = msg.totalCost || 0;
        render();
      } else if (msg.type === 'status') {
        state.status = msg.message || '';
        render();
      } else if (msg.type === 'collapseAll') {
        state.expanded.clear();
        persist();
        render();
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

/**
 * Compact last-activity formatter.
 *   - This year:  M/d HH:mm   (e.g. 5/23 14:07)
 *   - Older:      M/d/yy HH:mm (e.g. 11/2/25 9:30)
 * No leading zeros on month, day, or hour. Minutes keep zero-padding (so
 * "9:05" not "9:5").
 */
function formatCompactDate(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = d.getHours();
  const mi = pad2(d.getMinutes());
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${m}/${day} ${hh}:${mi}`;
  }
  const yy = d.getFullYear() % 100;
  return `${m}/${day}/${yy} ${hh}:${mi}`;
}
