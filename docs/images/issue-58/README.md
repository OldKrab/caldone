# Meal actions review

Native Android 15 / API 35 screenshots captured on 2026-09-11 at 1080×2400, English, default font scale. The screen uses synthetic breakfast data and the PR's production `MealDetailScreen`, `AnchoredMenu`, and shared buttons.

The isolated review bundle runs in the existing version 1.2.9 (22) native shell; application source is based on main a7b2094 plus the #58 PR changes. This is a component harness, not a published release. Navigation and AI callbacks are inert, and it does not read or write meal data.

- [Meal details](meal-details.png): filled **Edit or discuss**, outlined **Add food or drink**, and a three-dot header trigger.
- [Open menu](meal-menu.png): **Edit manually** and **Reanalyze meal**, anchored without a dim backdrop.

These captures verify layout, not production navigation, persistence, or provider-backed reanalysis. Russian and enlarged-text rendering remain unverified.
