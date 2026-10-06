import { observationsFromTurns, redact } from '../../dist/capture/index.js';
import { ConfigSchema } from '../../dist/config/index.js';
import { check } from '../lib/check.mjs';
import { config, turn } from '../lib/fixtures.mjs';

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

  const pasted = observationsFromTurns(
    [
      turn({
        prompt: 'PLAYWRIGHT_MCP_EXTENSION_TOKEN=fakeTok9_exampleNotRealValue-0123456789abcdefghij',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'an unquoted token pasted into a prompt is redacted',
    !JSON.stringify(pasted).includes('fakeTok9_example'),
  );
  for (const secret of [
    'export GITHUB_TOKEN=abc123def456ghi789',
    'DATABASE_PASSWORD=hunter2hunter2',
    'token = abcdefghijklmnop',
    'client_secret: s3cr3tValue99',
  ]) {
    check(
      `an unquoted secret is redacted: ${secret.split(/[=:]/)[0].trim()}`,
      redact(secret).endsWith('[redacted]'),
    );
  }
  for (const plain of [
    'MAX_TOKENS=4096',
    'max_tokens: 100000',
    'the token is saved',
    'tokens = [a, b]',
  ]) {
    check(`a look-alike is left alone: ${plain}`, redact(plain) === plain);
  }

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

  {
    const { embedObservations } = await import('../../dist/capture/index.js');
    const sizes = [];
    const ctx = {
      config: ConfigSchema.parse({ embeddings: { batchSize: 16 } }),
      embedder: async () => ({
        id: 'fake',
        dimensions: 2,
        minRelevance: 0,
        embed: async (texts) => (sizes.push(texts.length), texts.map(() => [1, 0])),
      }),
    };
    const many = Array.from({ length: 500 }, (_, i) => ({ title: `t${i}`, body: 'b' }));

    await embedObservations(ctx, many);
    check(
      'embedding never hands the model more than one batch at a time',
      Math.max(...sizes) === 16,
      `max ${Math.max(...sizes)}`,
    );
    check(
      'every observation still gets embedded',
      many.every((obs) => obs.embedder === 'fake'),
    );
  }
}
