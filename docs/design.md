---
name: CalDone
description: Native Android meal journal.
colors:
  canvas: "#F5F8F6"
  surface: "#FFFFFF"
  surfacePressed: "#E7F0EA"
  ink: "#172E26"
  muted: "#596A62"
  line: "#DCE5DF"
  action: "#176B4D"
  actionPressed: "#105339"
  actionSoft: "#E2F0E7"
  pending: "#866019"
  attentionSoft: "#FAF1DB"
  error: "#A33D39"
  errorSoft: "#FBEAE7"
  camera: "#101B17"
  cameraChrome: "rgba(16, 27, 23, 0.86)"
  cameraInput: "#26382E"
  cameraLine: "#647C6D"
  cameraMuted: "#CAD8CF"
typography:
  display:
    fontFamily: "sans-serif-medium"
    fontSize: "32sp"
  headline:
    fontFamily: "sans-serif-medium"
    fontSize: "25sp"
    lineHeight: "31sp"
  body:
    fontSize: "15sp"
    lineHeight: "21sp"
  label:
    fontSize: "12sp"
rounded:
  sm: "6dp"
  control: "14dp"
  surface: "18dp"
  image: "14dp"
  round: "999dp"
spacing:
  xs: "4dp"
  sm: "8dp"
  md: "16dp"
  lg: "24dp"
  xl: "32dp"
  xxl: "48dp"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "14dp 24dp"
  button-primary-pressed:
    backgroundColor: "{colors.actionPressed}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
---

# Design System: CalDone

## Overview

**Creative North Star: "Kitchen Scale Instrument"**

A precise everyday instrument with the clarity of a daily journal: compact nutrition readings, readable meal rows, and a dedicated photo action. Mineral white, deep green ink, emerald actions, and soft sage selections provide a shared visual language across logging, editing, setup, settings, and Assistant.

This document describes the production Android app in `mobile/`, with package `dev.caldone.app` and scheme `caldone`. [Product scope](product.md) owns behavior; [migration guidance](migrations.md) describes the separate installation introduced in 1.2.0.

Implementation references are `mobile/src/design/tokens.ts`, shared components, and feature screens. The frontmatter records native values: layout dimensions are dp and text sizes are sp, represented by React Native numeric styles. These are not CSS requirements. Typography entries describe observed roles rather than a complete centralized type scale.

The palette is static and light. Do not infer dark-theme support, Dynamic Color, tablet readiness, or full accessibility compliance from these source values.

## Colors

Emerald `action` marks primary actions, selections, and success. `actionPressed` provides the pressed state; `actionSoft` provides sage budget and selected surfaces. Primary text uses `ink`; `muted` supports metadata without competing with results. `canvas`, white `surface`, and fine `line` separators establish ordinary structure.

Amber `pending` and `attentionSoft` identify unresolved work. Red `error` and `errorSoft` identify failures and destructive actions. Status must also have readable text or an icon. Camera surfaces use their own dark background, translucent chrome, input, line, and muted-text roles; white supplies camera foreground text.

## Typography

Android hierarchy uses the native `sans-serif-medium` face, including Cyrillic; ordinary body text uses the system default. The legacy token names `ticket` and `ticketBold` both resolve to this platform face, not a condensed ticket font. No new font assets are required.

Today uses a 27sp date heading, 32sp energy reading, 16sp macro values and meal names, and 12sp metadata. Meal detail uses a 25sp title with 31sp line height, a 23sp calorie result, and body copy commonly at 15sp with 21sp line height. Shared primary buttons use 16sp text. Preserve native font scaling; font-scale rendering still needs device verification.

## Layout

Compact Android phones are the implemented target. Today has a 16dp header inset and 20dp content inset. Its date controls lead a compact sage energy budget and three macro readings, followed by attention states and a journal of meals. The camera action occupies its own footer above primary navigation, separate from the scrolling journal. Avoid returning to a large floating ticket that obscures rows.

Meal detail leads with title, calorie result, and macros. Supporting photos use a compact 138dp-high gallery; ingredients and notes follow. Editing uses expandable ingredient sections and a dedicated save dock, keeping the selected ingredient's fields together. Shared spacing uses the documented scale; local 10–20dp values support compact screen composition.

The app shell owns bottom navigation and inset handling. Editable surfaces use the keyboard-aware layout helpers. Preserve system Back and reachable actions above the IME. Do not treat the phone layout as validated for tablets.

## Elevation & Depth

Ordinary content is flat: tonal surfaces and hairline separators carry hierarchy. Shared primary buttons have zero shadow opacity and zero elevation. Overlays alone carry lift: `AnchoredMenu` uses native elevation 7 and `AppDialog` elevation 8. Their React Native shadow definitions remain in the components; there is no browser box-shadow contract.

Screen reveal uses a short opacity transition with an 8dp vertical settle, 220ms duration, and cubic ease-out; reduced motion skips this animation. Shared motion tokens also include a 140ms quick duration. Do not invent a new motion vocabulary per screen.

## Shapes

Shared controls and images use 14dp corners; working surfaces use 18dp; small details use 6dp. Circular controls use the round token. Today's budget has a deliberate local 22dp radius. Flat meal rows use compact 68×76dp photos with 14dp corners. Borders are solid and restrained; the old perforated kitchen-check motif is no longer the organizing system.

## Components

- **Primary button:** Emerald fill, white text, 54dp minimum height, 14dp vertical and 24dp horizontal padding. Press darkens the fill and translates it 1dp; busy/disabled states block activation and reduce opacity to 0.45. Busy replaces content with a spinner.
- **Brand artwork:** `mobile/assets/caldone-fork-icon.png` is the white bent-fork/check silhouette on an emerald square, shared by the launcher, welcome brand row, and About. The selected 1254×1254 PNG is opaque RGB; generation provenance is in the sibling `.md` file. The Android launcher plugin applies 12% foreground insets for adaptive masks. No monochrome icon is configured. Asset inspection does not substitute for launcher-mask validation on a device.
- **Icon button:** 48×48dp circular frame, 23dp icon, accessible label and selected/disabled state. Press reduces opacity and scale. Camera variants use translucent dark chrome.
- **Fields:** Meal editor fields use white fill, a thin line border, 14dp corners, 15sp text, and 50dp minimum height. Ingredient accordions expose details on demand; the save dock remains distinct from ingredient deletion. Manual creation uses creation-specific header and action copy, without presenting an unsaved draft as an existing meal.
- **Journal rows:** Meal name, meal type and time, calorie result or processing status, and compact imagery. Completed analyses also show a quiet protein/carbohydrate/fat line with localized abbreviations and units. Attention remains legible without replacing the daily budget or consuming the whole journal. A processing state must not impersonate a completed calorie estimate.
- **Capture review:** Dark camera workspace, selected photo preview, a thumbnail strip with Add photo, optional note, and one primary Analyze meal action.
- **Navigation:** A white bottom surface with a fine top divider, icon and 12sp label destinations, and a sage selected indicator. Selection and press feedback stay inside the same small 58×30dp icon pill; the whole destination does not acquire a competing pressed background. Capture has its own footer above it.
- **Welcome, setup, settings, providers:** First open has a dedicated welcome surface with the brand, a short introduction, three photo/breakdown/correction steps, and one start action. Redesigned setup stages carry a clear step hierarchy and shared green choices/actions. Settings retain native typography and quiet rows. Provider selection uses its control to communicate state without repetitive selection copy.
- **Assistant:** Restrained conversation, readable prose, quiet operational states and a reachable composer. Messages and clarification questions use native long-press text selection; no persistent Copy buttons. Inline meal analysis is visible in chat and refreshes its questions on completion. Meal clarifications and structured Assistant questions offer selectable answers, Not sure, and optional custom text. No answer is preselected; Send answers submits the explicit selections together. Choices wrap into 48dp-minimum touch targets, and historical Assistant questions become inactive after a reply. Legacy meal questions remain readable without generated presets. Transient connection failures retry once after foreground recovery; persistent failures offer an explicit retry. One tool call stays a direct operational row; consecutive calls across internal messages share a stable collapsible group. User messages and assistant prose break groups to preserve chronology. Labels stay generic until execution starts; execution events supply running, completed, failed, and cancelled states. Active and failed rows remain visible when completed details collapse. Action receipts expose before/after snapshots through “What changed” and keep Undo separate; missing historical detail is stated explicitly. Avoid AI decoration, fake progress, or visual claims of nutrition certainty.
- **Menus and dialogs:** Use `AnchoredMenu` beside overflow triggers without a dimmed backdrop. Use `AppDialog` for app-owned confirmations, notices, errors, and unanchored actions. OS-owned permission, authentication, camera, photo-picker, and share interfaces may remain native.

## Do's and Don'ts

- **Do** keep the journal compact and put the meal result before supporting detail.
- **Do** reuse semantic tokens and Cyrillic-capable native typography.
- **Do** preserve Android touch-target, inset, keyboard, Back, and reduced-motion behavior, and verify them on a working native runtime.
- **Do** show state with words or icons as well as color.
- **Don't** reintroduce condensed kitchen-ticket fonts, perforation motifs, or large overlapping capture panels.
- **Don't** turn every row into a floating card or every state into a prominent badge.
- **Don't** use `Alert.alert` or stock platform dialogs for app-owned interactions.
- **Don't** claim screenshot approval, dark-theme support, or device validation from source checks.
