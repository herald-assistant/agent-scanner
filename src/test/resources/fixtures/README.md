# Fixtures

`CopilotTraceFixture` generates an anonymized OTLP/HTTP protobuf request with the documented
`invoke_agent`, `chat`, and `execute_tool` hierarchy. It deliberately contains no real source code,
credentials, repository URL, or user prompt.

This is a contract fixture, not evidence of the exact payload emitted by every VS Code, IntelliJ
IDEA, JetBrains plugin, or Copilot version. When validating another runtime, export a real trace,
anonymize it, and add it here as a separate versioned fixture so regressions against that telemetry
shape can be tested. Preserve the span tree and semantic attribute names, but remove source code,
prompts, repository data, user paths, credentials, stable identifiers, and unique timestamps.
