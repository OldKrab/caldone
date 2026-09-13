# Separate user notes and AI comments

Actual Android 15 / API 35 phone captures with Russian copy and font scale 1.3, reviewed for the `shushakov/ai-meal-comments` change based on 1.2.13. They render the current production `MealDetailScreen` with synthetic data in a compatible 1.2.12-preview.2 native runtime. The bottom “Показать…” switch belongs only to the component harness.

- [Meal with an estimate](estimated.png): the user note and AI comment retain distinct labels and styling.
- [Meal without an estimate](no-estimate.png): both texts remain available before nutrition is saved.

The captures were inspected and passed a separate visual review at this scope. They verify readable layout, not production navigation, persistence, provider behavior, or a final release APK. Separate automated tests cover saving, editing, clearing, Undo, legacy database migration and backup import. Two real Astra high turns saved and corrected the AI comment while preserving the original note and nutrition.
