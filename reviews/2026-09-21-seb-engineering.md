# Android motion standards — human review

- Reviewer: Seb
- Updated: 2026-09-21T13:45:39.905Z
- Source: [STANDARDS.md at 80479d6](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md)
- Progress: 32/32
- Decisions: 26 keep, 1 revise, 5 discuss, 0 remove

## Floor

### F-001 — Frame-rate values are read in layout or draw, never composition

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L75-L100)

### F-002 — A value the finger controls is an Animatable

**Decision:** keep  
**Confidence:** medium

**Rule comment:** Would pair with a "when should the finger control the animation" taste rule

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L103-L110)

### F-003 — animateItem() requires a stable key

**Decision:** keep  
**Confidence:** high

**Rule comment:** Should probably be a best practice in general to have stable keys and item types in lazy lists but it is out of scope for this skill

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L114-L122)

### F-004 — No shared elements across a View-backed container

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L126-L133)

### F-005 — Hand-driven motion reads the duration scale itself

**Decision:** revise  
**Confidence:** high

**Rule comment:** Rule is fine but "hand-driven" can sound confusingly like touch-driven, while we're talking about time based. Worth clarifying Compose animation APIs do respect the duration scale and are not impacted. Also worth mentioning _how_ to read it

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L137-L149)

### F-006 — animateContentSize clips its child

**Decision:** discuss  
**Confidence:** medium

**Rule comment:** How do we define intentionality?

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L153-L180)

### F-007 — Motion state that survives rotation must be saveable

**Decision:** keep  
**Confidence:** high

**Rule comment:** Probably worth distinguishing touch-driven from time-driven (yes for the latter no for the former)

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L184-L193)

### F-008 — Layout properties have no cheap animated form

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L197-L204)

### F-009 — Feel is not assessed in a debug build

**Decision:** keep  
**Confidence:** high

**Rule comment:** Yes, although this does not apply the other way around; a debug build usually performs (way) worse than a release build, so something that performs well in a debug build will not be a problem in a release build either.

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L208-L218)

### F-010 — sharedElement demands identical content; otherwise sharedBounds

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L222-L233)

## Obligation

### O-001 — Meaning must have a static carrier

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L241-L268)

### O-002 — Every Lottie has a readable disabled frame

**Decision:** discuss  
**Confidence:** Not set

**Rule comment:** I don't know enough about lottie-compose but I am unclear what a reduced motion marker is: if it's the Android a11y setting to REMOVE motion then it should be made clear and use the right name.

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L272-L291)

## Taste

### T-001 — The NavHost default transition is always a finding

**Decision:** discuss  
**Confidence:** Not set

**Rule comment:** I agree 700ms is long but it is unclear to me why this is problematic: is it documented as a bad default designed to annoy you into changing it (like Material 1's default teal colour scheme was)?

**Claim comment:** Again I agree 700ms is way too long for a fade but I wanna understand what the general guidance is here and where it comes from

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L297-L309)

### T-002 — No bare tween() or spring() at a call site

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L313-L332)

### T-004 — Expressive spatial springs stay off elements read as data

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L336-L359)

### T-008 — Custom back is seekable or it is broken

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L363-L377)

### T-009 — Frequency sets the ceiling

**Decision:** keep  
**Confidence:** high

**Rule comment:** Would like to clarify what "platform state layer" means

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L381-L403)

### T-010 — Exits use fewer properties, not shorter durations

**Decision:** discuss  
**Confidence:** Not set

**Rule comment:** Not sure if this is coming from Material or what. Custom design systems may disagree here.

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L407-L428)

### T-011 — The pattern states the relationship

**Decision:** discuss  
**Confidence:** Not set

**Rule comment:** Would like to see where the guidance comes from; this needs flexibility for non-Material use cases

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L432-L462)

### T-012 — Never gate input on an animation finishing

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L466-L481)

### T-013 — Stagger has a total budget, not a per-item delay

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L485-L499)

### T-016 — Unanchored surfaces expand; they do not scale from centre

**Decision:** keep  
**Confidence:** medium

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L503-L522)

### T-017 — A screen introduces itself once

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L526-L536)

### T-018 — Platform overscroll stays unless deliberately replaced

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L540-L550)

### T-019 — Skeletons match structure; indicators have a floor

**Decision:** keep  
**Confidence:** high

**Rule comment:** I would even go as far as suggesting a short crossfade when replacing the skeleton with its content, and perhaps also quickly fade the skeleton in as it appears and force the swap to content not to happen until that's done plus a small anti-flash delay

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L554-L576)

### T-020 — One event, one scheme and one tier

**Decision:** keep  
**Confidence:** Not set

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L580-L596)

### T-021 — Keys identify content, not position

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L600-L609)

### T-022 — Content tracks the keyboard; it does not jump

**Decision:** keep  
**Confidence:** high

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L613-L622)

### T-023 — Motion starts on the input frame

**Decision:** keep  
**Confidence:** Not set

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L626-L636)

### T-024 — Back plays the inverse of forward

**Decision:** keep  
**Confidence:** Not set

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L640-L647)

### T-025 — Where a gesture exists, motion follows the finger

**Decision:** keep  
**Confidence:** Not set

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L651-L659)

### T-026 — One hero motion per event

**Decision:** keep  
**Confidence:** Not set

[Canonical rule](https://github.com/rock3r/android-ux-skills/blob/80479d63138da6d5ab2909ed403f6f2dea73d4f7/STANDARDS.md#L663-L673)
