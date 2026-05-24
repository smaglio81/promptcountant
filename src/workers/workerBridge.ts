import { Worker } from 'worker_threads';
import * as path from 'path';
import { WorkerMessage, AggregationProgress } from '../types';

export type OnSessionAdded = () => void;
export type OnProgress = (progress: AggregationProgress) => void;
export type OnComplete = () => void;
export type OnError = (message: string) => void;

export class WorkerBridge {
  private worker: Worker | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly workspaceStoragePath: string,
    private readonly onSessionAdded: OnSessionAdded,
    private readonly onProgress: OnProgress = () => undefined,
    private readonly onComplete: OnComplete = () => undefined,
    private readonly onError: OnError = () => undefined
  ) {}

  start(): void {
    if (this.worker) return; // already running

    const workerScript = path.join(__dirname, 'aggregationWorker.js');

    this.worker = new Worker(workerScript, {
      workerData: {
        dbPath: this.dbPath,
        workspaceStoragePath: this.workspaceStoragePath
      }
    });

    this.worker.on('message', (msg: WorkerMessage) => {
      switch (msg.type) {
        case 'session_added':
          this.onSessionAdded();
          break;
        case 'progress':
          this.onProgress(msg.payload as AggregationProgress);
          break;
        case 'complete':
          this.onComplete();
          this.worker = null;
          break;
        case 'error':
          this.onError(
            (msg.payload as { message?: string })?.message ?? 'Unknown worker error'
          );
          break;
      }
    });

    this.worker.on('error', err => {
      this.onError(err.message);
      this.worker = null;
    });

    this.worker.on('exit', code => {
      if (code !== 0) {
        this.onError(`Worker exited with code ${code}`);
      }
      this.worker = null;
    });
  }

  pause(): void {
    this.worker?.postMessage({ type: 'pause' });
  }

  resume(): void {
    this.worker?.postMessage({ type: 'resume' });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  get isRunning(): boolean {
    return this.worker !== null;
  }
}
