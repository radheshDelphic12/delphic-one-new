# AI client suggestions (Accounts > AI suggestions)

Companies that could become clients, the service each could take, the roles to approach and how. Delphic Global only. Module `server/src/modules/aiClientSuggestions/`, page `client/src/pages/accounts/AiClientSuggestionsPage.jsx`, migration `20261217100000_ai_client_suggestions`, test `server/tests/ai-client-suggestions.test.js`.

## How it works
- No search engine and no training. Claude (Anthropic Messages API, model `AI_INTERVIEW_MODEL`, default `claude-sonnet-5-5`) reads our accounts and requirements and answers from its general knowledge. It never writes phone numbers, emails or web addresses (it would invent them); any it returns are dropped.
- Same key as the AI interview (`ANTHROPIC_API_KEY`, a user-level `sk-ant-usr` key, workspace `ANTHROPIC_WORKSPACE_ID`). Credits run out for both at once.

## Failure history (2026-11-17), in the order it happened
1. Browser showed a bare "Could not suggest": nginx (client container) waited 60 s on `/api/` and cut a 10-company request off with a 504. Fixes: `proxy_read_timeout 300s` in `client/nginx.conf`, and the request is split into parallel batches.
2. Then the API answered 503 "AI not available" after 51 s: each company needs ~500-600 output tokens, the cap (3000 for 5-7 companies) cut the JSON off (`stop_reason: max_tokens`), the retry was cut off too. Fix: `BATCH = 3` (+1 spare) companies per call, `maxTokens = size * 800 + 400`, call timeout 120 s (`timeoutMs` passed through `aiClient.askJson`), and the failure is logged at error level with its reason.
3. Then "Your credit balance is too low" (HTTP 400 from Anthropic): not a code problem. Add credits / auto-reload in the Anthropic Console (organization "Delphic Global", workspace "Default", key ends `_QAA`; owner email only visible in the Console, Settings > Members / API keys).
Measured on the prod container: 4 parallel calls of 3-4 companies finish in 18-26 s with `end_turn`; asking 10 takes ~25 s, 15 about the same.

## Gotchas
- A failed call to Anthropic that is cut off is NOT retried usefully: always size `maxTokens` to the batch.
- `AiUnavailableError` becomes 503 `ai_unavailable`; the API log line `http_request ... 503` with ~51 s duration means two cut-off attempts.
- Checking prod: `ssh ubuntu@13.234.208.203`, `docker logs delphic-server-1`, nginx errors in `docker logs delphic-client-1`.
