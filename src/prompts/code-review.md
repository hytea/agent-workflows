{RULES}

Adversarially CODE-review {key} on branch "{branch}". Inspect "git diff {base}...{branch}" and the changed files; cross-check against the spec at "{specPath}". Check correctness, bugs, missing or weak tests, error handling, and convention adherence. Verify the test command ({testCmd}) passes. Report ONLY genuinely blocking issues, each with file + a concrete fix. State clearly if clean.
