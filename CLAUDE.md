# CLAUDE.md

Full agent context lives in [docs/AGENTS.md](docs/AGENTS.md) - read it first.

## Standing rules (short form)

- **Do not run the full test suite after an implementation.** Run only affected tests: `npm run lint:changed` and `npm run test:changed` (repo root); `npm run test:branch` before handoff; single file via `cd server && npx jest --runInBand tests/<name>.test.js`. Full suite only for shared infra changes (schema/migrations, `config/db.js`, `middleware/`, `tests/helpers.js`, `app.js`) or on request - CI runs it sharded 4-way. Details: "Testing + CI speed rule" in docs/AGENTS.md.
- Never push to `main`; local-only fixes unless asked (see docs/AGENTS.md "Working conventions").
