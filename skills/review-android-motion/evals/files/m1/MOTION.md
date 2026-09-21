# Motion language — Catalogue

## Design system

Material 3 Expressive, with our own token object on top. Anything we have not customised
follows M3E.

## Fallback

Where this file and M3E are both silent, ask rather than assume.

## Specs

### Destinations changing

- **Intent** — Quick and out of the way. The screen changes; the change itself is not an event.
- **Binding** — `AppMotion.destinationEnter`, `AppMotion.destinationExit`
- **Tag** — `DECIDED`

### Sheets and surfaces expanding

- **Intent** — Settles without bounce. Confident, not playful.
- **Binding** — `AppMotion.surfaceExpand`
- **Tag** — `DECIDED`

### Status and banner fades

- **Intent** — Barely noticed. It should register without pulling the eye.
- **Binding** — `MaterialTheme.motionScheme.defaultEffectsSpec()`
- **Tag** — `OBSERVED`

## Exceptions

- `OnboardingPager` — slow spatial, first run only, deliberate.

## Frequency map

- **Never animate** — Row press states in the catalogue list
- **Standard** — Sheets, destination changes, banners
- **Delight allowed** — First successful sync

## Gestures and haptics

Velocity handoff required on every draggable. `DismissibleCard` is the reference.
Haptics at commit only; never on scroll.

## Reduced motion

Standard Compose APIs handle the duration scale. No in-app toggle.

## Not in this codebase

- Raw `tween` or `spring` outside `AppMotion`
- Directional motion between top-level destinations
