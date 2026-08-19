# With claude-db and without it

Does it actually save tokens? Here is the same work measured both ways, so you
can decide before you install.

Run `npm run bench:ab` from a clone to reproduce all of it on your own
codebase. Tokens are approximated at 4 characters each.

## The short answer

**One lookup pays for about three prompts of recall.**

Recall costs ~180 tokens on every prompt. A symbol lookup saves ~600 tokens
against doing the same work by hand. Ask your codebase something once every few
prompts and you are ahead. Never ask it anything and you are paying for context
you did not use.

## Looking up a symbol

The question is _who uses this, and how?_ Without claude-db that means a grep,
then opening the file it points into to see which hits are definitions, which
are calls, and which are noise. With it, one command returns the same answer
already classified.

Measured on eight real symbols in this repository:

```
  symbol                    WITH    grep   +read  WITHOUT
  ---------------------------------------------------------
  isSearchable              1734    1228    1153     2381
  observationsFromTurns     2042    2362    7529     9891
  closeObservations         3209    1354    6597     7951
  flushSession              1786     818    4442     5260
  refreshGraph              2640    1143     961     2104
  observationId             2020    2418     572     2990
  toSnippet                 1994    1789     704     2493
  openWork                  1166    1294    1305     2599
  ---------------------------------------------------------
  TOTAL chars              16591                    35669
  TOTAL tokens              4148                     8917
                                                     2.1x
```

**518 tokens per lookup instead of 1,115.**

The average hides something useful. `refreshGraph` and `observationId` are
cheaper _without_ claude-db, because their defining files are small and grep
answers them fine. `observationsFromTurns` and `closeObservations` are four to
five times cheaper with it, because answering those by hand means reading a
200-line file, or three of them spread across different modules.

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

Recall arrives automatically on every prompt, so it has a standing cost. What
arrives is index lines, never full bodies: an id, a kind, a date, a title, and
the line that matched. Claude pulls a full body only when a title earns it.

```
  every prompt costs      180 tokens of recall
  every lookup refunds    597 tokens   (1,115 by hand, 518 with)

  so one lookup pays for 3.3 prompts of recall
```

On 28% of prompts nothing is injected at all, because everything matching is
already in the conversation.

```
  a session of      recall costs  lookups to break even
  ------------------------------------------------------
  1 prompt                   180                    0.3
  5 prompts                  900                    1.5
  10 prompts               1,800                    3.0
  20 prompts               3,600                    6.0
  60 prompts              10,800                   18.1
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
