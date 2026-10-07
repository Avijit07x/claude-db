import { measure } from './measure.mjs';
import { silenceSqliteWarning } from '../../dist/util/warnings.js';

silenceSqliteWarning();

const { entry, settings } = JSON.parse(process.argv[2]);
const result = await measure(entry, settings);
process.stdout.write(`${JSON.stringify(result)}\n`);
