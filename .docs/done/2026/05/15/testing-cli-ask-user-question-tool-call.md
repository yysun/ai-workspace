# Done: testing-cli-ask-user-question-tool-call

## Summary

- Added structured human-input handling to the interactive streaming test CLI.
- Recognized `ask_user_input`, `human_intervention_request`, and the local compatibility alias `ask_user_question`.
- Rendered runtime questions and choices in the terminal, with number or id selection.
- Supported multiple-select comma-separated answers and empty answers for skippable prompts.
- Sent selected answers back as a self-contained follow-up user message with question text, question ids, option ids, and labels.
- Forwarded runtime tool-call ids through streamed tool events and tool execution context so pending requests can carry stable ids.
- Documented the new CLI behavior and added focused unit coverage.

## Verification

- Ran `npm run test:unit`.
- Ran `npm run build`.
- Ran `npm test`.
- Ran `git diff --check`.

## Notes

- The CLI resumes human-input prompts with a structured user follow-up rather than a formal tool-role response because the server owns internal tool execution and the HTTP client keeps only user and assistant history.
- Dedicated E2E coverage was not added because this is terminal utility behavior covered by unit tests plus the existing server streaming suite.
- No git commit was created because commits require an explicit user request in this environment.
