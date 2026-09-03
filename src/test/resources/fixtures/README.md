# Fixtures

`CopilotTraceFixture` generates an anonymized OTLP/HTTP protobuf request with the documented
`invoke_agent`, `chat`, and `execute_tool` hierarchy. It deliberately contains no real source code,
credentials, repository URL, or user prompt.

This is a contract fixture, not evidence of the exact payload emitted by every VS Code/Copilot
version. After the local spike, export a real trace, anonymize it, and add it here as a separate
versioned fixture so regressions against the installed runtime can be tested.
