import { z } from 'zod';

export const ConfigSchema = z.object({
  /**
   * Any supported connection string. Scheme selects the adapter.
   * Defaults to a local SQLite file so the tool works before configuration.
   */
  database: z.string().default(''),

  embeddings: z
    .object({
      provider: z.enum(['auto', 'local', 'builtin', 'none']).default('auto'),
      /**
       * Ceiling on how many vectors a brute-force backend will score in one
       * query. Scanning is linear, so this converts an unbounded tail latency
       * into a fixed one: the newest N observations in scope are scored and
       * older ones are reachable through keyword search. Backends with a real
       * vector index (pgvector, Atlas) ignore this.
       */
      maxScanCandidates: z.number().int().positive().default(25000),
      /**
       * How long to wait for the embedding model before giving up for this
       * one invocation and falling back to keyword-only search. The model is
       * fetched and loaded lazily inside a hook that runs on the critical path
       * of a prompt, so an unbounded wait is a hung prompt. 0 disables the
       * limit, which is what `doctor` uses to warm the model deliberately.
       */
      timeoutMs: z.number().int().nonnegative().default(3000),
    })
    .default({ provider: 'auto', maxScanCandidates: 25000, timeoutMs: 3000 }),

  capture: z
    .object({
      /** Tools whose invocations are worth remembering. */
      tools: z
        .array(z.string())
        .default(['Edit', 'Write', 'Bash', 'NotebookEdit']),
      /** Glob-ish fragments; matching paths are never persisted. */
      exclude: z
        .array(z.string())
        .default(['.env', 'secrets', 'node_modules', '.git/']),
      maxBodyChars: z.number().int().positive().default(4000),
    })
    // `prefault` rather than `default`: zod 4 requires a `default` to satisfy
    // the full output type, so `{}` is rejected even though every field below
    // supplies its own default. `prefault` substitutes on the input side and
    // lets those field defaults fill the object in.
    .prefault({}),

  inject: z
    .object({
      /** Session summaries pulled in at SessionStart. */
      sessions: z.number().int().nonnegative().default(5),
      /** Hard ceiling on SessionStart context, in characters. */
      maxChars: z.number().int().positive().default(6000),

      /**
       * Search memory on every prompt and inject matching titles.
       * Set false to fall back to tool-only recall, where Claude decides.
       */
      perPrompt: z.boolean().default(true),
      /** How many titles a per-prompt injection may surface. */
      promptResults: z.number().int().positive().max(10).default(4),
      /** Character ceiling for the per-prompt block. Roughly 4 chars a token. */
      promptMaxChars: z.number().int().positive().default(500),
      /**
       * How many top matches to inject in full rather than as a title.
       *
       * Titles alone require the agent to decide to call get_observations,
       * which reintroduces exactly the "it might not bother" failure that
       * automatic injection exists to remove. Expanding the single best match
       * delivers the reasoning without a round trip.
       */
      expandTop: z.number().int().min(0).max(3).default(1),
      /** Character ceiling for each expanded body. */
      expandMaxChars: z.number().int().positive().default(900),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
