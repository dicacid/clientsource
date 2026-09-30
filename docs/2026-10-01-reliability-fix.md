# SPA Intelligence response reliability

The clone damaged the prospect JSON-extraction regex and introduced 3,500/4,000 token limits without checking completion finish reasons. Live logs confirm malformed research JSON and unsuccessful AI repair. The empty-output cause cannot be proved from those logs because finish reasons were not recorded.

Changes:
- One server-only OpenRouter response handler for prospect and research calls.
- 12,000 output-token budget with low reasoning effort by default. A length-limited or empty result retries with 24,000 tokens. At most three requests share a 240-second deadline. The selected workspace model is retained.
- Complete balanced JSON extraction, including narrated and fenced output. Local syntax repair preserves existing evidence. Truncated answers are rejected before parsing. No reasoning text is used as research evidence.
- Handles text-block arrays, provider error envelopes and explicit JSON-mode rejection. Aggregates usage across retries, where reported. Logs incomplete-output metadata without keys or response content.
- Concise discovery prompts use valid JSON examples and explicitly require organisations from the requested industry. Festival research requests buyers/operators rather than unrelated energy suppliers.
- Industry and opportunity scans clear prior displayed results on a fresh run.
- Progress shows elapsed time and activity without simulated percentages or timer-invented stages.

Validation before deployment:
- 13 automated regression tests passed using mocked provider responses.
- Production build passed.
- TypeScript check remains failing on inherited repository errors: 41 baseline diagnostic headers versus 35 after this patch, no new diagnostic messages.
- Real authenticated scans have not yet been tested. Deployment and live workflow verification must be recorded separately.

Automatic retries may incur additional model charges. No fallback model or service is substituted. The branch name remains spa-intelligence-demo because Render deploys that existing branch; this does not change the beta product name.
