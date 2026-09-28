# Repository Instructions

## Documentation Contract

`README.md` is part of the product and must be updated in the same change as any feature work. A code change is not complete while the README still describes the old behavior.

Before finishing any task that changes the project, check whether it affects:

- Commands or command-line arguments.
- Environment variables or defaults.
- Local secret files, direct `apiKey` fields, or key-resolution order.
- `agents.json` fields or validation.
- `providers.json` fields or supported provider types.
- Model routing or authentication behavior.
- Task configuration, task types, evaluation, or scoring.
- Log file names, event types, fields, or retention.
- HTML viewer output or charts.
- Error handling, troubleshooting behavior, or known limitations.
- Security, privacy, or data-sharing behavior.
- File names, directory structure, dependencies, or Node.js requirements.

If any item changed, update the relevant README sections and the feature-status table.

## Required Verification

For feature changes:

1. Update the implementation.
2. Update `README.md` in the same change.
3. Run `node --check` for changed `.mjs` files.
4. Validate changed JSON files with `JSON.parse`.
5. Test external API integrations with a local mock server when possible.
6. Verify that every command shown in the README still exists and works.

## README Quality Rules

The README must remain usable by a first-time user:

- Start with the shortest successful setup path.
- Explain where to run commands.
- Show required environment variables and safe placeholder values.
- Keep JSON examples valid.
- Document defaults and optional fields.
- Explain generated files and their locations.
- Document sensitive data and security boundaries.
- Mark unfinished capabilities clearly instead of implying they work.

Do not remove troubleshooting or migration guidance without replacing it with equivalent user-facing information.