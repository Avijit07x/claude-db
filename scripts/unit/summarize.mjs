import { check } from '../lib/check.mjs';

export default async function run() {
  {
    const { buildSummaryPrompt, validateSummary } = await import('../../dist/capture/index.js');
    const { ConfigSchema } = await import('../../dist/config/index.js');

    const prompt = buildSummaryPrompt('x'.repeat(20000));
    check('prompt caps session text near 8000 chars', prompt.length < 8300, String(prompt.length));
    check(
      'prompt keeps short input intact',
      buildSummaryPrompt('fixed the bug').includes('fixed the bug'),
    );

    check(
      'the prompt never calls the records "this session"',
      !/this (coding )?session/i.test(buildSummaryPrompt('x')),
      buildSummaryPrompt('x').slice(0, 60),
    );

    check('empty output is rejected', validateSummary('   \n') === null);
    check('too-long output is rejected', validateSummary('a'.repeat(800)) === null);
    check('fenced output is rejected', validateSummary('```\ncode\n```') === null);
    check(
      'a model talking about itself is rejected',
      validateSummary("I don't have any record of this work happening in this session.") === null,
    );
    check(
      'a summary longer than the old 500 cap now passes',
      validateSummary('Fixed the cursor. '.repeat(35).trim())?.length > 500,
    );
    check(
      'a clean summary passes trimmed',
      validateSummary('  Fixed the flush cursor bug.  ') === 'Fixed the flush cursor bug.',
    );

    check('summarize defaults to off', ConfigSchema.parse({}).capture.summarize === 'off');
    check(
      'the summary model defaults to opus',
      ConfigSchema.parse({}).capture.summarizeModel === 'opus',
    );
  }
}
