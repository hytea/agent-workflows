# Carven — autobuild conventions

Prose profile loaded into agent RULES for the Carven repo. Structured policy is in `autobuild.config.json`.

## Hard rules

- **Never `git push`.** Push to `development` triggers the dev deploy; the supervisor merges to a local `development` only and the author pushes in the morning.
- **Worktree isolation.** Operate only inside the assigned worktree (absolute paths or `git -C`). Never `git add -A` — stage only the current chunk's files.
- **TDD is mandatory.** Failing test first, then implement to green.

## Conventions

- Match existing patterns. This is a monorepo: `apps/web` (Vite + React 18 + Tailwind + shadcn), `apps/api` (Express + TS + Prisma), `apps/extension`, `packages/types`.
- **Brand & Style Guide is required for all UI work** (see `brandGuidePath`): white canvas, ink primary, single emerald accent, sunset on italics only, no exclamation marks. No colored plan badges.
- **Never use `!important`** in CSS; clean up existing usage when touched.
- **Analytics required** on every UI feature: `trackEvent` with `ui.{feature}.{action}` naming.
- Use `bd` for all ticket state — never edit `.beads/` files directly.
- Prisma uses exact schema field names (snake_case where the schema is snake_case).

## UI review

When a diff touches `apps/web`, the UI reviewer renders the affected page(s) via Playwright on the allocated port and checks layout, centering, clipping/overflow, and brand-guide adherence — not just the code.
