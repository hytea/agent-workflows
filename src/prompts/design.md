{RULES}

Design ticket {key}. Read the ticket details provided and the repo. Produce an APPROVED, scoped design — do NOT implement.

Write a dated design spec to docs/superpowers/specs/ (create the dir if needed). Do NOT git commit it — leave it as an uncommitted working-tree file. The setup phase creates the worktree and commits the spec there, on the ticket branch; committing here would land the spec on the base branch (a leak). Just write the file and return its path.

Return (via the structured schema):
- spec: the full design text.
- specPath: the spec file path you wrote (uncommitted; setup commits it in the worktree).
- surface: the set of DIRECTORIES the work will touch (union of all chunk target files reduced to their directories). Used for conflict-aware scheduling.
- chunks: ordered, dependency-respecting, each tagged model "haiku" (cut-and-dry) / "sonnet" (normal) / "opus" (subtle or security-critical), each with target files and self-contained TDD instructions. A chunk is gated by a mandatory failing-test-first (red) phase. If a chunk genuinely cannot have a discriminating test — pure docs/LICENSE/config with no observable behavior — set testExempt:true and give a one-line testExemptReason. Use this sparingly; most chunks must be testable. A chunk whose change has ANY observable behavior is NOT exempt.
- escalations: ONLY genuine architectural/execution forks where the right call is unclear. Default to deciding yourself and documenting in the spec — escalations should usually be empty.

Stay scoped. Do not sprawl into hours of exploration.
