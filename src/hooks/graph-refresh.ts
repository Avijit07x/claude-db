import { GRAPH_JOB } from '../graph/scan/job.js';
import { claimJob, releaseJob } from '../util/job-lock.js';
import { CLI, runDetached } from './detached.js';

export function refreshGraphInBackground(project: string, root: string, now = Date.now()): boolean {
  if (!claimJob(GRAPH_JOB, project, now)) return false;
  runDetached(CLI, ['scan', '--background', '--path', root], project, () =>
    releaseJob(GRAPH_JOB, project),
  );
  return true;
}
