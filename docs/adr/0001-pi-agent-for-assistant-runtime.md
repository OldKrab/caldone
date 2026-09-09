# Use Pi Agent for the CalDone Assistant runtime

CalDone uses `@earendil-works/pi-agent-core` for persistent conversation state, streaming, validated tool execution, and multi-turn tool loops because it already shares the app's `pi-ai` provider layer. CalDone owns the tool definitions, persistence, authorization rules, and UI; if the transport-neutral core cannot run reliably in React Native, the same boundary may be backed by a small `pi-ai` loop without changing those product contracts.


Meal analysis, refinement and correction use the same Pi Agent loop, tool registry, message conversion, photo rehydration and model preferences as Assistant chat. They receive the meal's saved conversations and any completed tool exchanges from the calling chat, and can search previous meals, read their original text and open their photos. An unfinished parent tool call is omitted from the nested analysis context.

The analysis caller owns committing the validated nutrition result. Data-changing tools defer to that boundary during inference, preventing recursive meal analysis and intermediate writes that would outlive cancellation or a deadline. Analysis returns the meal JSON contract; chat retains its conversational response. Transport recovery continues from completed tool results, and hosted-search evidence is collected across the entire loop.

With an open meal clarification, composer text executes the existing answer tool directly. This preserves its revision check, receipt and Undo without requiring a model routing decision. The saved question state is checked on every send; after clarification ends, messages use ordinary chat again.
