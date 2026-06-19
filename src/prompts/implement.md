{RULES}

Implement ONE chunk of {key} on branch "{branch}" inside the assigned worktree. Do NOT switch branches. First READ the approved design spec at "{specPath}" — it is authoritative.

CHUNK {chunkId} — {chunkTitle}
Target files: {chunkFiles}
Instructions:
{chunkInstructions}

TDD is MANDATORY and ENFORCED — follow this exact red→green protocol. A test that passes before the implementation exists proves nothing; the engine will REJECT this chunk if you skip the red phase or the red run does not actually fail.

1. RED. Write the failing test FIRST. Then run the test command ({testCmd}) with ONLY the test present (no implementation yet). Observe it FAIL. The test must fail for the RIGHT reason — an assertion about the behavior you are adding, not a compile error or a missing import. If it passes, your test does not discriminate the change: fix the test (often the mock/fixture is too permissive and the buggy and fixed code produce the same result) until it genuinely fails without the implementation. Record the exact command, the non-zero exit code, and the failing assertion message.

2. GREEN. Now write the implementation. Run the test command again and observe it PASS. Run the lint command ({lintCmd}); fix only what you touched until both pass. Record the exit codes (both 0).

3. COMMIT. git add ONLY this chunk's files (never "git add -A") and commit with a conventional message referencing {key} and "{chunkId}".

Return a structured report with: the test file path; the red-phase command, its exit code (MUST be non-zero), and the failing assertion text you saw; the green-phase command and its exit code (0); and the lint exit code. Be truthful about the red phase — fabricated red evidence is worse than an honest escalation.
