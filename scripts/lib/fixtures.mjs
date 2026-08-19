import { ConfigSchema } from '../../dist/config/index.js';
const e = (id, score = 0) => ({
  id,
  kind: 'context',
  title: id,
  project: 'p',
  createdAt: 0,
  score,
});
const now = Date.now();
const day = 86_400_000;

const config = ConfigSchema.parse({});
const turn = (over = {}) => ({
  prompt: 'store the api key somewhere',
  reasoning: 'Wrote the client. <private>my ssn is 123</private> Key is "sk-abcdefghijklmnopqrst".',
  files: ['/p/src/auth.ts'],
  commands: [],
  timestamp: now,
  offset: 0,
  ...over,
});

export { e, now, day, config, turn };
