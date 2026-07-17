# Code review context

Project-specific review focus areas for this repo. Reviewers load this file
before reviewing a diff.

## Jargon sweep (every review)

Sweep every piece of human-readable text in the diff — comments, test
descriptions, error messages, log output, doc comments — for jargon and
overlong comments. Implementer models (Sonnet and Opus are the worst
offenders) write contracted, highly technical, incomprehensible jargon all
over the place, and especially write extremely long comments.

Flag and rewrite:

- Invented or coined terms where a plain description of what happens works.
- Contracted, telegraphic phrasing that has to be reread to be understood.
- Long comments. A comment should state only what the code cannot express;
  most should be deleted or replaced with clearer code.
- Test descriptions written in implementation vocabulary instead of plain
  English describing the observable behavior.

The standard: a reader outside this session understands the text on the
first read.
