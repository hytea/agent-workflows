{RULES}

Design ticket {key}. Read the ticket details provided and the repo. Produce an APPROVED, scoped design — do NOT implement.

Write a dated design spec to docs/superpowers/specs/ (create the dir if needed) and git add + commit it on the current branch ("docs({key}): design spec").

Return (via the structured schema):
- spec: the full design text.
- specPath: the committed spec file path.
- surface: the set of DIRECTORIES the work will touch (union of all chunk target files reduced to their directories). Used for conflict-aware scheduling.
- chunks: ordered, dependency-respecting, each tagged model "haiku" (cut-and-dry) / "sonnet" (normal) / "opus" (subtle or security-critical), each with target files and self-contained TDD instructions.
- escalations: ONLY genuine architectural/execution forks where the right call is unclear. Default to deciding yourself and documenting in the spec — escalations should usually be empty.

Stay scoped. Do not sprawl into hours of exploration.
