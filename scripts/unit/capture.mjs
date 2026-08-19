import { observationsFromTurns } from '../../dist/capture/index.js';
import { ConfigSchema } from '../../dist/config/index.js';
import { check } from '../lib/check.mjs';
import { now, config, turn } from '../lib/fixtures.mjs';

export default async function run() {
  const [built] = observationsFromTurns([turn()], 's1', '/p', config);
  check('observation is built from a turn', built !== undefined);
  check('api keys are redacted', !built.body.includes('sk-abcdefghijklmnopqrst'));
  check('private blocks are stripped', !built.body.includes('my ssn'));
  check('intent is recorded', built.body.includes('Asked: store the api key'));
  check('file is captured', built.files[0] === '/p/src/auth.ts');
  check(
    'title includes parent dir to disambiguate repeated names',
    built.title.length > 0,
    built.title,
  );

  const leaky = observationsFromTurns(
    [turn({ reasoning: 'Set OPENAI_KEY to "sk-abcdefghijklmnopqrst" in the client config' })],
    's1',
    '/p',
    config,
  );
  check(
    'secrets are redacted from titles, not just bodies',
    !leaky[0].title.includes('sk-abcdefghijklmnopqrst'),
    leaky[0].title,
  );

  const secrets = observationsFromTurns(
    [
      turn({
        reasoning: [
          'Rotated everything.',
          '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
          'aws AKIAIOSFODNN7EXAMPLE and slack xoxb-1234567890-abcdefghij',
          'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        ].join('\n'),
      }),
    ],
    's1',
    '/p',
    config,
  );
  check('private key blocks are redacted', !secrets[0].body.includes('MIIEowIBAAKCAQEA'));
  check('aws keys are redacted', !secrets[0].body.includes('AKIAIOSFODNN7EXAMPLE'));
  check('slack tokens are redacted', !secrets[0].body.includes('xoxb-1234567890'));
  check('jwts are redacted', !secrets[0].body.includes('eyJhbGciOiJIUzI1NiJ9'));

  const dsn = observationsFromTurns(
    [
      turn({
        prompt: 'cdb use "mongodb+srv://avnadmin:hunter2secret@ecommerce.mongodb.net/db"',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'credentials in a connection string are redacted',
    !dsn[0].body.includes('hunter2secret'),
    dsn[0].body.split('\n')[0],
  );
  check(
    'the host survives redaction so the memory stays useful',
    dsn[0].body.includes('ecommerce.mongodb.net'),
  );

  const tagged = observationsFromTurns(
    [
      turn({
        files: [
          '/p/sellergeni-backend/src/api.ts',
          '/p/sellergeni-frontend/app.tsx',
          '/p/README.md',
        ],
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'the repo a file lives in becomes a tag',
    tagged[0].tags.includes('sellergeni-backend') && tagged[0].tags.includes('sellergeni-frontend'),
    tagged[0].tags.join(','),
  );
  check('root-level files do not become tags', !tagged[0].tags.includes('README.md'));
}
