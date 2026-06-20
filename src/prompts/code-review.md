{RULES}

Adversarially CODE-review {key} on branch "{branch}" inside the worktree at "{worktreePath}". Run all git and test commands from there (cd "{worktreePath}" or git -C "{worktreePath}"). Inspect "git -C {worktreePath} diff {base}...{branch}" and the changed files; cross-check against the spec at "{specPath}". Check correctness, bugs, missing or weak tests, error handling, and convention adherence. Verify the test command ({testCmd}) passes.

TEST DISCRIMINATION CHECK (mandatory): a passing test proves nothing if it also passes WITHOUT the change. For each new/changed test, mentally (or by temporarily reverting the implementation hunk) confirm the test would FAIL against the un-patched code. If a test asserts on a mock/fixture that produces the same value with and without the fix (e.g. a rate-limit test whose mocked req.ip never varies, so default-keying and the new key generator bucket identically), it is non-discriminating — flag it as BLOCKING with a concrete fix that makes the fixture vary along the axis the change affects.

Report ONLY genuinely blocking issues, each with file + a concrete fix. State clearly if clean.
