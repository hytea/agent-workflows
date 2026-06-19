{RULES}

Adversarially SECURITY-review {key} on branch "{branch}". Inspect "git diff {base}...{branch}". Scrutinize authorization/authz enforcement (default-deny, no bypass), credential/secret/token handling (no logging or leak), SSRF/injection in outbound calls, over-broad scopes or permissions, and any unintended data exposure. Report ONLY genuinely blocking security issues, each with file + a concrete fix. State clearly if clean.
