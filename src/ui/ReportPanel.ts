import * as vscode from 'vscode';
import { PromptAnalyzerDb } from '../storage/database';
import { ReportScope } from '../types';
import { buildReportViewModel } from './reportData';
import { buildReportHtml } from './reportHtml';

/**
 * Editor-area webview panel that renders the cross-cutting usage Report.
 * A new panel instance is created on every `show()` call so users can open
 * multiple reports side-by-side (one per scope).
 */
export class ReportPanel {
  /** All open Report panels, keyed by panel instance, so external code can
   *  push a refresh after the underlying DB changes (e.g. recompute costs). */
  private static readonly _open = new Set<ReportPanel>();

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _scope: ReportScope = { type: 'all' };

  private constructor(private readonly db: PromptAnalyzerDb) {
    this._panel = vscode.window.createWebviewPanel(
      'promptcountant.report',
      'Promptcountant: Report',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    ReportPanel._open.add(this);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  static show(db: PromptAnalyzerDb, scope: ReportScope): void {
    const panel = new ReportPanel(db);
    panel._loadScope(scope);
  }

  /** Re-render every open Report panel against the current DB contents.
   *  Safe to call when no panels are open. */
  static refreshAll(): void {
    for (const p of ReportPanel._open) {
      p._loadScope(p._scope);
    }
  }

  private _loadScope(scope: ReportScope): void {
    this._scope = scope;
    try {
      this.db.reload();
      const rows = this.db.getReportRows(scope);
      const vm = buildReportViewModel({ rows, scope });
      this._panel.title = `Report — ${vm.scopeTitle}`;
      this._panel.webview.html = buildReportHtml({ vm });
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this._panel.webview.html = `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding:16px; color: var(--vscode-errorForeground);">
        <h2>Failed to build report</h2>
        <pre>${escapeForError(msg)}</pre>
      </body></html>`;
      vscode.window.showErrorMessage(`Promptcountant: failed to build report — ${msg}`);
    }
  }

  dispose(): void {
    ReportPanel._open.delete(this);
    this._panel.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }
}

function escapeForError(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
