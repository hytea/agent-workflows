{RULES}

DESIGN-CONFORMANCE review {key} on branch "{branch}" inside the worktree at "{worktreePath}" (run git from there: git -C "{worktreePath}"). Read the approved spec at "{specPath}" and the ticket's acceptance criteria. Inspect "git -C {worktreePath} diff {base}...{branch}". Judge whether the implementation built the RIGHT thing: does it satisfy the spec and acceptance criteria, are any chunks missing or partially done, did it add unrequested scope? Report ONLY genuinely blocking conformance gaps, each with file + a concrete fix. State clearly if it conforms.
