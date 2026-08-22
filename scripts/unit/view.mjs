import { renderPage } from '../../dist/cli/commands/view-page.js';
import { check } from '../lib/check.mjs';

export default async function run() {
  const html = renderPage(
    {
      project: '/p',
      database: 'memory.db',
      scannedFiles: 3,
      kinds: { decision: 2 },
      rules: [{ id: 'aa11', when: 1, title: '</script><script>alert(1)</script>' }],
      sessions: [{ when: 1, summary: 'did things' }],
      observations: [{ id: 'bb22', kind: 'bugfix', when: 1, title: 'fixed <b>it</b>', files: 1 }],
    },
    true,
  );
  check('view page renders', html.includes('claude-db') && html.includes('Memory stream'));
  check(
    'hostile titles cannot break out of the data block',
    !html.includes('</script><script>alert'),
  );
  check('data rides as escaped JSON', html.includes('\\u003c/script>'));
}
