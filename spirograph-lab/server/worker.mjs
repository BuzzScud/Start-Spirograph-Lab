// One Spirograph Lab job off the server's event loop (labJob.mjs), on its own connections to the bank and data/lab.db.
import { workerData } from 'node:worker_threads';
import { openLabStore } from './labStore.mjs';
import { runLabJob } from './labJob.mjs';

const { bankFile, labFile, id } = workerData;
const lab = openLabStore({ bankFile, labFile });
try {
  runLabJob(lab, lab.job(id));
} catch (e) {
  lab.finish(id, 'failed', e.message);
}
lab.close();
