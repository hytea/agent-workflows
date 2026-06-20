{RULES}

RENDERED UI review of {key} on branch "{branch}" inside the worktree at "{worktreePath}". This change touches the frontend app, so you must inspect the ACTUAL RENDERED page, not just the code. Run all git/build/server commands from inside the worktree (cd "{worktreePath}" or git -C "{worktreePath}").

1. IDENTIFY the affected page(s). Inspect "git -C {worktreePath} diff --name-only {base}...{branch}", read the approved spec at "{specPath}", and determine which route(s)/page(s) the change renders on. If you cannot determine a reachable route, say so in the summary and do not fabricate one.

2. START the dev server in the BACKGROUND on the allocated port {uiPort} (never a blocking foreground server): run the configured dev-server command with the port substituted — {devServerCmd} — from inside the worktree, backgrounded. Wait until it is listening (poll the port; give it a bounded number of seconds, do not hang). If the server fails to start or never listens, report that as a BLOCKING finding (the UI could not be verified) and skip to step 5.

3. RENDER via the Playwright MCP browser: navigate to http://localhost:{uiPort}<route> for each affected page, take a screenshot, and read the accessibility snapshot. If the page requires auth or state you cannot reach, navigate as far as you can and note in the summary exactly what you could and could not render — do NOT pass a page you never saw.

4. INSPECT the rendered result for real layout defects a picky reviewer would catch:
   - centering / alignment of the changed elements
   - clipping, overflow, text truncation, elements escaping their container
   - overlapping or colliding elements, broken spacing
   - the change actually appears and is legible at a normal viewport
   - brand-guide adherence per the repo conventions in RULES (and the brand guide path if given): correct colors via CSS variables, no stray exclamation marks, no colored plan badges, etc.
   Only flag what you can SEE in the render or snapshot. A code-level nit belongs to the code reviewer, not here.

5. TEAR DOWN: stop the background dev server you started (kill the process / free port {uiPort}). Leave no server running.

Return the review schema {approved, summary, blocking[]}. Put ONLY genuinely blocking visual/layout/brand defects in blocking[], each with the file to change and a concrete fix. If you could not render the page at all, that is itself a blocking finding (unverified UI). If the rendered page looks correct, approve and say what you verified (which route, what you checked).
