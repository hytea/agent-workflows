---
description: Interactively build one ticket (or epic's children) end-to-end — design, TDD implement, adversarial review — then let you decide the merge.
---

# /autobuild-one

Drive one ticket through the autobuild engine, interactively. You do the judgment (resolve, checkpoint, decide merge); the engine does the deterministic design → implement → review → fix fan-out.

## Steps

1. **Load config.** Read `.claude/autobuild.config.json` in the repo root and `.claude/autobuild.md` (conventions prose). If the config is missing or fails schema validation, stop and tell the user.
2. **Resolve the ticket.** From the argument (a ticket key or epic key), run the config's `ticket.show` command to read it. If it's an epic, expand to children and confirm order with the user.
3. **Run the engine.** Invoke `Workflow({ name: 'autobuild', args })` with `args = { config, profile: <autobuild.md text>, ticket: { key, branch: '<key-lowercase>-<slug>', ticketText: <the ticket body> }, autonomous: false }`.
4. **Handle escalations.** If the result `verdict` is `blocked` with `escalations`, surface ONLY those to the user via the question tool (lead with the recommended option), fold answers into guidance, and re-run.
5. **Report + merge decision.** On `verdict: clean`, summarize the branch, spec path, and review outcome. Ask the user whether to merge to `config.base` and whether to push. Default: merge locally, do NOT push (engine and this command never push on their own). On `verdict: blocked`, report the findings and leave the branch for manual attention.

## Rules

- Never `git push` unless the user explicitly says to AND `config.pushAllowed` is true.
- The engine never merges — merging is your action, taken only after the user decides.
