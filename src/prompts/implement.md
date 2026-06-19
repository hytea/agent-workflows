{RULES}

Implement ONE chunk of {key} on branch "{branch}" inside the assigned worktree. Do NOT switch branches. First READ the approved design spec at "{specPath}" — it is authoritative.

CHUNK {chunkId} — {chunkTitle}
Target files: {chunkFiles}
Instructions:
{chunkInstructions}

TDD: write a FAILING test first, then implement to green. Run the test command ({testCmd}) and lint command ({lintCmd}); fix what you touched until both pass. git add ONLY this chunk's files (never "git add -A") and commit with a conventional message referencing {key} and "{chunkId}". Report the changes and the test result.
