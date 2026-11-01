import { setConfigValue } from '../../config/index.js';
import { askDaemon, startDaemon } from '../../daemon/client.js';
import { buildId } from '../../daemon/paths.js';

const STOP = '__stop';

async function running(): Promise<boolean> {
  const asked = await askDaemon({ build: buildId(), hook: '__ping', raw: '', env: {} }, 1000);
  return asked.kind === 'done';
}

export async function cmdDaemon(argv: (string | undefined)[]): Promise<void> {
  const [action] = argv;
  switch (action) {
    case 'on':
    case 'off':
      setConfigValue('daemon', 'enabled', action === 'on');
      if (action === 'off')
        await askDaemon({ build: buildId(), hook: STOP, raw: '', env: {} }, 2000);
      console.log(`daemon: ${action}`);
      return;
    case 'start':
      console.log(startDaemon() ? 'daemon: starting' : 'daemon: already starting');
      return;
    case 'stop':
      await askDaemon({ build: buildId(), hook: STOP, raw: '', env: {} }, 2000);
      console.log('daemon: stopped');
      return;
    default:
      console.log(`daemon: ${(await running()) ? 'running' : 'not running'}`);
  }
}
