# Agent Workflow

- Work only inside this repository.
- Use small, testable changes.
- Add or update tests for every feature.
- Do not invent scientific evidence. The app must start empty and only recommend from imported or manually entered evidence.
- Every recommendation must expose provenance and confidence.
- Prefer explicit code over clever abstractions.
- If `git` is unavailable in the local shell, report the blocker instead of simulating commits.
- External database search results are candidate context, not curated proof. Keep imported search hits low-confidence until a scientist reviews and edits the record.
