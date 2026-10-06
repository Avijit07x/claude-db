# With claude-db and without it

Does it actually save tokens? Here is the same work measured both ways, so you
can decide before you install.

Run `npm run bench:ab` from a clone to reproduce all of it on your own
codebase. Recall is priced by replaying real chats through the prompt hook, so
pass `--recall-from <project>` to pick a project that has memory. Tokens are
approximated at 4 characters each.

## The short answer

**One lookup pays for over thirty prompts of recall.**

Recall costs ~20 tokens a prompt on average, and nothing at all on about two
thirds of them. A symbol lookup saves ~700 tokens against doing the same work by hand. Ask
your codebase something once every thirty prompts and you are ahead. Never ask
it anything and you are paying for context you did not use.

## Looking up a symbol

The question is _who uses this, and how?_ Without claude-db that means a grep,
then opening the file it points into to see which hits are definitions, which
are calls, and which are noise. With it, one command returns the same answer
already classified.

Measured on eight real symbols in this repository:

```
  symbol                    WITH    grep   +read  WITHOUT
  ---------------------------------------------------------
  isSearchable              1935    1273    2455     3728
  observationsFromTurns     3428    3664    7489    11153
  closeObservations         4340    2487    6943     9430
  flushSession              2431     924    4830     5754
  refreshGraph              2796    1096     961     2057
  observationId             2519    4014     572     4586
  toSnippet                 2006    1789     704     2493
  openWork                  1444    1492    2135     3627
  ---------------------------------------------------------
  TOTAL chars              20899                    42828
  TOTAL tokens              5225                    10707
                                                     2.0x
```

**653 tokens per lookup instead of 1,338.**

The average hides something useful. `refreshGraph` is cheaper _without_
claude-db, because its defining file is small and grep answers it fine.
`observationsFromTurns` is more than three times cheaper with it, because
answering it by hand means reading a 250-line file, and `closeObservations`
about twice as cheap, because its definitions are spread across three store
adapters.

The win concentrates on questions that span files, which is also where a wrong
answer costs you the most.

## Asking why something is the way it is

Some questions have no grep equivalent at all. _Why does capture read the
transcript instead of hooking the tools?_ leaves no trace in the code. The
closest substitute is `git log -S` plus reading diffs, and that tells you what
changed, never why.

Measured against that substitute the two come out roughly level, but they are
not answering the same question. The real cost without stored memory is
explaining it to Claude again yourself, which no benchmark can price.

## What it costs

Recall arrives automatically whenever Haiku finds an earlier memory that fits
the prompt, so it has a standing cost. What arrives is one line per memory,
never a full body: the day, the question that memory answered, one sentence
copied from it, and the id to expand. Claude pulls a full body only when a line
earns it.

```
  every prompt costs       20 tokens of recall
  every lookup refunds    685 tokens   (1,338 by hand, 653 with)

  so one lookup pays for 33.9 prompts of recall
```

On 69% of prompts nothing is injected at all: nothing from an earlier chat
fits well enough, or what fits is already in the conversation. Recall was
priced by replaying 300 real prompts, in order, from a project with about 660
memories.

```
  a session of      recall costs  lookups to break even
  ------------------------------------------------------
  1 prompt                    20                    0.0
  5 prompts                  101                    0.1
  10 prompts                 202                    0.3
  20 prompts                 405                    0.6
  60 prompts               1,214                    1.8
```

## When it does not pay off

Worth saying plainly, because it is a real case: a session where you never ask
anything about the codebase pays for recall and gets nothing back for it.

Three things push you the other way. Refactoring, where every rename wants a
blast-radius check. Returning to a project after a break, where the stored
reasoning is the point. And any codebase large enough that "who calls this"
means opening several files rather than one.

If your sessions are short and mostly conversational, turn the per-prompt
recall off and keep the code graph:

```json
{ "inject": { "perPrompt": false } }
```

Session-start context still arrives, lookups still work, and the standing cost
goes to zero.

## Reproducing this

```bash
git clone https://github.com/Avijit07x/claude-db && cd claude-db
npm install && npm run build

npm run bench:ab        # this document, on your own repo
npm run bench:tokens    # where the injected tokens go
```

The grep side excludes markdown, so both sides see the same code rather than
counting prose that happens to mention a symbol name.
