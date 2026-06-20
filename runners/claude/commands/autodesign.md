---
description: Design one bead end-to-end and cache the design back to the bead — interactively (superpowers brainstorm) or autonomously (bounded Opus). Marks the bead `designed` so the overnight supervisor reuses it without re-designing.
---

# /autodesign

Turn one bead into a cached, build-ready design. The design (spec path + chunks + surface) is written back to the bead as a fenced `autodesign` JSON block and the bead is labeled `designed`, so a later `/autobuild` wave reuses it instead of re-designing.

Argument: a bead key. Optional flag `--auto` for the autonomous path.

## Steps

1. **Load and validate config.** Resolve the plugin dir (the directory containing this command file, one level up). Read `.claude/autobuild.config.json` + `.claude/autobuild.md`. Validate via the shipped validator:
   ```
   PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
   node -e "const{validateConfig}=require(process.env.PLUGIN+'/lib/validateConfig');console.log(JSON.stringify(validateConfig(require(process.cwd()+'/.claude/autobuild.config.json'))))"
   ```
   If `valid` is false, print `errors` and stop. If the config is missing, stop and tell the user.
2. **Read the bead.** Run the resolved `config.ticket.show` command for the key. Capture the bead title + description as the ticket text.
3. **Branch on mode:**
   - **Interactive (default, no `--auto`):** Use the superpowers brainstorming skill with the human to produce the design (spec prose, chunk decomposition with per-chunk model tier + target files + TDD instructions, and the directory surface). Commit the prose spec to `docs/superpowers/specs/YYYY-MM-DD-<key>-<slug>.md`. Assemble a `design` object `{ specPath, surface, chunks }`.
   - **Autonomous (`--auto`):** Invoke `Workflow({ name: 'autobuild:autodesign', args: { config, profile: <autobuild.md text>, ticket: { key, branch: '<key-lowercase>-<slug>', ticketText: <bead text> } } })`. If the result has `error`, stop and report. If `escalations` is non-empty, do NOT cache — instead apply the `parked` label and append the escalations to bead notes, then stop and report (a human must resolve the fork; see `/autobuild` for the same parking rule). Otherwise take `{ specPath, surface, chunks }` from the result.
4. **Write the design back to the bead.** Serialize the design to the `autodesign` notes block and append it, then apply the `designed` label. Use the plugin's `designNotes` lib for the exact format:
   ```
   BLOCK="$(node -e "const{serializeDesign}=require(process.env.PLUGIN+'/lib/designNotes');process.stdout.write(serializeDesign(JSON.parse(process.env.DESIGN)))")"
   ```
   with `DESIGN` set to the JSON of `{specPath, surface, chunks}`. Then run the resolved `config.ticket.note` template with the block as `{text}`, and the resolved `config.ticket.label` template with `{label}` = `config.labels.designed`. Finally run `config.ticket.syncPush` (`bd dolt push`) so the cached design is durable.
5. **Report.** Print the spec path, the chunk count + their model tiers, and the surface directories.

## Rules

- Never `git push` to a remote (the spec file is committed locally on the current branch only).
- An escalated design is NEVER cached or labeled `designed` — it is parked `needs-human`.
- The interactive and autonomous paths converge on the SAME bead-notes format (`serializeDesign`), so the supervisor reads either identically.
