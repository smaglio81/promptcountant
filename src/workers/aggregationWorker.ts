import { parentPort, workerData } from 'worker_threads';
import { runAggregation } from './aggregator';
import { WorkerMessage } from '../types';

interface WorkerData {
  dbPath: string;
  workspaceStoragePaths: string[];
}

const data = workerData as WorkerData;
let paused = false;

// Listen for pause/resume commands from the main thread
parentPort!.on('message', (msg: { type: string }) => {
  if (msg.type === 'pause') paused = true;
  else if (msg.type === 'resume') paused = false;
});

function sendMessage(msg: WorkerMessage): void {
  parentPort!.postMessage(msg);
}

// Surface anything the catch below might miss (e.g. async errors thrown
// outside the promise chain) as an error message to the main thread so
// the user is never left with a silent worker.
process.on('uncaughtException', err => {
  sendMessage({
    type: 'error',
    payload: { message: `uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}` }
  });
});
process.on('unhandledRejection', reason => {
  sendMessage({
    type: 'error',
    payload: { message: `unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}` }
  });
});

runAggregation(
  data.dbPath,
  data.workspaceStoragePaths,
  sendMessage,
  () => paused
).catch(err => {
  sendMessage({
    type: 'error',
    payload: { message: err instanceof Error ? (err.stack ?? err.message) : String(err) }
  });
});
