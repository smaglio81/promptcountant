import { DbSession, DbTurn } from '../types';

/**
 * Pure function that produces the HTML for the SessionDetailPanel webview.
 * Extracted so it can be unit-tested without spinning up a VS Code webview.
 *
 * Inputs are intentionally plain data so the function has no VS Code
 * dependencies.
 */
export interface SessionDetailHtmlInput {
  session: DbSession | null;
  turns: DbTurn[];
  chatSessionsPath: string;
  workspacePath: string | null;
  /** Optional override for deterministic testing. */
  nonce?: string;
}

export function buildSessionDetailHtml(input: SessionDetailHtmlInput): string {
  const nonce = input.nonce ?? generateNonce();
  const { session, turns, chatSessionsPath, workspacePath } = input;

  const sessionId = session?.session_id ?? '';
  const title = escapeHtml(session?.display_name ?? 'Session Detail');
  
  const totalCost = session?.total_cost != null ? `$${session.total_cost.toFixed(2)}` : 'N/A';
  const totalCredits = session?.total_cost != null ? String(Math.round(session.total_cost / 0.01)) : 'N/A';
  const turnCount = turns.length;

  const rowsHtml = turns.map(t => renderRow(t)).join('\n');

  const workspacePathJson = JSON.stringify(workspacePath);
  const openDisabledAttr = sessionId && chatSessionsPath ? '' : 'disabled';
  // "Open in Code" opens the session's .jsonl log; it doesn't depend on
  // workspacePath, so it's always enabled when a session is loaded.
  const openCodeDisabledAttr = sessionId && chatSessionsPath ? '' : 'disabled';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>${title}</title>
  <style nonce="${nonce}">
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      padding: 16px;
      margin: 0;
    }
    h1 { font-size: 1.2em; margin: 0 0 4px 0; }
    .header-bar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }
    .header-bar .title-block { flex: 1 1 auto; min-width: 0; }
    .header-bar .actions { flex: 0 0 auto; padding-top: 4px; display: flex; gap: 6px; }
    .header-bar button {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 4px 10px;
      cursor: pointer;
      border-radius: 2px;
      font: inherit;
    }
    .header-bar button:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    .header-bar button:disabled { opacity: 0.5; cursor: default; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .table-wrapper { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; table-layout: fixed; }
    th {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      vertical-align: bottom;
      line-height: 1.2;
      position: relative;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      user-select: none;
    }
    th.number-th { text-align: right; }
    th .head-sub { display: block; font-size: 0.85em; opacity: 0.8; }
    /* Drag handle on the right edge of each resizable header. */
    .col-resizer {
      position: absolute;
      top: 0;
      right: 0;
      width: 6px;
      height: 100%;
      cursor: col-resize;
      user-select: none;
      z-index: 1;
    }
    .col-resizer:hover, .col-resizer.dragging {
      background: var(--vscode-focusBorder, #007fd4);
      opacity: 0.4;
    }
    td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-list-inactiveSelectionBackground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .turn-row { cursor: pointer; }
    .turn-row:hover { background: var(--vscode-list-hoverBackground); }
    .turn-row.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .model-cell { white-space: nowrap; font-family: var(--vscode-editor-font-family); font-size: 0.85em; }
    .preview-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .number-cell { text-align: right; white-space: nowrap; }
    .cost-cell { text-align: right; white-space: nowrap; font-weight: 500; }
    .detail-panel {
      margin-top: 16px;
      padding: 12px;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      display: none;
    }
    .detail-panel.visible { display: block; }
    .detail-panel pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
      margin: 0;
    }
    .est-note { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 8px; }
    .empty-msg { padding: 24px 8px; color: var(--vscode-descriptionForeground); font-style: italic; }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="title-block">
      <h1>${title}</h1>
      <div class="meta">${turnCount} turn${turnCount !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; Estimated total cost: <strong>${totalCost}</strong> &nbsp;&middot;&nbsp; ${totalCredits} AI credit${totalCredits === '1' ? '' : 's'}</div>
    </div>
    <div class="actions">
      <button id="open-in-explorer" ${openDisabledAttr} title="Reveal this session&#39;s .jsonl log in the OS file manager">Open in Explorer</button>
      <button id="open-in-code" ${openCodeDisabledAttr} title="Open this session&#39;s raw .jsonl log in a new editor tab">Open in Code</button>
    </div>
  </div>
  ${turnCount === 0
    ? '<div class="empty-msg">No turns recorded for this session yet.</div>'
    : `<div class="table-wrapper">
    <table id="turns-table">
      <colgroup>
        <col data-col="time"     style="width: 150px;">
        <col data-col="model"    style="width: 180px;">
        <col data-col="preview"  style="width: 340px;">
        <col data-col="output"   style="width: 80px;">
        <col data-col="input"    style="width: 80px;">
        <col data-col="cache"    style="width: 80px;">
        <col data-col="duration" style="width: 80px;">
        <col data-col="cost"     style="width: 90px;">
        <col data-col="credits"  style="width: 70px;">
      </colgroup>
      <thead>
        <tr>
          <th data-col="time">Time<span class="col-resizer"></span></th>
          <th data-col="model">Model<span class="col-resizer"></span></th>
          <th data-col="preview">Message preview<span class="col-resizer"></span></th>
          <th class="number-th" data-col="output">Output<span class="head-sub">tokens</span><span class="col-resizer"></span></th>
          <th class="number-th" data-col="input">Input<span class="head-sub">tokens</span><span class="col-resizer"></span></th>
          <th class="number-th" data-col="cache">Cache<span class="head-sub">tokens</span><span class="col-resizer"></span></th>
          <th class="number-th" data-col="duration">Duration<span class="col-resizer"></span></th>
          <th class="number-th" data-col="cost">Cost<span class="head-sub">~ USD</span><span class="col-resizer"></span></th>
          <th class="number-th" data-col="credits">AI<span class="head-sub">credits</span></th>
        </tr>
      </thead>
      <tbody id="turns-body">
${rowsHtml}
      </tbody>
    </table>
  </div>
  <div id="detail-panel" class="detail-panel">
    <strong>Full message</strong>
    <pre id="detail-content"></pre>
  </div>
  <p class="est-note">~ values are estimates. Prompt tokens estimated at 4 chars/token. Cache usage assumed warm after first turn.</p>`}

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const sessionId = ${JSON.stringify(sessionId)};
      const chatSessionsPath = ${JSON.stringify(chatSessionsPath)};
      const workspacePath = ${workspacePathJson};
      let selected = null;

      // ── Column resizing ──────────────────────────────────────────────
      // Each <th> has a 6px-wide drag handle on its right edge. Dragging
      // it adjusts the corresponding <col> width. Widths persist via
      // vscode.setState so they survive panel reloads.
      const table = document.getElementById('turns-table');
      if (table) {
        const cols = table.querySelectorAll('colgroup col');
        const persisted = (vscode.getState && vscode.getState()) || {};
        const widths = persisted.colWidths || {};
        cols.forEach(function(col) {
          const key = col.dataset.col;
          if (widths[key]) col.style.width = widths[key];
        });

        function saveWidths() {
          const out = {};
          cols.forEach(function(c) { out[c.dataset.col] = c.style.width; });
          const prev = (vscode.getState && vscode.getState()) || {};
          vscode.setState(Object.assign({}, prev, { colWidths: out }));
        }

        table.querySelectorAll('th .col-resizer').forEach(function(handle) {
          handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const th = handle.parentElement;
            const key = th.dataset.col;
            const col = table.querySelector('colgroup col[data-col="' + key + '"]');
            if (!col) return;
            const startX = e.clientX;
            const startWidth = th.getBoundingClientRect().width;
            handle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';

            function onMove(ev) {
              const delta = ev.clientX - startX;
              const next = Math.max(40, startWidth + delta);
              col.style.width = next + 'px';
            }
            function onUp() {
              handle.classList.remove('dragging');
              document.body.style.cursor = '';
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              saveWidths();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
        });
      }

      const tbody = document.getElementById('turns-body');
      if (tbody) {
        tbody.addEventListener('click', function(e) {
          const row = e.target.closest('.turn-row');
          if (!row) return;
          if (selected) selected.classList.remove('selected');
          row.classList.add('selected');
          selected = row;
          vscode.postMessage({
            type: 'loadTurnDetail',
            requestId: row.dataset.requestId,
            sessionId: sessionId,
            chatSessionsPath: chatSessionsPath
          });
        });
      }

      const openBtn = document.getElementById('open-in-explorer');
      if (openBtn && !openBtn.disabled) {
        openBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'openInExplorer', workspacePath: workspacePath });
        });
      }

      const openCodeBtn = document.getElementById('open-in-code');
      if (openCodeBtn && !openCodeBtn.disabled) {
        openCodeBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'openInCode', workspacePath: workspacePath });
        });
      }

      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (msg && msg.type === 'turnDetail') {
          const panel = document.getElementById('detail-panel');
          const content = document.getElementById('detail-content');
          if (panel && content) {
            content.textContent = (msg.data && msg.data.messageText) || '(no message text)';
            panel.classList.add('visible');
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}

function renderRow(t: DbTurn): string {
  const ts = t.timestamp ? new Date(t.timestamp).toLocaleString() : '\u2014';
  const model = escapeHtml(formatModelLabel(t.model_id, t.resolved_model));
  const preview = escapeHtml((t.message_text ?? '').slice(0, 120));
  const completionTok = t.completion_tokens != null ? String(t.completion_tokens) : '\u2014';
  const promptTok =
    t.estimated_prompt_tokens != null ? `~${t.estimated_prompt_tokens}` : '\u2014';
  const cacheTok = t.cache_eligible_tokens > 0 ? `~${t.cache_eligible_tokens}` : '\u2014';
  const cost = t.estimated_cost != null ? `$${t.estimated_cost.toFixed(5)}` : 'N/A';
  const credits = t.estimated_cost != null ? String(Math.round(t.estimated_cost / 0.01)) : 'N/A';
  const elapsed = t.elapsed_ms != null ? `${(t.elapsed_ms / 1000).toFixed(2)}s` : '\u2014';
  return `        <tr class="turn-row" data-request-id="${escapeHtml(t.request_id)}" title="Click to view full details">
          <td>${escapeHtml(ts)}</td>
          <td class="model-cell">${model}</td>
          <td class="preview-cell">${preview}</td>
          <td class="number-cell" title="Output tokens (completion)">${completionTok}</td>
          <td class="number-cell" title="Estimated input/prompt tokens">${promptTok}</td>
          <td class="number-cell" title="Cache-eligible tokens (ephemeral)">${cacheTok}</td>
          <td class="number-cell">${elapsed}</td>
          <td class="cost-cell">${cost}</td>
          <td class="cost-cell" title="1 AI credit = $0.01, rounded">${credits}</td>
        </tr>`;
}

/**
 * Renders the Model column. We strip the `copilot/` prefix (noise) and, for
 * `copilot/auto` turns, show the actually resolved model with an `(auto)`
 * suffix (e.g. `gpt-5.3-codex (auto)`) so the user can see which underlying
 * model Copilot picked.
 */
function formatModelLabel(modelId: string | null | undefined, resolved: string | null | undefined): string {
  if (!modelId) return '\u2014';
  if (modelId === 'copilot/auto') {
    const r = resolved ? stripCopilotPrefix(resolved) : null;
    return r ? `${r} (auto)` : 'auto';
  }
  return stripCopilotPrefix(modelId);
}

function stripCopilotPrefix(id: string): string {
  return id.startsWith('copilot/') ? id.slice('copilot/'.length) : id;
}

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
