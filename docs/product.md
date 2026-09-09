# Product

CalDone is an Android food diary for people who want useful calorie and macro tracking without making meal logging a separate task. Its promise is a quick photo or description followed by an editable nutrition record.

## Current capabilities

- Capture one or more photos, choose existing images, describe a meal in text, or enter nutrition manually.
- Analyze meals with the connected OpenAI Codex provider and clarify uncertain portions or ingredients.
- Review a daily journal, nutrition totals, goals, and meal history.
- Correct meal details directly or through the assistant; inspect changes and undo supported actions.
- Add another dish to an existing meal. See the [app documentation](../mobile/README.md) for processing and draft-lifetime limits.
- Use English or Russian, configurable units and notifications, and an Android home-screen capture widget.
- Export and import app data, optionally including photos. Credentials are excluded.

These describe the current source. Published APK behavior is tied to its release version; work in progress is not a release promise.

## Constraints

Nutrition values are model estimates, not verified food-database measurements. Keep them editable and never imply clinical accuracy. AI requests require a connected account and network access. Android controls background execution and may interrupt processing.

Meal history and photos are local. Relevant content is sent to the selected provider for analysis or assistant requests. Captured photos stay out of the system gallery unless the user explicitly saves or shares them.

OpenAI Codex is the implemented provider. Barcode scanning, health-platform synchronization, and a dedicated packaged-food database are not implemented.

## Product principles

1. Logging should fit into the meal moment, with reachable controls and minimal interruption.
2. Capture first; let the user return to their day while processing completes.
3. Make pending work, uncertainty, and corrections understandable.
4. Keep changes to the user's records inspectable and tied to their request.
5. Never invent adoption, nutrition accuracy, research, or validation claims.

## Identity and references

The product name is **CalDone**. The production Android application is `mobile/`; its design guidance is in [design.md](design.md), and shared terminology is in [domain.md](domain.md). The current launcher artwork and provenance live in `mobile/assets/`.
