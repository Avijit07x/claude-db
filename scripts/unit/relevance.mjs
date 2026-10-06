import { check } from '../lib/check.mjs';

export default async function run() {
  {
    const { isSearchable } = await import('../../dist/util/prompt.js');
    const foreign = ['修复登录接口的超时问题', 'ログイン画面のバグ', 'почему падает сборка'];
    check(
      'non-latin prompts reach search',
      foreign.every(isSearchable),
      foreign.filter((p) => !isSearchable(p)).join(' '),
    );
    check('english prompts still reach search', isSearchable('fix the login timeout bug'));
    check(
      'filler is still rejected',
      !isSearchable('ok') && !isSearchable('thanks') && !isSearchable('go ahead'),
    );
  }

  {
    const { overlapCount } = await import('../../dist/hooks/relevance.js');
    const related = overlapCount('why does the flush cursor skip transcript turns', {
      title: 'Fixed the flush cursor drift',
      snippet: 'the cursor was written before the transcript insert',
    });
    check('a related prompt/entry pair clears the gate', related >= 2, String(related));

    const unrelated = overlapCount('how do we publish a release', {
      title: '| SQLite | 2-5 ms |',
    });
    check('table-row junk scores zero', unrelated === 0, String(unrelated));

    check(
      'stopwords never count as overlap',
      overlapCount('what is the thing for it', { title: 'the thing is what it is for' }) ===
        overlapCount('thing', { title: 'thing' }),
    );
  }

  {
    const { clearsOverlap } = await import('../../dist/hooks/relevance.js');
    const prompt = 'why did we drop polling for the websocket order feed';
    check(
      'two shared content words clear a floor of two',
      clearsOverlap(prompt, { title: 'Dropped polling for the order feed' }, 2),
    );
    check(
      'one shared word does not',
      !clearsOverlap(prompt, { title: 'Rounded order totals to cents' }, 2),
    );
    check(
      'the snippet counts toward the overlap',
      clearsOverlap(prompt, { title: 'Order totals', snippet: '…the websocket feed…' }, 2),
    );
    check(
      'a prompt with one content word needs only that word',
      clearsOverlap('websocket?', { title: 'Websocket reconnect backoff' }, 2),
    );
    check('a floor of zero lets everything through', clearsOverlap(prompt, { title: 'x' }, 0));
  }

  {
    const { typedPrompt } = await import('../../dist/util/prompt.js');
    const handback =
      'Another Claude session sent a message:\n<agent-message from="a1">\n[Subagent hand-back] ' +
      'the websocket polling report</agent-message>';
    check('a subagent hand-back is not something the user typed', typedPrompt(handback) === null);
    check(
      'nor is a task notification',
      typedPrompt('<task-notification>\n<task-id>b1</task-id>\n</task-notification>') === null,
    );
    check(
      'nor is a slash command wrapper',
      typedPrompt(
        '<command-name>/compact</command-name>\n<command-message>compact</command-message>',
      ) === null,
    );
    check(
      'nor is local command output',
      typedPrompt('<local-command-stdout>Set model to sonnet</local-command-stdout>') === null,
    );
    check(
      'an image path is stripped, keeping what was typed',
      typedPrompt('[Image: source: /tmp/claude-1000/x/images/3.png] the gap is too wide') ===
        'the gap is too wide',
    );
    check(
      'an image size note is stripped too',
      typedPrompt(
        'fix this [Image: original 3072x1404, displayed at 1536x702. Multiply coordinates by 2.00 to map to original image.]',
      ) === 'fix this',
    );
    check(
      'an image with no text leaves nothing',
      typedPrompt('[Image: source: /tmp/a.png]') === '',
    );
    check(
      'code that merely names Image is untouched',
      typedPrompt('why does [Image.open(f) for f in files] leak') ===
        'why does [Image.open(f) for f in files] leak',
    );
    check(
      'an IDE note is stripped, keeping what was typed',
      typedPrompt(
        '<ide_opened_file>The user opened the file /p/src/a.ts in the IDE. This may or may not be related to the current task.</ide_opened_file>\nwhy is the header wrapping',
      ) === 'why is the header wrapping',
    );
    check(
      'any IDE block is stripped by its own closing tag',
      typedPrompt('fix <ide_selection>line 1\nline 2</ide_selection> this') === 'fix this',
    );
    check(
      'a typed prompt that mentions a tag later is kept',
      typedPrompt('why is <task-notification> parsed twice') ===
        'why is <task-notification> parsed twice',
    );
  }
}
