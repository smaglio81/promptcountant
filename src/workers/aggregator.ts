import * as fs from 'fs';
import { PromptAnalyzerDb } from '../storage/database';
import { discoverWorkspaces } from '../providers/copilot/workspaceResolver';
import { listSessionFiles, parseChatSessionFile } from '../providers/copilot/chatSessionsParser';
import { refreshPricingCache, calculateTurnCost } from '../pricing/PricingService';
import { WorkerMessage, AggregationProgress, TurnInfo } from '../types';

const TARGET_CPU_FRACTION = 0.15;
const INITIAL_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 500;

export type MessageSender = (msg: WorkerMessage) => void;

/**
 * Core aggregation logic — runs the full discovery + parse + store cycle.
 * Designed to be called from a worker thread; `sendMessage` posts messages
 * back to the main thread.
 *
 * Accepts an optional `isPaused` function so the caller can implement a
 * cooperative pause mechanism.
 */
export async function runAggregation(
  dbPath: string,
  workspaceStoragePaths: string | string[],
  sendMessage: MessageSender,
  isPaused: () => boolean = () => false
): Promise<void> {
  const db = await PromptAnalyzerDb.create(dbPath);
  let finalProgress: AggregationProgress | null = null;

  try {
    // ── 1. Refresh pricing cache ──────────────────────────────────────────────
    await refreshPricingCache(db);

    // ── 2. Discover workspaces (across all VS Code variant paths) ────────────
    const paths = Array.isArray(workspaceStoragePaths) ? workspaceStoragePaths : [workspaceStoragePaths];
    const workspaces = paths.flatMap(p => discoverWorkspaces(p));

    const progress: AggregationProgress = {
      workspacesFound: workspaces.length,
      sessionsFound: 0,
      sessionsProcessed: 0,
      turnsProcessed: 0
    };

    sendMessage({ type: 'progress', payload: progress });

    // ── 3. Process each workspace ────────────────────────────────────────────
    let batchSize = INITIAL_BATCH_SIZE;
    let lastSkipProgressSent = 0;

    for (const { workspaceInfo, chatSessionsPath } of workspaces) {
      await waitIfPaused(isPaused);

      db.upsertWorkspace(workspaceInfo);

      const sessionFiles = listSessionFiles(chatSessionsPath);
      progress.sessionsFound += sessionFiles.length;
      sendMessage({ type: 'progress', payload: { ...progress } });

      for (const { sessionId, filePath } of sessionFiles) {
        await waitIfPaused(isPaused);

        // ── Skip unchanged files ────────────────────────────────────────────
        let fileMtime: number;
        try {
          fileMtime = fs.statSync(filePath).mtimeMs;
        } catch {
          continue; // file disappeared
        }

        const processed = db.getProcessedFile(filePath);
        if (processed && processed.last_modified >= fileMtime) {
          progress.sessionsProcessed++;
          if (Date.now() - lastSkipProgressSent > 500) {
            sendMessage({ type: 'progress', payload: { ...progress } });
            lastSkipProgressSent = Date.now();
          }
          continue; // already up-to-date
        }

        // ── Parse and store ─────────────────────────────────────────────────
        const parsed = parseChatSessionFile(filePath, sessionId, workspaceInfo.hash);
        if (!parsed) continue;

        // Upsert session
        const latestTurnTimestamp =
          parsed.turns.length > 0
            ? Math.max(...parsed.turns.map(t => t.timestamp))
            : null;

        db.upsertSession({
          ...parsed.sessionInfo,
          updatedAt: latestTurnTimestamp ?? undefined
        });

        // Calculate costs and upsert turns in batches with CPU yielding
        const turns = parsed.turns;
        let lastProgressSent = Date.now();
        for (let i = 0; i < turns.length; i += batchSize) {
          await waitIfPaused(isPaused);

          const batchStart = Date.now();
          const batch = turns.slice(i, i + batchSize);

          // Attach cost estimates
          const pricedBatch: TurnInfo[] = batch.map(t => ({
            ...t,
            estimatedCost: calculateTurnCost(t, db)
          }));

          db.upsertTurns(pricedBatch);
          progress.turnsProcessed += pricedBatch.length;

          const batchMs = Date.now() - batchStart;
          batchSize = adaptBatchSize(batchSize, batchMs);

          // Heartbeat progress every ~1s so huge sessions don't look frozen.
          if (Date.now() - lastProgressSent > 1000) {
            sendMessage({ type: 'progress', payload: { ...progress } });
            lastProgressSent = Date.now();
          }

          await yieldCpu(batchMs);
        }

        db.setProcessedFile(filePath, fileMtime);
        progress.sessionsProcessed++;

        sendMessage({ type: 'session_added' });
        sendMessage({ type: 'progress', payload: { ...progress } });
      }
    }

    finalProgress = { ...progress };
  } finally {
    // Close (and flush) the DB before sending 'complete' so that when the
    // main thread receives 'complete' and calls db.reload(), the file is
    // guaranteed to be fully written.
    try {
      db.close();
    } catch {
      // Ignore close/flush errors — the session data was already written
      // incrementally; losing the final flush is acceptable, and we must
      // still send 'complete' so the main thread is never left waiting.
    }
    if (finalProgress) {
      sendMessage({ type: 'complete', payload: finalProgress });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitIfPaused(isPaused: () => boolean): Promise<void> {
  while (isPaused()) {
    await sleep(100);
  }
}

function adaptBatchSize(current: number, batchMs: number): number {
  if (batchMs < 5 && current < MAX_BATCH_SIZE) {
    return Math.min(MAX_BATCH_SIZE, current * 2);
  }
  if (batchMs > 200 && current > MIN_BATCH_SIZE) {
    return Math.max(MIN_BATCH_SIZE, Math.floor(current / 2));
  }
  return current;
}

async function yieldCpu(batchMs: number): Promise<void> {
  const sleepMs = Math.round(batchMs * ((1 / TARGET_CPU_FRACTION) - 1));
  if (sleepMs > 0) {
    await sleep(sleepMs);
  } else {
    // At minimum yield so the event loop can process worker messages
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
