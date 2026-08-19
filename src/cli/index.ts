#!/usr/bin/env node
import { scopeFrom } from './args.js';
import { usage } from './usage.js';
import { cmdInstall, cmdStatus, cmdUninstall } from './commands/setup.js';
import { cmdUse } from './commands/use.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdSync } from './commands/sync.js';
import { cmdForget, cmdRemember, cmdSearch } from './commands/memory.js';
import { cmdExport, cmdImport, cmdPrune, cmdReembed } from './commands/transfer.js';
import { cmdMerge, cmdProjects, cmdStats } from './commands/insight.js';
import { cmdFlush, cmdReset, cmdUpdate } from './commands/maintain.js';
import { cmdScan, cmdUsages } from './commands/graph.js';
import { cmdSeed } from './commands/seed.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const [command, ...args] = process.argv.slice(2);

try {
  await run();
} catch (error) {
  console.error(`claude-db: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function run(): Promise<void> {
  switch (command) {
    case 'install':
      await cmdInstall(scopeFrom(args));
      break;
    case 'uninstall':
      cmdUninstall(scopeFrom(args));
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'use':
      await cmdUse(args);
      break;
    case 'doctor':
      await cmdDoctor(args);
      break;
    case 'search':
      await cmdSearch(args);
      break;
    case 'remember':
      await cmdRemember(args);
      break;
    case 'forget':
      await cmdForget(args);
      break;
    case 'export':
      await cmdExport(args);
      break;
    case 'import':
      await cmdImport(args[0]);
      break;
    case 'prune':
      await cmdPrune(args);
      break;
    case 'reembed':
      await cmdReembed();
      break;
    case 'stats':
      await cmdStats();
      break;
    case 'update':
      await cmdUpdate(args);
      break;
    case 'flush':
      await cmdFlush();
      break;
    case 'reset':
      await cmdReset(args);
      break;
    case 'projects':
      await cmdProjects();
      break;
    case 'merge':
      await cmdMerge(args);
      break;
    case 'seed':
      await cmdSeed(args);
      break;
    case 'usages':
      await cmdUsages(args);
      break;
    case 'scan':
      await cmdScan(args);
      break;
    case 'sync':
      await cmdSync(args);
      break;
    default:
      usage();
  }
}
