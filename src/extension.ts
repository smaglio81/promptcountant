import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PromptAnalyzerDb } from './storage/database';
import { WorkerBridge } from './workers/workerBridge';
import { SessionsSidebarProvider } from './ui/SessionsSidebarProvider';
import { SessionDetailPanel } from './ui/SessionDetailPanel';
import { ReportPanel } from './ui/ReportPanel';
import { getWorkspaceStoragePathFromGlobal, allWorkspaceStoragePaths } from './utils/pathUtils';
import { resolveSessionFilePath } from './providers/copilot/chatSessionsParser';
import { ReportScope } from './types';
import { calculateTurnCost, refreshPricingCache } from './pricing/PricingService';

let db: PromptAnalyzerDb | undefined;
let workerBridge: WorkerBridge | undefined;
let output: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Promptcountant');
  context.subscriptions.push(output);
  output.appendLine(`[activate] Promptcountant starting at ${new Date().toISOString()}`);

  // Ensure global storage directory exists (VS Code may not create it until first write)
  const storageFsPath = context.globalStorageUri.fsPath;
  if (!fs.existsSync(storageFsPath)) {
    fs.mkdirSync(storageFsPath, { recursive: true });
  }

  const dbPath = path.join(storageFsPath, 'promptcountant.db');
  output.appendLine(`[activate] dbPath=${dbPath}`);
  let dbStartedAt = Date.now();
  try {
    db = await PromptAnalyzerDb.create(dbPath);
    output.appendLine(`[activate] DB ready in ${Date.now() - dbStartedAt}ms`);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    output!.appendLine(`[activate] DB init FAILED: ${msg}`);
    vscode.window.showErrorMessage(`Promptcountant: failed to initialize database — ${(err as Error).message}`);
    return;
  }

  const workspaceStoragePath = getWorkspaceStoragePathFromGlobal(storageFsPath);
  const workspaceStoragePaths = allWorkspaceStoragePaths(workspaceStoragePath);
  output.appendLine(`[activate] workspaceStoragePaths=${workspaceStoragePaths.join(', ')}`);

  // ── Sidebar (single webview: filter + tree) ─────────────────────────────────
  const sidebar = new SessionsSidebarProvider(context.extensionUri, db, {
    onOpenSession: (sessionId, chatSessionsPath) => {
      if (db) {
        SessionDetailPanel.show(context.extensionUri, db, sessionId, chatSessionsPath);
      }
    },
    onOpenInExplorer: async workspacePath => {
      if (!workspacePath) {
        vscode.window.showWarningMessage(
          'Promptcountant: no folder path is available for this item.'
        );
        return;
      }
      try {
        await vscode.commands.executeCommand(
          'revealFileInOS',
          vscode.Uri.file(workspacePath)
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Promptcountant: could not open folder — ${(err as Error).message}`
        );
      }
    },
    onOpenReport: (scope: ReportScope) => {
      if (db) {
        ReportPanel.show(db, scope);
      }
    },
    onRevealSessionFile: async (sessionId: string, chatSessionsPath: string) => {
      const sessionFilePath = resolveSessionFilePath(chatSessionsPath, sessionId);
      try {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(sessionFilePath));
      } catch (err) {
        vscode.window.showErrorMessage(
          `Promptcountant: could not reveal session file — ${(err as Error).message}`
        );
      }
    }
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SessionsSidebarProvider.viewType, sidebar)
  );

  // ── Commands ────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('promptcountant.refresh', () => {
      db?.reload();
      sidebar.refresh();
    }),

    vscode.commands.registerCommand('promptcountant.collapseAll', () => {
      sidebar.collapseAll();
    }),

    vscode.commands.registerCommand(
      'promptcountant.openSession',
      (sessionId: string, chatSessionsPath: string) => {
        if (db) {
          SessionDetailPanel.show(context.extensionUri, db, sessionId, chatSessionsPath);
        }
      }
    ),

    vscode.commands.registerCommand(
      'promptcountant.openReport',
      (scope?: ReportScope) => {
        if (db) {
          ReportPanel.show(db, scope ?? { type: 'all' });
        }
      }
    ),

    vscode.commands.registerCommand('promptcountant.recomputeCosts', async () => {
      if (!db) return;
      sidebar.setStatus('Recomputing costs…');
      output!.appendLine('[recompute] refreshing price catalog');
      try {
        await refreshPricingCache(db);
        output!.appendLine('[recompute] in-place recompute starting');
        const n = db.recomputeAllCosts(turn => calculateTurnCost(turn, db!));
        output!.appendLine(`[recompute] updated ${n} turns`);
        sidebar.setStatus(null);
        db.reload();
        sidebar.refresh();
        ReportPanel.refreshAll();
        vscode.window.showInformationMessage(`Promptcountant: recomputed costs for ${n.toLocaleString()} turns.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        output!.appendLine(`[recompute] failed: ${msg}`);
        sidebar.setStatus(null);
        vscode.window.showErrorMessage(`Promptcountant: recompute failed — ${msg}`);
      }
    }),

    vscode.commands.registerCommand('promptcountant.resetDatabase', async () => {
      try {
        workerBridge?.stop();
        db?.resetForReprocess();
        db?.reload();
        sidebar.refresh();
        sidebar.setStatus('Re-scanning all sessions…');
        output!.appendLine('[reset] turns cleared, restarting worker');
        workerBridge?.start();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        output!.appendLine(`[reset] failed: ${msg}`);
        vscode.window.showErrorMessage(`Promptcountant: reset failed — ${msg}`);
      }
    })
  );

  // ── Background aggregation ──────────────────────────────────────────────────
  // Per goals.md "Notifications Policy": no success/progress toasts. Surface
  // problems only when something actually fails. Live progress is shown in
  // the sidebar status line and to the Output channel.
  sidebar.setStatus('Discovering Copilot workspaces…');
  const workerStartedAt = Date.now();
  workerBridge = new WorkerBridge(
    dbPath,
    workspaceStoragePaths,
    /* onSessionAdded */ () => {
      db?.reload();
      sidebar.refresh();
    },
    /* onProgress     */ progress => {
      const total = progress.sessionsFound;
      const done = progress.sessionsProcessed;
      const ws = progress.workspacesFound;
      const turns = progress.turnsProcessed;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const status = total > 0
        ? `Scanning sessions: ${done}/${total} (${pct}%) — ${turns.toLocaleString()} turns, ${ws} workspace${ws === 1 ? '' : 's'}`
        : `Discovering workspaces… (${ws} found)`;
      sidebar.setStatus(status);
      output!.appendLine(`[progress] ${status}`);
    },
    /* onComplete     */ () => {
      const elapsed = ((Date.now() - workerStartedAt) / 1000).toFixed(1);
      output!.appendLine(`[complete] aggregation finished in ${elapsed}s`);
      sidebar.setStatus(null);
      db?.reload();
      sidebar.refresh();
    },
    /* onError        */ msg => {
      output!.appendLine(`[error] ${msg}`);
      sidebar.setStatus(`Scan failed: ${msg}`);
      vscode.window.showErrorMessage(`Promptcountant: aggregation error — ${msg}`);
    }
  );

  workerBridge.start();
  output.appendLine(`[activate] worker started`);
}

export function deactivate(): void {
  workerBridge?.stop();
  db?.close();
}
