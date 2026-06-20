---
description: Interactively build one ticket (or epic's children) end-to-end — design, TDD implement, adversarial review — then let you decide the merge.
---

# /autobuild-one

Drive one ticket through the autobuild engine, interactively. You do the judgment (resolve, checkpoint, decide merge); the engine does the deterministic design → implement → review → fix fan-out.

## Steps

1. **Load and validate config.** Read `.claude/autobuild.config.json` in the repo root and `.claude/autobuild.md` (conventions prose). Validate the config via the shipped validator. The validator is dependency-free (no `ajv`, no `npm install` needed). Resolve the plugin directory first — it is the directory containing *this command file*, two levels up (`commands/` → plugin root). Plugins are installed under a versioned path (e.g. `.../autobuild/0.1.0/`), so do not hardcode a version; derive it. Run:
   ```
   PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"   # plugin root, version-agnostic
   node -e "const{validateConfig}=require(process.env.PLUGIN+'/lib/validateConfig');console.log(JSON.stringify(validateConfig(require(process.cwd()+'/.claude/autobuild.config.json'))))"
   ```
   If you cannot derive `$0` (you are not running this as a script), find the validator with `find ~/.claude/plugins -path '*autobuild*/lib/validateConfig.js' | head -1` and `require()` that absolute path. The validator needs no consumer dependencies, so it runs from any repo. If `valid` is `false`, stop and print the `errors` array to the user. If the config file is missing, stop and tell the user.
2. **Resolve the ticket.** From the argument (a ticket key or epic key), run the config's `ticket.show` command to read it. If it's an epic, expand to children and confirm order with the user.
3. **Run the engine.** Invoke `Workflow({ name: 'autobuild:autobuild', args })` (the workflow is namespaced by its plugin; the bare name `autobuild` will not resolve) with `args = { config, profile: <autobuild.md text>, ticket: { key, branch: '<key-lowercase>-<slug>', ticketText: <the ticket body> }, autonomous: false }`.
4. **Handle escalations.** If the result `verdict` is `blocked` with `escalations`, surface ONLY those to the user via the question tool (lead with the recommended option), fold answers into guidance, and re-run.
5. **Report + merge decision.** On `verdict: clean`, summarize the branch, spec path, and review outcome. Ask the user whether to merge to `config.base` and whether to push. Default: merge locally, do NOT push (engine and this command never push on their own). On `verdict: blocked`, report the findings and leave the branch for manual attention.

## Rules

- Never `git push` unless the user explicitly says to AND `config.pushAllowed` is true.
- The engine never merges — merging is your action, taken only after the user decides.
