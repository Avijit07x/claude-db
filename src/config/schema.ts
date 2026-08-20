import { z } from 'zod';

export const ConfigSchema = z.object({
  database: z.string().default(''),

  embeddings: z
    .object({
      provider: z.enum(['auto', 'local', 'builtin', 'none']).default('auto'),
      maxScanCandidates: z.number().int().positive().default(25000),
      timeoutMs: z.number().int().nonnegative().default(3000),
      batchSize: z.number().int().positive().default(8),
    })
    .prefault({}),

  updates: z.enum(['auto', 'notify', 'off']).default('notify'),

  capture: z
    .object({
      tools: z.array(z.string()).default(['Edit', 'Write', 'Bash', 'NotebookEdit']),
      exclude: z.array(z.string()).default(['.env', 'secrets', 'node_modules', '.git/']),
      maxBodyChars: z.number().int().positive().default(4000),
    })
    .prefault({}),

  inject: z
    .object({
      sessions: z.number().int().nonnegative().default(5),
      maxChars: z.number().int().positive().default(6000),

      perPrompt: z.boolean().default(true),
      promptResults: z.number().int().positive().max(10).default(4),
      promptMaxChars: z.number().int().positive().default(700),
      expandTop: z.number().int().min(0).max(3).default(0),
      expandMaxChars: z.number().int().positive().default(900),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
