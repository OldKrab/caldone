# Use Pi Agent for the CalDone Assistant runtime

CalDone uses `@earendil-works/pi-agent-core` for persistent conversation state, streaming, validated tool execution, and multi-turn tool loops because it already shares the app's `pi-ai` provider layer. CalDone owns the tool definitions, persistence, authorization rules, and UI; if the transport-neutral core cannot run reliably in React Native, the same boundary may be backed by a small `pi-ai` loop without changing those product contracts.
