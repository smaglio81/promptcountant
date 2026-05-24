import * as fs from 'fs';
import * as path from 'path';
import { PromptAnalyzerDb } from '../storage/database';
import { discoverWorkspaces } from '../providers/copilot/workspaceResolver';
import { listSessionIds, parseChatSessionFile } from '../providers/copilot/chatSessionsParser';
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
  workspaceStoragePath: string,
  sendMessage: MessageSender,
  isPaused: () => boolean = () => false
): Promise<void> {
  const db = await PromptAnalyzerDb.create(dbPath);

  try {
    // ── 1. Refresh pricing cache ──────────────────────────────────────────────
    await refreshPricingCache(db);

    // ── 2. Discover workspaces ───────────────────────────────────────────────
    const workspaces = discoverWorkspaces(workspaceStoragePath);

    const progress: AggregationProgress = {
      workspacesFound: workspaces.length,
      sessionsFound: 0,
      sessionsProcessed: 0,
      turnsProcessed: 0
    };

    sendMessage({ type: 'progress', payload: progress });

    // ── 3. Process each workspace ────────────────────────────────────────────
    let batchSize = INITIAL_BATCH_SIZE;

    for (const { workspaceInfo, chatSessionsPath } of workspaces) {
      await waitIfPaused(isPaused);

      db.upsertWorkspace(workspaceInfo);

      const sessionIds = listSessionIds(chatSessionsPath);
      progress.sessionsFound += sessionIds.length;

      for (const sessionId of sessionIds) {
        await waitIfPaused(isPaused);

        const filePath = path.join(chatSessionsPath, `${sessionId}.jsonl`);

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

    sendMessage({ type: 'complete', payload: { ...progress } });
  } finally {
    db.close();
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
