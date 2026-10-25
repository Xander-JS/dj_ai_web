# SYSTEM DJ — Design System Reference (as implemented)

> **Purpose.** A code-faithful reference to the visual system used by **Home**, **Login** and **Sign Up**, so that future sessions can extend the interface consistently without previous conversation context.
>
> **Scope.** Only these three sections define the documented identity. The console screens (Dashboard, Library, Playlists, Mixer, Sessions, Settings, Profile) and their `src/components/ui`, `dj`, `library`, `dashboard`, `profile` and `src/layouts` components are **legacy** and are **not** part of this system. Legacy tokens are mentioned only where these three sections consume them.
>
> **Method.** Static inspection of the source on branch `refactor/ui-home` (2026-10-24). Nothing was rendered in a browser for this document. Values marked *not verified* could not be confirmed from code alone.
>
> **Update (2026-10-24).** Home (console `/dashboard`), Library, Playlists and Sessions now use this system through `ConsoleTemplate`; the shell's Header and Sidebar were restyled. See §15. Settings, Profile and the notifications panel followed the same day (§16). Accent palette, motion preference, bulk selection and the sidebar panel: §17. Density, PlayerBar + queue + visualizer, navigation shortcuts and Library filters: §18. The Mixer remains legacy.
>
> **Related files.** `docs/DESIGN.md` is an earlier design-intent spec (YAML front matter + prose) for the same system. It is consistent with the code in most respects; known differences are listed in §12.5. When the two disagree, **the code and this document win**.

---

## 0. Implementation status of the three reference sections

| Section | Route | Status | Git state | Entry file |
|---|---|---|---|---|
| Home / Landing | `/` | Implemented | Committed (`45769b8` and earlier) | `src/pages/Landing.tsx` → `src/components/templates/LandingTemplate.tsx` |
| Login (+ forgot password) | `/login` | Implemented | **Uncommitted** (untracked `src/pages/Login.tsx`, `src/components/templates/AuthTemplate.*`) | `src/pages/Login.tsx` → `AuthTemplate` |
| Sign Up | `/signup` | Implemented | **Uncommitted** (untracked `src/pages/SignUp.tsx`) | `src/pages/SignUp.tsx` → `AuthTemplate` |

Behavioural notes that affect what is visible:

- `Landing.tsx` redirects to `/dashboard` when there is a session **or when Supabase is not configured** (`isConfigured === false`). Home is therefore only visible with Supabase configured.
- Login/Sign Up render the page but replace the form with `AuthUnavailableNotice` when Supabase is not configured.
- Routes are lazy-loaded in `src/App.tsx`. Unauthenticated console routes redirect to `/login` with `state.from`.

---

## 1. Visual identity

The code calls this **"Design System v2"** (header of `src/design-system/tokens.css`). Its own description: *"póster plano — fondo papel, tinta negra, naranja de acción y campos planos salvia, amarillo ácido y negro. Sin degradados, cristal ni sombras en reposo; las superficies se separan por cambio de color."*

Principles observable in the code:

| Principle | Evidence |
|---|---|
| **Flat poster.** Colour arrives as whole flat "fields" that own a region; no gradients, no glass, no resting shadows. | No `gradient`, `backdrop-filter`, `blur` or `box-shadow` in any atom/molecule/organism/template CSS. The only `box-shadow` lines in `AuthTemplate.css` neutralise legacy input styles (see §11). |
| **One typeface, weight-driven hierarchy.** | Only `Kanit` (`--sd-font`), 4 weights. |
| **Shouted display type.** Kanit 900, uppercase, tight leading (0.86) and negative tracking (‑0.03em). | `.sd-hero__title`, `.sd-features__title`, `.sd-closing__title`, `.sd-privacy__title`, `.sd-auth__title`. |
| **Name runs edge to edge.** | Hero title uses `--sd-text-poster: 21.1cqi` inside a `container-type: inline-size` wrapper, `white-space: nowrap`. |
| **Pills for every control, one large radius for panels.** | `--sd-radius-pill` on buttons, segmented controls, chips, inputs (auth); `--sd-radius-panel` (2rem) on bands, panels, tiles. |
| **Rounded-top panels stacked like sheets.** | Hero band, Features, Closing and the Auth stage use `border-radius: var(--sd-radius-panel) var(--sd-radius-panel) 0 0` (Auth desktop: top-left only). Closing pulls up by one radius (`margin-top: calc(-1 * var(--sd-radius-panel))`). |
| **Real cut-out 3D objects overlap seams and corners.** | Headphones straddle the hero seam; renders break the top-right corner of feature panels; a live WebGL speaker sits in the auth field. |
| **Field Ink rule.** Text on accent/sage/acid/paper fields is always black; on the inverse field it is `#f4f4f4`. | `--sd-field-ink` (#000) on fields, `--sd-inverse-ink` on inverse; `.sd-on-field` remaps button inks (§6.1). |
| **Musical identity through content, not ornament.** | Tempo band readouts (BPM, Camelot keys, SYNC…), Camelot `KeyMatcher` using the real engine rule, speaker pulsing at 124 BPM. |
| **Motion = exponential ease-out, no bounce, always a reduced-motion path.** | `--sd-ease-out` / `EASE_OUT = [0.16, 1, 0.3, 1]`; every animated component checks `useReducedMotion()` or has a `prefers-reduced-motion` rule (exceptions in §9.6). |

Login and Sign Up reuse the same page shell (`.sd-landing`), navbar, typography, buttons and field colours: form on paper on the left, a coloured field with the 3D speaker on the right (**sage** for Login, **accent orange** for Sign Up).

---

## 2. Color palette

### 2.1 Centralized v2 tokens — `src/design-system/tokens.css`

Light values are defined on `:root`; dark overrides on `[data-theme='dark']`. "—" in the Dark column means the token is **not overridden** and keeps its light value in dark theme.

| Token | Light | Dark | Role / observed usage | Used by (files) |
|---|---|---|---|---|
| `--sd-paper` | `#ffffff` | `#0f0f0f` | Page ground; text colour on ink buttons | LandingTemplate, AuthTemplate, Button, LanguageSwitch, tokens.css (scrollbar) |
| `--sd-surface` | `#f3f3f1` | `#1b1b1b` | Hover tone (ghost/icon buttons), segmented-control track, autofill background | Button, IconButton, LanguageSwitch, AuthTemplate |
| `--sd-ink` | `#000000` | `#f4f4f4` | Primary text, filled "ink" button, wordmark | Button, IconButton, Wordmark, LanguageSwitch, HeroSection, LandingTemplate, AuthTemplate |
| `--sd-ink-soft` | `#545454` | `#b4b4b4` | Secondary text, input borders/icons, hover of ink buttons, scrollbar thumb | Button, LanguageSwitch, AuthTemplate, tokens.css |
| `--sd-accent` | `#fe7141` | — | Primary action colour; also a field (closing band, analysis panel, Sign Up stage, tempo tiles); wordmark disc centre; caret colour | Button, Wordmark.tsx (SVG fill), TempoBand, FeaturePanel, ClosingSection, LandingTemplate (skip-link outline), AuthTemplate |
| `--sd-accent-hover` | `#ff5a22` | — | Hover of accent buttons | Button, AuthTemplate |
| `--sd-accent-ink` | `#000000` | — | Text on accent buttons | Button, AuthTemplate |
| `--sd-field-sage` | `#d1ddd3` | — | Field: hero band, sync panel, Login stage, success message, tiles | HeroSection, FeaturePanel, TempoBand, AuthTemplate |
| `--sd-field-acid` | `#f0ff1c` | — | Field: AI panel, tiles, error message (auth); KeyMatcher readout on black; closing wordmark disc | FeaturePanel, TempoBand, KeyMatcher, ClosingSection, AuthTemplate |
| `--sd-field-paper` | `#ffffff` | — | White field (export panel), KeyMatcher result chips — stays white in dark | FeaturePanel, KeyMatcher |
| `--sd-field-ink` | `#000000` | — | Text on any colour field; ink button on fields | HeroSection, FeaturePanel, TempoBand, KeyMatcher, ClosingSection, Button, AuthTemplate |
| `--sd-field-ink-contrast` | `#f4f4f4` | — | Text of ink buttons placed on a field | Button |
| `--sd-inverse` | `#000000` | `#1d1d1d` | Large black panel behind Features; inverse tempo tiles | FeaturesSection, TempoBand |
| `--sd-inverse-ink` | `#f4f4f4` | `#f4f4f4` | Text on inverse | FeaturesSection, TempoBand |
| `--sd-inverse-ink-soft` | `#b9b9b9` | `#b4b4b4` | — | **Defined but unused** |
| `--sd-focus` | `#000000` | `#f0ff1c` | Focus outline colour | Button, IconButton, LanguageSwitch, LandingNavbar, AuthTemplate |
| `--sd-selection` | `#f0ff1c` | — | `::selection` background | LandingTemplate |

Other colour-related global rule in `tokens.css`: `html[data-scroll-mode='document'] { scrollbar-color: var(--sd-ink-soft) var(--sd-paper); }`.

### 2.2 Hardcoded colours in Home / Login / Sign Up components

| Value | File | Usage |
|---|---|---|
| `#000000` | `src/components/templates/LandingTemplate.css` | `::selection` text colour (paired with `--sd-selection`) |
| `rgb(0 0 0 / 0.08)` | `src/components/atoms/Button.css` | Ghost button hover on a field (`.sd-on-field`) |
| `rgb(0 0 0 / 0.08)` | `src/components/molecules/KeyMatcher.css` | Mode toggle button hover |
| `rgb(0 0 0 / 0.1)` | `src/components/molecules/KeyMatcher.css` | Mode toggle track |
| `rgb(255 255 255 / 0.12)` | `src/components/molecules/KeyMatcher.css` | Icon-button hover inside the black dial |
| `#141414` | `src/components/atoms/speakerScene.ts` | Speaker material base colour (three.js) |
| `vec3(0.16, 0.16, 0.17)` | `src/components/atoms/speakerScene.ts` | Cone colour mixed in fragment shader (graphite) |
| `#fff4ea`, `#e6eeff` | `src/components/atoms/speakerScene.ts` | Key (warm) and rim (cool) directional lights |

The translucent black/white overlays are always placed on fixed-colour fields, so they do not depend on theme.

### 2.3 Gradients

None. No CSS or JS gradient exists in the Home/Login/Sign Up code.

### 2.4 Legacy colour tokens touched by these sections

Defined in `src/index.css` (HSL, `--hue-neutral: 240`, `--hue-primary: 260` by default). They reach Login/Sign Up only because the auth forms reuse legacy `ui/Input`, `ui/Button` and `auth/AuthForm.css` (see §5 and §12). Inside `.sd-auth__form` most are **re-mapped** to v2 tokens:

| Legacy token | Re-mapped in `.sd-auth__form` to | Notes |
|---|---|---|
| `--text-primary` | `var(--sd-ink)` | |
| `--text-secondary` | `var(--sd-ink-soft)` | |
| `--text-tertiary` | `var(--sd-ink-soft)` | |
| `--bg-surface` | `var(--sd-paper)` | |
| `--bg-surface-hover` | `var(--sd-surface)` | |
| `--color-primary-500` | `var(--sd-accent)` | Neutralises the user "accent colour" setting inside the form |
| `--color-primary-600` | `var(--sd-accent-hover)` | |
| `--color-error`, `--color-success` | not re-mapped | Overridden by more specific rules (`.sd-auth__form .auth-form-message-error/success` set `color: var(--sd-field-ink)`) |
| `--text-inverse`, `--border-base`, `--border-strong`, `--color-secondary-500`, `--bg-base` | not re-mapped | Referenced by legacy `ui/Button.css`/`ui/Input.css` rules; most are overridden by `.sd-auth__form` rules. Whether `--bg-base` still shows on a **disabled** input depends on stylesheet order — *not verified*. |

Home does not use any legacy colour token. Note, however, that `body` in `src/index.css` still sets `background-color: var(--bg-base)` and `color: var(--text-primary)`; `.sd-landing` paints its own background over it.

---

## 3. Typography

### 3.1 Families and sources

| Family | Source | Weights | Used by these sections? |
|---|---|---|---|
| **Kanit** | Self-hosted `@font-face` in `src/design-system/tokens.css`; files `public/assets/fonts/kanit-{300,400,500,900}.woff2`; `font-display: swap` | 300, 400, 500, 900 (normal style only) | **Yes — the only family** |
| Inter, Outfit | Google Fonts `@import` at top of `src/index.css` | Inter 400–700, Outfit 500–800 | No (legacy). They are still **downloaded on every page**, including Home, because the import is global. |

`.sd-landing` sets `font-family: var(--sd-font)` and re-declares it for `h1, h2, h3` to defeat the legacy global rule `h1…h6 { font-family: var(--font-family-heading) }`. Inside `.sd-auth__form`, `--font-family-sans` is re-mapped to `var(--sd-font)`.

### 3.2 Typography tokens (`tokens.css`)

| Token | Value |
|---|---|
| `--sd-font` | `'Kanit', system-ui, sans-serif` |
| `--sd-weight-light` | `300` |
| `--sd-weight-regular` | `400` |
| `--sd-weight-medium` | `500` |
| `--sd-weight-black` | `900` |
| `--sd-text-poster` | `21.1cqi` (needs a `container-type: inline-size` ancestor) |
| `--sd-text-section` | `clamp(2.5rem, 7.4vw, 7.5rem)` |
| `--sd-text-statement` | `clamp(1.375rem, 2.3vw, 2.25rem)` |
| `--sd-text-body` | `clamp(1rem, 0.95rem + 0.25vw, 1.1875rem)` |
| `--sd-text-note` | `0.9375rem` |
| `--sd-leading-display` | `0.86` |
| `--sd-leading-statement` | `1.25` |
| `--sd-leading-body` | `1.55` |
| `--sd-tracking-display` | `-0.03em` |

The token file states: *"Cinco pasos de tamaño visibles: póster, sección, declaración, cuerpo, nota."*

### 3.3 Hierarchy as applied

| Level | Size token | Weight | Leading | Tracking | Transform | Where |
|---|---|---|---|---|---|---|
| Poster | `--sd-text-poster` | 900 | display (0.86) | display | uppercase, nowrap | `.sd-hero__title` (h1) |
| Section heading | `--sd-text-section` | 900 | display | display | uppercase, `text-wrap: balance` | `.sd-features__title`, `.sd-closing__title`, `.sd-privacy__title` (h2) |
| Auth title | `max(2.5rem, min(var(--sd-text-section), 13cqi))` *(local formula)* | 900 | display | display | uppercase, balance | `.sd-auth__title` (h1) |
| Readout | `--sd-text-section` | 900 | display | display | nowrap | `.sd-tempo-band__value` |
| Statement (sentence) | `--sd-text-statement` | 500 | **1.12** *(local)* | **‑0.01em** *(local)* | — | `.sd-hero__subtitle`, `.sd-auth__statement` |
| Statement (paragraph) | `--sd-text-statement` | 500 | `--sd-leading-statement` | — | `text-wrap: pretty` | `.sd-privacy__body` |
| Panel title | `--sd-text-statement` | 900 | **1** *(local)* | **‑0.02em** *(local)* | uppercase | `.sd-feature-panel__title` (h3) |
| Key code | `--sd-text-statement` | 900 | 1 | — | tabular-nums | `.sd-key-matcher__code` |
| Body | `--sd-text-body` | 300 | `--sd-leading-body` | — | — | hero description, panel description, auth intro, auth messages |
| Button label | `--sd-text-body` | 500 | 1 | — | — | `.sd-button`, auth `.btn-primary/.btn-outline` |
| Wordmark | `--sd-text-body` | 900 | 1 | **‑0.01em** *(local)* | — | `.sd-wordmark` |
| Note / label | `--sd-text-note` | 400 or 500 (300 for secondary notes) | inherited / **1.4** in auth notices *(local)* | — | — | tempo labels, KeyMatcher labels, LanguageSwitch, footer `small`, auth labels, auth ghost links, auth notices |

Base text on the page shell: `.sd-landing { font-weight: var(--sd-weight-light) }`. `.sd-landing` does **not** set `line-height`, so elements without their own value inherit the legacy `body { line-height: var(--line-height-normal) }` (1.5) from `src/index.css`.

---

## 4. Spacing and dimensions

### 4.1 Is there a centralized scale?

**Yes, partially.** `tokens.css` defines a small v2 spacing set. It is used for most gaps and outer margins, but many paddings, widths and fluid `clamp()` values are still defined locally in each component.

| Token | Value | Used in |
|---|---|---|
| `--sd-margin` | `clamp(1rem, 2.4vw, 2.25rem)` | Outer horizontal margin of every section: navbar, hero, privacy, features, closing, auth panel, skip link |
| `--sd-gap-1` | `0.5rem` | Button icon gap, navbar actions, KeyMatcher dial/chips, auth input label gap |
| `--sd-gap-2` | `0.75rem` | Tempo band rows, closing actions, KeyMatcher, skip link offset, navbar wrap |
| `--sd-gap-3` | `1rem` | Navbar, hero copy, feature copy, features grid column gap, closing footer |
| `--sd-gap-4` | `1.5rem` | Hero band row gap, KeyMatcher, closing footer top, auth form field gap, auth intro margin |
| `--sd-gap-5` | `2.5rem` | Hero band column gap, feature panel inner gap, closing grid, auth panel padding, auth form margin |
| `--sd-gap-6` | `4rem` | Only in Auth (`.sd-auth__panel` bottom padding) |
| `--sd-section-gap` | `clamp(5rem, 11vw, 10rem)` | Privacy, Features (bottom), Closing vertical padding |
| `--sd-nav-height` | `4.75rem` | **Local token** declared on `.sd-landing` in `LandingTemplate.css`; used by navbar, hero and auth main |

Legacy `--space-*`, `--size-*`, `--layout-*` (`src/index.css`) are **not** used by Home. They leak into Login/Sign Up only through legacy form CSS (e.g. `.auth-form-links { gap: var(--space-2) }`, `.btn { gap: var(--space-2) }`). Because `[data-density='compact']` rewrites `--space-*`, the Settings density option can still slightly change those gaps on the auth pages; v2 tokens are unaffected by density.

### 4.2 Locally defined spacing (not tokenized)

| Value | File / selector |
|---|---|
| `clamp(4rem, 9vw, 8rem)` top padding | `TempoBand.css` `.sd-tempo-band` |
| `clamp(1rem, 1.6vw, 1.5rem) clamp(1.25rem, 2.2vw, 2rem)` | `TempoBand.css` tile padding; tile gap `0.25rem` |
| `clamp(0.25rem, 1.5vh, 1.5rem)` | `HeroSection.css` title wrap top padding |
| `clamp(1.75rem, 3vw, 2.75rem)` | `HeroSection.css` band padding-top and `AuthTemplate.css` stage padding (duplicated) |
| `clamp(1.75rem, 3.2vw, 3rem)` | `HeroSection.css` band bottom padding |
| `clamp(1.5rem, 3vw, 2.75rem)` | `FeaturePanel.css` inner padding |
| `clamp(4rem, 7vw, 7rem)`, `clamp(4rem, 8vw, 7rem)`, `clamp(4rem, 7vw, 6.5rem)` | `FeaturesSection.css` (section top, title bottom margin, grid row gap) |
| `clamp(2rem, 4vw, 3rem)` | `ClosingSection.css` content gap |
| `clamp(2rem, 4vw, 3.5rem)` | `PrivacyStatement.css` gap |
| `0 1.25rem` / `0 2rem` | `Button.css` md / lg padding |
| `0 1rem`, `0 1.5rem 0 3.25rem`, `left: 1.25rem`, `0.875rem 1.5rem` | `AuthTemplate.css` ghost button, input, input icon, notices |
| `3px`, `4px`, `0 0.75rem`, `0 1rem`, `0.55rem 1rem` | `LanguageSwitch.css`, `KeyMatcher.css` tracks, options and chips |
| `0.75rem 1.25rem` | `LandingTemplate.css` skip link (focused) |
| `0.625rem` | `Wordmark.css` gap |

### 4.3 Widths and heights

| Value | Where |
|---|---|
| `max-width: 34rem` (with `container-type: inline-size`) | `.sd-auth__content` |
| `max-width: min(36rem, 40vw)` → `min(30rem, 46vw)` ≤1024px → `none` ≤640px | `.sd-hero__copy` |
| `max-width: 30rem` | `.sd-feature-panel__copy` |
| `width: min(100%, 35rem)` | `.sd-closing__visual` |
| `ch`-based measures: `46ch`, `42ch`, `40ch`, `22ch`, `16ch`, `20ch` | hero description, privacy body, auth intro, features title / auth statement, closing title, auth statement ≤900px |
| `min-height: 100svh` | `.sd-landing` |
| `min-height: min(calc(100svh - var(--sd-nav-height)), calc(62vw + 14rem))` | `.sd-hero` |
| `min-height: clamp(15rem, 38svh, 24rem)` | `.sd-hero__band` |
| `min-height: clamp(24rem, 36vw, 34rem)` | `.sd-feature-panel__inner` |
| `min-height: 34rem` → `clamp(18rem, 36svh, 24rem)` ≤900px → `0` ≤640px | `.sd-auth__stage` |
| Decoration widths `clamp(11rem, 22vw, 20rem)`, wide `clamp(15rem, 30vw, 28rem)` | `FeaturePanel.css` |
| Hero visual `clamp(18rem, min(38vw, 64svh), 40rem)` | `HeroSection.css` |

There is **no shared container component or max-width token**. Sections run full-bleed with `--sd-margin` padding; content widths are constrained per component.

### 4.4 Radii

| Token | Value | Use |
|---|---|---|
| `--sd-radius-panel` | `2rem` | Bands, panels, tiles, auth stage, auth notices |
| `--sd-radius-pill` | `999px` | Buttons, icon buttons, segmented controls, chips, KeyMatcher dial, auth inputs/buttons, skip link, brand link focus ring |

No other radius values are used by these sections.

### 4.5 Control sizes

| Token / value | Use |
|---|---|
| `--sd-control-height` `2.75rem` | Button md (`min-height`), IconButton (width/height), KeyMatcher chips, auth ghost link; segmented options use `calc(var(--sd-control-height) - 6px)` |
| `--sd-control-height-lg` `3.75rem` | Button lg, auth inputs and primary/outline buttons |
| `3rem` *(hardcoded)* | Coarse-pointer minimum for `.sd-button`, `.sd-icon-button`, auth `.btn-ghost` |
| `2.75rem` *(hardcoded)* | Coarse-pointer KeyMatcher mode buttons; LanguageSwitch option `min-width` |
| `--sd-focus-width` `3px`, `--sd-focus-offset` `3px` | Focus outlines (offset is overridden to `1px` / `-3px` in segmented controls and the dial) |

### 4.6 Icon sizes

Icons come from **lucide-react**, sized per call (no token):

| Size | Where |
|---|---|
| 20 | `ArrowRight` in hero and closing CTAs; `Moon`/`Sun` in `ThemeToggle` |
| 22 | `ChevronLeft`/`ChevronRight` in `KeyMatcher` |
| 16 | `Mail`/`Lock` in legacy auth forms |
| `1.75rem` | Wordmark SVG disc (`Wordmark.css`) |

### 4.7 Elevation and shadows

No elevation system in v2. No shadows at rest. Stacking uses local `z-index` values only: skip link `20`, navbar `5`, hero copy/CTA `4`, hero visual `3`, feature panel copy/interactive `2`, feature decoration `1`.

---

## 5. Atomic Design architecture

The v2 components live under `src/components/{atoms,molecules,organisms,templates}` and pages under `src/pages`. This structure is used **only** by Home, Login and Sign Up. The rest of the app uses a different, feature-based layout (`src/components/ui`, `auth`, `dj`, `library`, `dashboard`, `profile`, `src/layouts`).

Login and Sign Up are a **hybrid**: the template and page follow Atomic Design, but the forms themselves are the pre-existing `src/components/auth/*` components built on legacy `src/components/ui/{Button,Input}`, restyled from the template's CSS.

Overall assessment: **Partially implemented** — clean for Home; partial for the auth pages.

### 5.1 Atoms — `src/components/atoms/` — Implemented

| Component | Responsibility | Reuses | Used by |
|---|---|---|---|
| `Button` (`Button.tsx/.css`) | Pill button, variants `accent` \| `ink` \| `ghost`, sizes `md` \| `lg`, `type="button"` default | — | LandingNavbar, HeroSection, ClosingSection |
| `IconButton` | Round icon-only button; `label` required (→ `aria-label` + `title`) | — | ThemeToggle, KeyMatcher |
| `FadeIn` | One-time viewport entrance (opacity + x/y), polymorphic `as` (div, p, h1–h3, li, span) | motion.ts | Navbar, Hero, FeaturePanel, FeaturesSection, ClosingSection, PrivacyStatement, AuthTemplate |
| `FloatingImage` | Decorative `<picture>` (WebP + PNG) with scroll parallax, entrance scale and rest tilt | motion.ts | FeaturesSection, ClosingSection |
| `Magnet` | Pointer-following spring wrapper (fine pointer only) | motion.ts, documentScroll.ts | HeroSection |
| `ScrollRevealText` | Paragraph that lights up per character with scroll; plain text for screen readers | — | PrivacyStatement |
| `Wordmark` | SVG disc mark + brand name | — | LandingNavbar, ClosingSection |
| `Speaker3D` (+ `speakerScene.ts`, `speakerPulse.ts`) | Lazy WebGL speaker with pulsing cone and image fallback | three.js (dynamic import) | AuthTemplate only |

### 5.2 Molecules — `src/components/molecules/` — Implemented

| Component | Responsibility | Reuses | Used by |
|---|---|---|---|
| `FeaturePanel` | Flat colour field (`accent` \| `sage` \| `acid` \| `paper`) with optional decoration or interactive child; copy anchored bottom-left | FadeIn | FeaturesSection |
| `KeyMatcher` | Interactive Camelot key stepper + Minor/Major toggle; lists compatible keys | IconButton, `audio/analysis/camelotMapper` | FeaturesSection |
| `LanguageSwitch` | Generic segmented control of `aria-pressed` buttons | — | LandingNavbar |
| `PrivacyStatement` | Title + scroll-revealed statement | FadeIn, ScrollRevealText | PrivacySection |
| `ThemeToggle` | Light/dark icon toggle with animated icon swap (no CSS file) | IconButton | LandingNavbar |

### 5.3 Organisms — `src/components/organisms/` — Implemented

| Component | Responsibility | Reuses |
|---|---|---|
| `LandingNavbar` | Brand link, language, theme, Log in (ghost), Sign up (ink); optional `current` marks the active auth page with `aria-current="page"`; writes language/theme to `settingsStore` | Button, FadeIn, Wordmark, LanguageSwitch, ThemeToggle |
| `HeroSection` | Poster title, sage band with subtitle/description/CTA, magnetic shutter-revealed headphones | Button, FadeIn, Magnet |
| `TempoBand` | Two `aria-hidden` rows of readout tiles moving in opposite directions with scroll | — |
| `PrivacySection` | Centred privacy section | PrivacyStatement |
| `FeaturesSection` | Inverse panel with title and 2×2 FeaturePanel grid | FadeIn, FloatingImage, FeaturePanel, KeyMatcher |
| `ClosingSection` | Accent closing band with CTA, secondary action, image, footer | Button, FadeIn, FloatingImage, Wordmark |
| `landingAssets.ts` | Central list of 3D image paths/dimensions (`HERO_IMAGE`, `CLOSING_IMAGE`, `VINYL_IMAGE`, `SPEAKER_IMAGE`, `CONTROLLER_IMAGE`) | — |

Auth forms (`LoginForm`, `SignUpForm`, `ForgotPasswordForm` in `src/components/auth/`) act as organisms on the auth pages but are **not** in the atomic folders and are shared with legacy modals (`AuthModal` — still used by `src/pages/Profile.tsx` — and `UpdatePasswordModal`).

### 5.4 Templates — `src/components/templates/` — Implemented

| Template | Composition | Notes |
|---|---|---|
| `LandingTemplate` | skip link → `LandingNavbar` → `<main>`: Hero, TempoBand, Privacy, Features → `ClosingSection` (outside `<main>`, contains `<footer>`) | Calls `useDocumentScroll()`. Owns `.sd-landing` page shell CSS. |
| `AuthTemplate` | `.sd-landing.sd-auth` shell → skip link → `LandingNavbar` → `<main>` grid: form panel (title, intro, form slot) + coloured stage (Speaker3D + statement) | Props: `title`, `intro?`, `field: 'sage' \| 'accent'`, `statement`, `onLogIn`, `onSignUp`, `current`, `children`. Imports **both** `LandingTemplate.css` and `AuthTemplate.css`. Moves focus to the title when the title changes. Also exports `AuthUnavailableNotice`. |

### 5.5 Pages — `src/pages/`

| Page | Template | Logic |
|---|---|---|
| `Landing.tsx` | LandingTemplate | Redirects when signed in or Supabase not configured |
| `Login.tsx` | AuthTemplate (`field="sage"`, `current="login"`) | Internal view state `'login' \| 'forgot'`; returns to `state.from` or `/dashboard` |
| `SignUp.tsx` | AuthTemplate (`field="accent"`, `current="signup"`) | Same destination logic |

### 5.6 Design-system support modules — `src/design-system/`

| File | Content |
|---|---|
| `tokens.css` | All `--sd-*` tokens, Kanit `@font-face`, dark overrides, `.sd-visually-hidden` |
| `motion.ts` | `EASE_OUT`, `DURATION`, `MAGNET_SPRING`, `STAGGER` (JS mirror of CSS motion tokens) |
| `documentScroll.ts` | `useDocumentScroll()` (sets `data-scroll-mode="document"` on `<html>`), `prefersFinePointer()` |

---

## 6. Reusable visual components

"Shared" below means used by more than one of the three sections or by more than one organism.

### 6.1 Buttons — `src/components/atoms/Button.tsx` (shared)

| Variant | Background | Text | Hover | Typical use |
|---|---|---|---|---|
| `accent` (default) | `--sd-accent` | `--sd-accent-ink` | `--sd-accent-hover`; child `svg` moves `translateX(3px)` | Primary CTA ("Open console" in hero) |
| `ink` | `--sd-ink` | `--sd-paper` | `--sd-ink-soft` | Sign up (navbar), closing CTA |
| `ghost` | transparent | `--sd-ink` | `--sd-surface` | Log in (navbar), closing secondary |

- Sizes: `md` (`min-height: --sd-control-height`, padding `0 1.25rem`), `lg` (`--sd-control-height-lg`, `0 2rem`).
- States: `:active` → `scale(0.97)`; `:focus-visible` → 3px `--sd-focus` outline, 3px offset; `:disabled` → `opacity: 0.45`, `not-allowed`.
- **On-field context:** any ancestor with `.sd-on-field` (hero band, feature panels, closing, auth stage) switches `ink` to `--sd-field-ink` / `--sd-field-ink-contrast`, `ghost` text to `--sd-field-ink` with `rgb(0 0 0 / 0.08)` hover, and focus outline to `--sd-field-ink`.
- Coarse pointer: `min-height: 3rem`. Reduced motion: transitions 0ms.
- Navbar ≤560px: `.sd-button` padding `0 0.875rem`.

**Legacy `src/components/ui/Button.tsx`** (`primary|secondary|outline|ghost`, `sm|md|lg`, `fullWidth`) is used inside the auth forms. `AuthTemplate.css` restyles it under `.sd-auth__form`: pill radius, Kanit 500; `.btn-primary` → accent pill at `--sd-control-height-lg`; `.btn-outline` → filled ink pill (used for "Back to sign in" after sign-up confirmation); `.btn-ghost` → note-size link button at `--sd-control-height`, row pulled out by `margin-inline: -1rem`; disabled opacity 0.45; active scale 0.97.

### 6.2 Icon button — `src/components/atoms/IconButton.tsx` (shared by ThemeToggle, KeyMatcher)

Circle of `--sd-control-height`; hover `--sd-surface`; active `scale(0.92)`; focus outline as Button; coarse pointer `3rem`. Inside the KeyMatcher dial: acid icon colour, white 12% hover, acid inset outline.

### 6.3 Inputs and forms (Login / Sign Up only)

No v2 input atom exists. Forms use legacy `src/components/ui/Input.tsx` (label, optional icon, `useId` binding) restyled by `AuthTemplate.css`:

- Input: `height: --sd-control-height-lg`, pill, `2px solid --sd-ink-soft` border, `--sd-paper` background, `caret-color: --sd-accent`, padding `0 1.5rem 0 3.25rem`; icon at `left: 1.25rem` in `--sd-ink-soft`.
- Hover/focus: border `--sd-ink`; focus adds 3px `--sd-focus` outline (legacy halo removed with `box-shadow: none`).
- Autofill: inset shadow trick paints `--sd-surface`, text `--sd-ink`.
- Label: note size, weight 500, `--sd-ink`.
- Form gap: `--sd-gap-4`.

### 6.4 Messages, errors and loading

| State | Implementation |
|---|---|
| Error (auth) | `<p role="alert" class="auth-form-message auth-form-message-error">` → acid field, black ink, `--sd-radius-panel`, note size 500, padding `0.875rem 1.5rem` |
| Success (auth) | `role="status"` `.auth-form-message-success` → sage field, same shape |
| Neutral helper text | `.auth-form-message` → body size, light weight |
| Accounts unavailable | `AuthUnavailableNotice` (in `AuthTemplate.tsx`) reuses the error style |
| Submitting | Button label swaps to `t('auth.submitting')` and button is disabled |
| Route loading | `RouteLoading` in `App.tsx`: unstyled `<div role="status">` with `t('states.loading')` — no v2 styling |

There is no v2 spinner, skeleton, toast or modal. Modals (`src/components/ui/Modal.tsx`) are legacy and not used by these three pages.

### 6.5 Cards / panels

- `FeaturePanel` (Home only): tones `accent | sage | acid | paper`; `decoration` (top-right, breaks the corner by `top: clamp(-4rem, -4vw, -2rem)`, `right: clamp(-2.5rem, -2.5vw, -1rem)`), `decorationSize: 'square' | 'wide'`, `children` (interactive zone), `delay`.
- Tempo tiles (Home only, inside `TempoBand`): tones cycle `accent → sage → acid → inverse`.
- Auth stage (`.sd-auth__stage--sage | --accent`): same field language, different component.

### 6.6 Navigation — `LandingNavbar` (shared Home + Login + Sign Up)

Height `--sd-nav-height` (4.75rem); `space-between`; actions gap `--sd-gap-1`. Brand link hover `opacity: 0.75`. ≤560px hides the brand name visually (kept for screen readers). ≤440px allows wrapping. Enters with `FadeIn` `y=-20`, `duration=0.5`.

### 6.7 Segmented controls

- `LanguageSwitch`: track `--sd-surface`, 3px padding; options note 500 in `--sd-ink-soft`; pressed option `--sd-ink` background with `--sd-paper` text.
- KeyMatcher mode toggle: same pattern hand-written in `KeyMatcher.css` with field colours (pressed: black background, acid text). **Not** built on `LanguageSwitch`.

### 6.8 Brand

`Wordmark`: SVG disc (outer `currentColor`, middle `var(--sd-accent)`, centre `currentColor`) + name in Kanit 900. Closing footer overrides the middle circle to `--sd-field-acid` because the band itself is accent.

### 6.9 3D / visual components

- `FloatingImage` (Home): decorative, `alt=""`, `aria-hidden`, lazy-loaded.
- Hero headphones: inline `motion.div` + `<picture>` inside `Magnet` in `HeroSection.tsx` (not a reusable component), `fetchPriority="high"`.
- `Speaker3D` (Login/Sign Up): see §9.4 and §11.

### 6.10 Theme components

`ThemeToggle` (molecule) — see §7.

### 6.11 Utilities

- `.sd-visually-hidden` (global, `tokens.css`).
- `.sd-landing__skip` skip link (page shell, `LandingTemplate.css`), visible on `:focus-visible` as an ink pill with accent outline.
- `.sd-on-field` marker class (no styles of its own; consumed by `Button.css`).

---

## 7. Light and dark themes

| Aspect | Implementation |
|---|---|
| Mechanism | `data-theme="light" \| "dark"` on `<html>`, written by `applyAppearanceToRoot()` in `src/services/settings/appearance.ts`, triggered by `initSettingsEffects()` (`src/services/settings/settingsEffects.ts`, called in `src/main.tsx`) on load and on every settings change. |
| Selection UI | `ThemeToggle` in `LandingNavbar` → `updateSettings({ theme })`. The console Settings page writes the same store. |
| Persistence | **Yes.** `src/store/useSettingsStore.ts` persists all settings to `localStorage` under key `systemdj.settings`, sanitised on load. |
| Default | `theme: 'light'` (`DEFAULT_SETTINGS`). **`prefers-color-scheme` is not read** anywhere in these sections. |
| Tokens that change in dark | `--sd-paper`, `--sd-surface`, `--sd-ink`, `--sd-ink-soft`, `--sd-inverse`, `--sd-inverse-ink` (same value), `--sd-inverse-ink-soft`, `--sd-focus` (→ acid). |
| Tokens that do **not** change | All `--sd-accent*`, all `--sd-field-*`, `--sd-selection`. Fields intentionally keep their colour and black ink in both themes (comment in `tokens.css`). |
| Components that respond | Everything using `--sd-paper/surface/ink/ink-soft/inverse/focus`: page shell, navbar, buttons (non-field), icon buttons, language switch, hero title, wordmark, features panel, auth panel and inputs. `.sd-landing` transitions `background-color`/`color` over `--sd-duration-base`. |
| 3D | `Speaker3D` receives `settings.theme` and changes renderer exposure (`light: 1.05`, `dark: 0.92`). |
| Fixed colours | Field overlays (`rgb(0 0 0 / …)`), `::selection` text `#000000`, speaker materials/lights — all on fixed-colour surfaces. The PNG/WebP renders are the same in both themes. |
| Other appearance settings | `accentColor` (sets `--hue-primary`, `--color-accent`) and `density` (`data-density`) affect **legacy** tokens only. They do not change Home. In auth forms `--color-primary-*` is re-mapped to the v2 accent, so the accent setting has no visible effect there; density can still change the leaked `--space-*` gaps (§4.1). |

**Potential issue (from code, not visually verified):** in dark theme `.sd-on-field .sd-button--ink:hover` sets `background-color: var(--sd-ink-soft)` (`#b4b4b4` in dark) while the text stays `--sd-field-ink-contrast` (`#f4f4f4`), roughly 1.9:1 contrast. This affects the ink CTA in `ClosingSection` on hover.

---

## 8. Internationalization

| Aspect | Implementation |
|---|---|
| Library | `i18next` + `react-i18next` (`src/i18n/config.ts`) |
| Files | `src/i18n/locales/es/translation.json`, `src/i18n/locales/en/translation.json` |
| Namespaces | Single default namespace `translation`; organisation is by top-level key |
| Default / fallback | `lng: 'es'`, `fallbackLng: 'en'`; `escapeValue: false` |
| Runtime language | `settings.language` (`'es' \| 'en'`, default `'es'`), persisted with the other settings; `settingsEffects.ts` calls `i18n.changeLanguage()` and sets `document.documentElement.lang`. `index.html` starts with `lang="en"` until effects run. |
| Access | `const { t } = useTranslation();` in organisms/templates/pages. Atoms and most molecules receive already-translated strings as props (`Wordmark name`, `IconButton label`, `LanguageSwitch options/label`, `ThemeToggle labelToDark/labelToLight`, `PrivacyStatement title/body`). `KeyMatcher` and `TempoBand` call `t` directly. |
| Arrays | `t('landing.band.items', { returnObjects: true })` returns `{ value, label }[]` |
| Interpolation | `{{year}}`, `{{key}}`, `{{list}}`, `{{email}}`, `{{count}}` |

Key structure used by these sections (snake_case leaves, nested by section):

```
landing.brand, landing.skip_to_content
landing.nav.{label, home, language, language_es, language_en, theme_to_dark, theme_to_light, log_in, sign_up}
landing.hero.{title, subtitle, description, cta, image_alt}
landing.band.items[] {value, label}
landing.privacy.{title, body}
landing.features.{title, analysis_*, sync_*, ai_*, export_*}
landing.features.key_matcher.{label, previous, next, mode, minor, major, result, summary, note}
landing.closing.{title, secondary, copyright}
auth.{login_title, signup_title, forgot_title, email, password, ...}
auth.errors.{generic, invalid_credentials, ...}
auth.page.{login_intro, signup_intro, login_statement, signup_statement}   ← added for the auth pages (uncommitted)
states.loading
```

Hardcoded visible text found in these sections:

- `'ES'` / `'EN'` short codes in `LandingNavbar.tsx` (the accessible names are translated).
- Musical key names from `camelotToKey()` in `KeyMatcher` (notation, not translated).
- Tempo readout values (`124 BPM`, `8A`, `SYNC`…) are in the translation files, not hardcoded.
- `AuthUnavailableNotice` concatenates `"."` between two translated strings.

---

## 9. Animations and transitions

### 9.1 Libraries and tokens

- **framer-motion** (`^12.43.0`) for entrances, scroll-linked motion, springs and swaps.
- **CSS transitions** for hover/active/focus.
- **three.js** (`^0.186.1`) for the auth speaker loop.

| CSS token (`tokens.css`) | Value | JS mirror (`motion.ts`) |
|---|---|---|
| `--sd-ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | `EASE_OUT = [0.16, 1, 0.3, 1]` |
| `--sd-duration-fast` | `140ms` | `DURATION.fast = 0.14` |
| `--sd-duration-base` | `240ms` | `DURATION.base = 0.24` |
| `--sd-duration-slow` | `700ms` | `DURATION.entrance = 0.7` |
| — | — | `DURATION.focal = 1.1` (no CSS token; `Speaker3D.css` hardcodes `1.1s`) |
| — | — | `STAGGER = 0.08`, `MAGNET_SPRING = { stiffness: 160, damping: 18, mass: 0.5 }` |

The CSS and JS values are kept in sync manually; nothing enforces it.

### 9.2 Hover / focus / active (CSS)

- Colour changes: `--sd-duration-fast` + `--sd-ease-out` (Button, IconButton, LanguageSwitch, KeyMatcher mode, auth inputs/buttons, navbar brand opacity).
- Press: `scale(0.97)` (buttons) / `scale(0.92)` (icon buttons) over `--sd-duration-base`.
- Accent button arrow nudges `translateX(3px)` on hover.
- Focus: outline only (no animation).

### 9.3 Entrances and scroll-linked motion (Home)

| Effect | Component | Parameters |
|---|---|---|
| Viewport fade-up, once | `FadeIn` | default `y=24`, `duration=0.7`, `amount=0.3`; call sites use `y` 20/32/40, navbar `y=-20` `duration=0.5`; hero delays `0.15 / 0.3 / 0.38 / 0.46`; auth delays `0.08 / 0.16`; feature panels `STAGGER × n` |
| Shutter reveal (signature) | HeroSection | `clipPath inset(100% 0 0 0) → inset(0)`, `scale 1.12 → 1`, `DURATION.focal`, delay `0.5` |
| Magnetic follow | `Magnet` | hero: `padding=160`, `strength=7`; fine pointer only |
| Parallax drift + entrance scale | `FloatingImage` | `drift` 50–90px, `tilt` −12°…10°, entrance `scale 0.85 → 1` over `0.9s` |
| Opposing scroll rows | `TempoBand` | `TRAVEL = [-640, -160]` px, rows repeated ×3 |
| Per-character reveal | `ScrollRevealText` | opacity `0.2 → 1`, window 8 chars, offset `['start 0.85', 'end 0.5']` |
| Value swap | `KeyMatcher` | `AnimatePresence popLayout`, `y ±14`, `DURATION.base` |
| Icon swap | `ThemeToggle` | `rotate ±60°` + opacity, `DURATION.base` |
| Theme colour change | `.sd-landing` | background/color over `--sd-duration-base` |

### 9.4 3D animation (Login / Sign Up)

`Speaker3D` + `speakerScene.ts` + `speakerPulse.ts`:

- Loads three.js and `/assets/models/dj-speaker.glb` only when the container enters the viewport (`IntersectionObserver`, dynamic `import()`).
- Cone motion is a vertex-shader displacement driven by a synthetic kick envelope at **124 BPM**, 16-beat loop (`SPEAKER_BPM`, `SPEAKER_LOOP_BEATS`); second box hits on the off-beat at 45% gain; slow sway of ±2.5°; key light intensity pulses 5%.
- Pauses off-screen and when the tab is hidden.
- Canvas fades in (`opacity` over `--sd-duration-slow`, `translateY(1.5rem) scale(0.96) → none` over `1.1s`) once ready.
- Falls back to `SPEAKER_IMAGE` (static PNG/WebP) if WebGL or the model fails.
- Covered by `tests/speakerPulse.test.ts`.

### 9.5 `prefers-reduced-motion`

| Component | Behaviour |
|---|---|
| FadeIn, FloatingImage, KeyMatcher, ThemeToggle | Keep opacity, drop translation/rotation/scale |
| Hero shutter | Opacity-only fade over `DURATION.base` |
| Magnet | Disabled |
| TempoBand | Rows fixed at the start position |
| ScrollRevealText | Renders plain text |
| Speaker3D | Renders a single static frame; CSS entrance becomes a linear opacity fade |
| `.sd-button`, auth `.btn` / `.input-field` | Transition duration 0ms |

### 9.6 Gaps

- `IconButton.css`, `LanguageSwitch.css`, `KeyMatcher.css` and `.sd-landing` transitions have **no** `prefers-reduced-motion` rule (mostly colour transitions; IconButton includes a `scale(0.92)` press).
- Many delays and durations are literals at call sites rather than tokens.

---

## 10. Responsive design

**There are no centralized breakpoints.** Each stylesheet declares its own `@media (max-width: …)`. No breakpoint tokens exist (custom properties cannot be used in media queries anyway).

| Breakpoint | Files | Changes |
|---|---|---|
| `max-width: 1024px` | `HeroSection.css`, `ClosingSection.css` (also legacy shell in `index.css`) | Hero CTA moves under the copy; hero image anchors right; closing grid becomes `1fr 34%` |
| `max-width: 900px` | `AuthTemplate.css` | Auth grid becomes one column; stage becomes a bottom band with rounded top corners; speaker shifts right |
| `max-width: 640px` | `HeroSection.css`, `FeaturePanel.css`, `FeaturesSection.css`, `ClosingSection.css`, `AuthTemplate.css` | Stacked layouts; feature grid single column; decorations smaller; **speaker hidden** (`display: none`) |
| `max-width: 560px` | `LandingNavbar.css` | Brand name visually hidden; tighter action padding |
| `max-width: 440px` | `LandingNavbar.css` | Navbar wraps |
| `pointer: coarse` | Button, IconButton, KeyMatcher, AuthTemplate (+ legacy `index.css`) | Larger hit targets (3rem / 2.75rem) |
| `prefers-reduced-motion: reduce` | Button, Speaker3D, AuthTemplate | See §9.5 |

Other responsive techniques:

- **Fluid sizing:** `clamp()` with `vw`, `svh`, `vh` for type, spacing and heights.
- **Container queries units:** `cqi` with `container-type: inline-size` on `.sd-hero__title-wrap` (poster title) and `.sd-auth__content` (auth title). No `@container` rules.
- **Measures:** `ch` for text widths.
- **Viewport units:** `svh` for full-height regions.

Desktop vs tablet:

- **Home:** above 1024px the hero band is a two-column grid with the CTA at right and headphones at `left: 42%` crossing the seam; at ≤1024px the CTA drops below and the headphones anchor to the right margin. Features stay 2×2 until 640px.
- **Login/Sign Up:** above 900px form and stage side by side (`1fr / 1.08fr`), stage rounded top-left only; at ≤900px the stage becomes a band below the form with both top corners rounded.

`docs/DESIGN.md` describes 640px as "out of the supported range but kept intact". The code still contains layouts for 640/560/440px.

---

## 11. Visual effects and assets

### 11.1 CSS / JS effects

| Effect | Present? | Where |
|---|---|---|
| Gradients | No | — |
| Shadows | No resting shadows. Two technical `box-shadow` uses in `AuthTemplate.css`: `none` (removes legacy focus halo) and a `-webkit-box-shadow` inset fill for autofill | AuthTemplate.css |
| Blur / backdrop-filter | No | — |
| Transparency | Black/white alpha overlays on fields (§2.2); opacity for disabled (0.45), brand hover (0.75), scroll-reveal (0.2→1) | Button, KeyMatcher, LandingNavbar, ScrollRevealText |
| Glowing borders | No | — |
| Textures / background images | No | — |
| Clip-path | Hero shutter reveal | HeroSection.tsx |
| Rotation | Hero headphones `rotate(12deg)`; FloatingImage `tilt`; speaker fallback `rotate(-8deg)` | HeroSection.css, FeaturesSection/ClosingSection props, Speaker3D.css |
| Tone mapping / environment light | ACES filmic, `RoomEnvironment`, two directional lights | speakerScene.ts |

### 11.2 Raster assets (public)

Referenced through `src/components/organisms/landingAssets.ts` (PNG = fallback/reference, WebP = resized first choice). The file notes that file names do not describe the content.

| Constant | PNG / WebP | Size | Actual object | Used in |
|---|---|---|---|---|
| `HERO_IMAGE` | `/assets/images/hero-dj-alt-3d.{png,webp}` | 1280×1280 | White DJ headphones | Hero |
| `CLOSING_IMAGE` | `/assets/images/hero-dj-salt-3d.{png,webp}` | 800×1000 | — (not described in code) | Closing |
| `VINYL_IMAGE` | `/assets/images/knob-3d.{png,webp}` | 640×640 | Vinyl | Analysis panel |
| `SPEAKER_IMAGE` | `/assets/images/soundwave-3d.{png,webp}` | 640×640 | Speaker | Export panel; Speaker3D fallback |
| `CONTROLLER_IMAGE` | `/assets/images/mixer-console-3d.{png,webp}` | 960×540 | DJ controller | Sync panel |

Each WebP has a sibling `*.webp.json` provenance record (e.g. *"pre-existing project asset … Derived WebP resized with ImageMagick … no generative edit"*).

Unreferenced by these sections: `public/assets/images/hero-dj-3d.{png,webp}`, `public/assets/images/log-in-up.png`, `src/assets/hero.png`.

### 11.3 3D model

- `/assets/models/dj-speaker.glb` (`public/assets/models/dj-speaker.glb`, ~178 KB), constant `SPEAKER_MODEL_URL` in `speakerScene.ts`. A mesh named `Plane` (studio backdrop) is hidden at runtime. All original materials are replaced by a custom `MeshStandardMaterial`.

### 11.4 Fonts

`public/assets/fonts/kanit-{300,400,500,900}.woff2` (§3.1).

### 11.5 Musical-identity effects

- Tempo band: readouts styled like console displays (BPM, Camelot, SYNC, BAR SYNC, HOT CUES, WAV/MP3), two rows moving in opposite directions "like two decks" (component comment).
- KeyMatcher: real Camelot compatibility from `src/audio/analysis/camelotMapper.ts`.
- Wordmark: a platter seen from above.
- Speaker3D: cone pumping to a 124 BPM kick envelope.

---

## 12. Centralization and design debt

### 12.1 Centralized

- **Colour tokens** (`--sd-*` in `tokens.css`) — all v2 surfaces, inks, fields, focus and selection; light/dark.
- **Type tokens** — family, 4 weights, 5 sizes, 3 leadings, 1 tracking.
- **Radius tokens** — panel and pill.
- **Control heights and focus ring tokens.**
- **Motion tokens** — CSS (`--sd-ease-out`, `--sd-duration-*`) and JS (`motion.ts`).
- **Image registry** — `landingAssets.ts`.
- **Shared components** — `Button`, `IconButton`, `FadeIn`, `Wordmark`, `LandingNavbar`, page shell `.sd-landing` (shared by both templates).
- **Theme and language state** — `settingsStore` + `settingsEffects` (shared with the console).

### 12.2 Partially centralized

- **Spacing:** `--sd-margin`, `--sd-gap-1…6`, `--sd-section-gap` exist, but paddings and many gaps are local `clamp()`/rem values (§4.2).
- **Typography:** the five sizes are tokens, but secondary line-heights (`1.12`, `1`, `1.4`) and letter-spacings (`-0.01em`, `-0.02em`) are repeated literals. The auth title uses its own size formula.
- **Motion:** durations are tokens, but delays, travel distances, `y` offsets, `0.5s` navbar duration and `1.1s` in `Speaker3D.css` are literals. CSS and JS mirrors are synced by hand.
- **`--sd-nav-height`** is a page-shell local token on `.sd-landing`, not a global one.
- **Auth forms:** v2 look is applied by **overriding legacy classes** (`.btn`, `.input-field`, `.auth-form-*`) from `AuthTemplate.css`, plus re-mapping legacy tokens. This works but couples the auth pages to the internal class names of `ui/Button`, `ui/Input` and `AuthForm.css`. A change to those legacy files can break Login/Sign Up.

### 12.3 Not centralized (duplicated patterns)

| Pattern | Occurrences |
|---|---|
| Display heading block (`font-family: var(--sd-font)`, `--sd-text-section`, 900, display leading/tracking, uppercase, balance) | `.sd-features__title`, `.sd-closing__title`, `.sd-privacy__title`, `.sd-auth__title`, `.sd-tempo-band__value` (partially) — no shared class |
| Statement sentence (`--sd-text-statement`, 500, `line-height: 1.12`, `-0.01em`, balance) | `.sd-hero__subtitle`, `.sd-auth__statement` |
| Body paragraph (`--sd-text-body`, 300, `--sd-leading-body`) | hero description, feature description, auth intro, auth messages |
| Segmented control | `LanguageSwitch.css` vs `.sd-key-matcher__mode` (separate implementations) |
| Field background classes (`--accent`, `--sage`, `--acid`…) | `FeaturePanel.css`, `TempoBand.css`, `AuthTemplate.css` each declare their own modifiers |
| Field padding `clamp(1.75rem, 3vw, 2.75rem)` | `.sd-hero__band` (top) and `.sd-auth__stage` |
| Rounded-top panel (`border-radius: panel panel 0 0`) | hero band, features, closing, auth stage ≤900px |
| Visually-hidden pattern | `.sd-visually-hidden` (global) re-implemented in `.sd-landing__skip` and the navbar ≤560px rule |
| Coarse-pointer target sizes | `3rem` / `2.75rem` literals in four files |
| Breakpoints | `1024 / 900 / 640 / 560 / 440` literals across seven files |
| `z-index` | Local literals (1–5, 20) |

### 12.4 Not verified

- Whether the legacy `.input-field:disabled { background-color: var(--bg-base) }` wins over `.sd-auth__form .input-field` (depends on stylesheet order).
- The real visual contrast of the dark-theme ink-on-field hover (§7) — computed from token values only.
- Kanit subset/licence (only stated in `docs/DESIGN.md`).
- Actual rendering of Login/Sign Up at each breakpoint — not opened in a browser for this document.
- Content of `CLOSING_IMAGE` (`hero-dj-salt-3d`) — not described in code.

### 12.5 Known differences with other design documents

| Document | Statement | Code reality |
|---|---|---|
| `docs/DESIGN.md` | Breakpoints 1024px and 640px | Also 900px (auth), 560px and 440px (navbar) |
| `docs/DESIGN.md` | `note` line-height 1.4 | No token; `1.4` only appears in auth notices; elsewhere notes inherit body line-height |
| `docs/DESIGN.md` | Does not cover Login/Sign Up, `Speaker3D`, `--sd-gap-6` use, or the legacy-form re-mapping | Documented here |
| `.impeccable/surfaces/src-pages-landing-tsx.md` | "Log in / Sign up open the existing AuthModal" | Outdated: they now navigate to `/login` and `/signup` (uncommitted change in `Landing.tsx`) |

### 12.6 Risks for future pages (priority order)

1. **Legacy CSS leakage:** global `body`, `h1–h6`, `button`, `#root` rules and the Inter/Outfit import in `src/index.css` apply to every page. A new v2 page must use the `.sd-landing` shell (or replicate its overrides) and, if it scrolls, call `useDocumentScroll()`.
2. **Two `Button` components** with the same name (`atoms/Button` vs `ui/Button`) and different APIs. Importing the wrong one silently brings the legacy look.
3. **No v2 input/form atoms;** any new form outside `.sd-auth__form` will render with legacy styles.
4. **Scattered breakpoints** make it easy to introduce a sixth value.
5. **Dark-theme hover contrast** on field ink buttons (§7).

---

## 13. Rules for future implementations

### 13.1 Rules derived from existing conventions

1. **Use `--sd-*` tokens from `src/design-system/tokens.css` for every colour, size, radius, weight, duration and easing.** Do not use legacy tokens (`--color-*`, `--bg-*`, `--text-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--font-family-*`) in v2 code.
2. **Never add a hex value in a component** when an `--sd-*` token exists. Alpha overlays on fixed fields (`rgb(0 0 0 / 0.08)`) are the only existing exception.
3. **Kanit only.** Hierarchy comes from the five size tokens and four weights. Display headings: 900, uppercase, `--sd-leading-display`, `--sd-tracking-display`, `text-wrap: balance`.
4. **Fields, not decoration.** A region gets one flat field (`paper`, `accent`, `field-sage`, `field-acid`, `field-paper`, `inverse`). Text on accent/sage/acid/paper fields is `--sd-field-ink`; on inverse it is `--sd-inverse-ink`. Add `.sd-on-field` to the field container so `Button` switches inks.
5. **No gradients, shadows at rest, blur, glass, glows or hairline borders.** Separate surfaces by colour change.
6. **Pills for controls (`--sd-radius-pill`), `--sd-radius-panel` for panels.** Panels that stack use rounded tops only.
7. **Use `atoms/Button`** (`accent` = the one primary action, `ink` = secondary filled, `ghost` = tertiary). When a whole region is accent, its action uses `ink`.
8. **Use `atoms/IconButton`** for icon-only actions, always with a translated `label`.
9. **Outer margins are `--sd-margin`; section rhythm is `--sd-section-gap`; inner gaps use `--sd-gap-1…6`.**
10. **New pages in this system** reuse the `.sd-landing` shell (via `LandingTemplate`/`AuthTemplate` or the same classes), include the skip link and `LandingNavbar`, and call `useDocumentScroll()` if the page scrolls.
11. **Follow the folder structure actually used:** atoms → molecules → organisms → templates → `src/pages`. Atoms receive translated strings as props; organisms/templates call `useTranslation()`. One `.css` file per component, BEM-like `sd-<block>__<element>--<modifier>` class names.
12. **Motion:** use `FadeIn` for entrances, `EASE_OUT`/`DURATION`/`STAGGER` from `motion.ts` in JS and `--sd-ease-out`/`--sd-duration-*` in CSS. No bounce. Every movement needs a `useReducedMotion()` path that keeps content visible.
13. **Decorative imagery** goes through `landingAssets.ts` (PNG + WebP + dimensions), is rendered with `alt=""`/`aria-hidden`, and never captures the pointer. Heavy 3D is lazy-loaded and must have a static fallback.
14. **Themes:** only `--sd-paper`, `--sd-surface`, `--sd-ink`, `--sd-ink-soft`, `--sd-inverse*`, `--sd-focus` change. If a new token must differ in dark, add it to both `:root` and `[data-theme='dark']` in `tokens.css`. Theme and language changes go through `useSettingsStore().updateSettings()`.
15. **i18n:** every visible string goes into **both** `es` and `en` `translation.json` under the section's key (`landing.*`, `auth.*`, `auth.page.*`), snake_case leaves.
16. **Accessibility conventions in use:** `aria-labelledby` on sections, `aria-pressed` for toggles, `aria-current="page"` for the active auth link, `role="alert"`/`role="status"` for messages, focus outlines `--sd-focus-width`/`--sd-focus-offset`, coarse-pointer targets ≥ 2.75–3rem.

### 13.2 Recommendations not yet adopted (do not assume they exist)

- Shared heading/statement/body utility classes or components to remove the duplication in §12.3.
- A v2 `Input`/form-field atom, so future forms do not depend on overriding legacy `ui/Input`.
- Breakpoint constants documented in one place (e.g. a comment block in `tokens.css`) and reused.
- Tokens for secondary leadings (`1.12`, `1.4`), small trackings, `z-index` layers and coarse-pointer target size.
- A CSS token for `DURATION.focal` (1.1s).
- `prefers-reduced-motion` rules for `IconButton`, `LanguageSwitch` and `KeyMatcher` press/colour transitions.
- Resolving the dark-theme `.sd-on-field .sd-button--ink:hover` contrast.
- Respecting `prefers-color-scheme` for the initial theme.
- Removing the global Inter/Outfit import from pages that do not need it.

**Document every new global design decision in this file** (token, breakpoint, component variant) and in `tokens.css` comments.

---

## 14. Technical references

| Topic | Files |
|---|---|
| Tokens, fonts, dark overrides, `.sd-visually-hidden` | `src/design-system/tokens.css` |
| Motion constants | `src/design-system/motion.ts` |
| Document scroll mode, fine-pointer check | `src/design-system/documentScroll.ts` |
| Legacy tokens and global reset (imports `tokens.css`) | `src/index.css` |
| Page shell, skip link, selection, `--sd-nav-height` | `src/components/templates/LandingTemplate.css` |
| Home template | `src/components/templates/LandingTemplate.tsx` |
| Auth template and legacy form re-styling | `src/components/templates/AuthTemplate.tsx`, `src/components/templates/AuthTemplate.css` |
| Atoms | `src/components/atoms/{Button,IconButton,FadeIn,FloatingImage,Magnet,ScrollRevealText,Wordmark,Speaker3D}.tsx` (+ `.css`), `speakerScene.ts`, `speakerPulse.ts` |
| Molecules | `src/components/molecules/{FeaturePanel,KeyMatcher,LanguageSwitch,PrivacyStatement,ThemeToggle}.tsx` (+ `.css`) |
| Organisms | `src/components/organisms/{LandingNavbar,HeroSection,TempoBand,PrivacySection,FeaturesSection,ClosingSection}.tsx` (+ `.css`), `landingAssets.ts` |
| Pages | `src/pages/Landing.tsx`, `src/pages/Login.tsx`, `src/pages/SignUp.tsx` |
| Routes | `src/App.tsx` |
| Auth forms (legacy, restyled) | `src/components/auth/{LoginForm,SignUpForm,ForgotPasswordForm}.tsx`, `src/components/auth/AuthForm.css`, `src/components/ui/{Button,Input}.{tsx,css}` |
| Theme / language state and effects | `src/store/useSettingsStore.ts`, `src/services/settings/settingsEffects.ts`, `src/services/settings/appearance.ts` |
| i18n | `src/i18n/config.ts`, `src/i18n/locales/{es,en}/translation.json` |
| Camelot rule used by KeyMatcher | `src/audio/analysis/camelotMapper.ts` |
| Assets | `public/assets/fonts/`, `public/assets/images/`, `public/assets/models/dj-speaker.glb` |
| Tests | `tests/speakerPulse.test.ts` |
| UI dependencies | `package.json`: `framer-motion`, `lucide-react`, `clsx`, `three` (+ `@types/three`, uncommitted), `i18next`, `react-i18next`, `react-router-dom` |
| Earlier design spec / tool metadata | `docs/DESIGN.md`, `.impeccable/design.json`, `.impeccable/surfaces/src-pages-landing-tsx.md`, `.taste-skill/direction.json` |

---

## 15. Console extension (Home, Library, Playlists, Sessions)

Added on 2026-10-24 to carry the poster world into the console. Scope is strictly the four pages plus the shell's navigation chrome.

### 15.1 Isolation rules

- **`ConsoleTemplate`** (`templates/ConsoleTemplate.tsx/.css`) wraps each of the four pages in `.sd-console`: paper ground, Kanit 400, its own scroll container (so the native scrollbar follows `color-scheme`), and `fill` mode for pages whose table scrolls internally (Library, Playlists).
- `.sd-console` re-maps legacy tokens (`--text-*`, `--bg-*`, `--border-*`, `--color-primary-*`) **only inside those pages**, and re-skins the legacy `ui/Modal` + auth form classes used by `YouTubeImportModal`. `index.css`, `components/ui/*`, `Table.css` and `Badge.css` are untouched because Mixer, the decks and PlayerBar still depend on them.
- Shell: `.layout-header` and `.layout-sidebar` (in `DesktopLayout.css`) plus `Sidebar.css` use `--sd-*` tokens. `.layout-main`, `.layout-player`, `PlayerBar` and the notifications dropdown markup are unchanged.

### 15.2 New tokens (`tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--sd-radius-inset` | `1rem` | Rows, notices and tiles nested inside a `--sd-radius-panel` panel |
| `--sd-panel-padding` | `clamp(1.25rem, 2vw, 1.75rem)` | Inner padding of console panels and dialogs |
| `--sd-control-height-sm` | `2.25rem` | Dense controls in tables and contextual bars |
| `--sd-scrim` | `rgb(0 0 0 / 0.5)` | Dialog backdrop (no blur) |
| `--sd-inverse-surface` | `#2b2b2b` / dark `#303030` | Controls on the inverse field |
| `--sd-field-ink-soft` | `#2b2b2b` | Secondary ink on colour fields (AA on orange) |
| `--sd-ghost-hover`, `--sd-field-bg`, `--sd-progress-track` | contextual, with fallbacks | Set by containers whose ground is already `--sd-surface`, so ghost hovers, inputs and tracks step up to paper |

**Field utilities** `.sd-field-sage | -acid | -accent | -inverse` paint a container and re-map `--sd-ink`, `--sd-ink-soft`, `--sd-paper`, `--sd-surface` and `--sd-focus` for its descendants, enforcing the Field Ink Rule in both themes. On `.sd-field-accent` the action must be the ink button (One Accent Rule).

### 15.3 New and extended components

| Level | Component | Notes |
|---|---|---|
| Atom | `Icon` | Wraps a lucide icon with the size scale and stroke; decorative unless `label` is passed |
| Atom | `Button` | New `sm` size |
| Atom | `IconButton` | New `variant` (`ghost` default, `surface`, `ink`) and `size` (`md` default, `sm`); disabled state; reduced-motion rule. Existing call sites render identically |
| Atom | `TextField`, `SelectField` | v2 pill inputs (native `<select>` kept), `sm`/`md` |
| Atom | `Tag` | Data/status pill: `surface`, `paper`, `sage` (ready), `acid` (needs attention), `accent`, `ink` (active) |
| Atom | `ProgressBar` | Ink on surface; indeterminate becomes static under reduced motion |
| Molecule | `SegmentedControl` | Generic version of the `LanguageSwitch` pattern (`aria-pressed`) |
| Molecule | `Panel` | Console block: tone, Kanit 900 uppercase title at body size, description, aside |
| Molecule | `PageHeader` | Statement-size Kanit 900 title, body description, actions |
| Molecule | `Notice` | Inline message: success → sage, error → acid, warning/info → surface |
| Molecule | `EmptyState` | Icon, title, description, action; `loading` variant |
| Template | `ConsoleTemplate` | See §15.1 |

Shared console table styles (`.sd-table`) live in `ConsoleTemplate.css`: no rules or header band, rows separated by spacing, hover on surface, selected row on sage, right-aligned tabular numbers.

### 15.4 Iconography conventions (`design-system/icons.ts`)

- One library: **lucide-react**, outline, stroke `2` (the default already used by Home/Login/Sign Up). No emoji or Unicode glyphs as icons.
- Sizes: `xs` 14 (inside tags), `sm` 16 (compact buttons, rows), `md` 20 (navigation, default buttons), `lg` 24 (empty states).
- Colour inherits `currentColor`; icons sit `--sd-gap-1` from their label inside buttons and titles.
- Decorative icons are `aria-hidden`; icon-only controls use `IconButton` with a translated `label`.
- Adoption is gradual: the four pages, Header and Sidebar use `Icon`; other screens keep their direct lucide imports.

### 15.5 Known exceptions

- Library row tags use `min-height: 1.375rem` and the console table cells use `0.625rem` horizontal padding to fit six row actions at 1440px; below that width the table scrolls horizontally with the actions column sticky.
- The unread counter on the bell uses the note size in a 1.375rem pill.
- `Badge.css` still documents "Shared analysis status badges used by Library and Deck"; Library now renders its own `.sd-status` pill and only Deck uses those classes.

---

## 16. Settings, Profile and notifications

Added on 2026-10-24. Same poster world as §15, with one composition per screen.

### 16.1 Screens

| Screen | Composition | Notes |
|---|---|---|
| Settings (`/settings?section=…`) | Category rail (`role="tablist"`, vertical; arrows/Home/End) + one view per category: Kanit 900 section-size title, one-line purpose, **readout strip** of the current values, then `Panel`s of `SettingRow`s | The `section` search param keeps the category on reload and makes it linkable. ≤1024px the rail becomes wrapping rows above the view. An «Aplicado» sage tag appears for 2.4s after any `settingsStore` change (the store applies in memory synchronously; a blocked `localStorage` write is not detectable, so the stamp says *applied*, not *saved*). |
| Profile (`/profile`) | `ProfilePanel`: accent field band with `AvatarDisc` + stage name at section size, handle, email, member since (`profiles.created_at`), sign out · `ProfileForm` panel · «En este dispositivo» panel with real IndexedDB counts (tracks, hours, playlists, recorded sessions) linking to their screens | Without an account (local mode, or signed out) the band states it and offers sign-in only when Supabase is configured. The former mock achievements/history (`src/mock/profile.ts`) are no longer rendered. |
| Notifications (`NotificationsPopover`, organism, used by `Header`) | Paper panel framed by a 2px ink border (the only floating surface; no shadow). Rows: category icon (derived from the message key prefix), message, category · relative time; warnings carry an acid `Tag`, errors take the whole row as an acid field with an ink `Error` tag | Opening marks everything read (unchanged `notificationCenter` contract); rows that were unread when opened, or arrive while it is open, keep an accent dot and medium weight until it closes. Animations are CSS so the shell chunk does not load framer-motion. |

### 16.2 New components

| Level | Component | Notes |
|---|---|---|
| Atom | `Switch` | Native checkbox with `role="switch"`; ink track when on, thumb stretches on press |
| Atom | `Fader` | Native `range` over a flat track with ink fill; pill fader cap; optional tick labels (`is-current` on the selected one) |
| Molecule | `ChoiceTiles` | Native radio group with a preview per option (`tile` or `swatch`); ink ring + check badge on the selected one |
| Molecule | `SettingRow` | Title + description left, control right (or `stacked`), optional preview row; stacks under a 40rem container |
| Molecule | `AvatarDisc` | Avatar as the label of a black vinyl (SVG grooves, acid position marker). Quarter-turn spin-up on mount; spins at 33⅓ rpm while an upload runs |
| Organism | `profile/ProfileForm` | Username / DJ alias / real name form shared by Profile and Settings → General (unsaved-changes line, Discard, inline username hint that becomes the error) |
| Hook | `hooks/useAvatarUpload` | File picker, validation and upload shared by both screens |
| Settings | `settings/SettingsPreviews` | `CrossfaderCurvePreview` (plots `calculateCrossfaderGains` — the engine's own law — and morphs between curves), `BeatLengthPreview` (8 bars × 4 beats sequencer grid), `StorageMeter` (32-segment VU-style meter at the true usage/quota ratio; top segments turn accent) |

`Panel` accepts `headingLevel="h4"` (Settings: page h2 → view h3 → panel h4).

### 16.3 Tokens and exceptions

- `tokens.css` adds a `[data-theme='light']` scope so a nested element can render light tokens inside the dark theme (the theme preview tiles use `data-theme` on a `<span>`).
- Miniature radii outside the panel/inset/pill scale, all on sub-2rem elements: theme preview inner panel `8px`, keycaps `0.5rem`, beat cells and meter segments `0.25rem`. The popover uses `1.5rem` (inset `1rem` + its `0.5rem` list padding, concentric).
- Fixed `3.5rem` Kanit 900 for the deck letters (Shortcuts) and the language codes inside fixed-size tiles, where the fluid section step would overflow.
- Accent swatches render the real `--sd-accent` through a `data-accent` scope (§17.1). Density now also drives the v2 console tokens (§18.1).

---

## 17. Accent palette, motion preference, selection and the sidebar panel

Added on 2026-10-24.

### 17.1 Accent palette (Settings → Appearance)

- `--sd-accent` / `--sd-accent-hover` now come from `data-accent` on `<html>` (written by `applyAppearanceToRoot`). Values live in `tokens.css` under `[data-accent='…']`; the same attribute on any element scopes that accent locally (the swatches in Settings use it, like the `data-theme` preview tiles).
- Palette (same value in both themes, like the fields; every accent keeps black ink at ≥ 5.4:1): `orange` `#fe7141` (default, = `--sd-brand-accent`), `blue` `#5b8cff`, `cyan` `#1fc8e3`, `violet` `#a681ff`, `magenta` `#ff5cc8`, `neon` (shown as *Green*) `#2fd67a`, `amber` `#ffb21e`.
- **Brand pages keep the orange:** `.sd-landing` (Home, Login, Sign Up) resets `--sd-accent*` to `--sd-brand-accent*`. The chosen accent applies to the console shell and screens.
- Legacy Mixer/decks/PlayerBar still read `--hue-primary` (`ACCENT_HUES`, an approximate hue per accent).
- Persistence: `settingsStore` now writes `settingsVersion: 2`. A stored `violet` without a version (the old legacy default, never visible in v2) migrates to `orange`; any other stored accent is kept.
- New token `--sd-indicator` (= accent; field ink inside `.sd-field-sage|acid|accent`): the "lit" part of a control — `Switch` thumb when on, `Fader` and `ProgressBar` fill, Library energy bar, the sidebar's active LED. Buttons keep their variants; selected rows stay sage.

### 17.2 Motion preference

- `settings.animations` (default on) → `data-animations="on|off"` on `<html>`. JS: `useAnimationsEnabled()` in `design-system/motionPreference.ts` (preference **and** not `prefers-reduced-motion`); CSS: `:root[data-animations='off'] …` plus the reduced-motion media query.
- Governed today: the sidebar light (§17.4), the player-bar visualizer (§18.3) and the selection bar's entrance. New optional animations must check the same hook/attribute and be listed in `ANIMATED_SURFACES` (Settings) with an `settings.animations_list.*` label.
- `settings.experimentalInterface` (default off) → `data-interface="standard|experimental"`. Only the flag exists; turning it on persists, verifies the stored value (`settingsStore.readPersisted()`) and reloads once. No alternative layout is implemented.

### 17.3 New components

| Level | Component | Notes |
|---|---|---|
| Molecule | `SelectMenu` | Replaces native `<select>` where the OS list broke the identity (Library playlist target and Camelot edit, Playlists add-track). Trigger reuses `SelectField` classes; the list is a portal panel framed by a 2px ink border (same family as the notifications popover, radius `1.25rem`), flips above near the bottom edge, clamps to the viewport, optional search (≥ 9 options), two-line options with ellipsis, combobox/listbox ARIA with arrows, Home/End, PageUp/Down, typeahead, Escape/Tab. Sessions and the legacy Deck keep native selects. |
| Molecule | `ConfirmDialog` | Destructive confirmation (`alertdialog`, portal, Cancel focused, Escape cancels, focus trap and restore). Styles moved from `Library.css`. |
| Organism | `LibrarySelectionBar` | Inverse-field contextual bar: count, select all (scope stated when filtered), deselect, add to playlist, reanalyze, delete. |
| Organism | `AnalysisQueuePanel` | Surface strip with real progress while `bulkAnalysisQueue` runs; sage (all good) or acid (errors) summary with readouts and per-track error rows when it finishes. |

Selection rules: a row checkbox is a real `role="checkbox"` button; the header one is tri-state (`mixed`). Selection is limited to visible rows (changing filter/search drops hidden ones); Shift+click selects a range. ARIA form-control roles (`checkbox`, `switch`, `radio`, `combobox`, `listbox`, `option`) are now exempt from the global keyboard shortcuts, like native inputs.

### 17.4 Sidebar panel (exception to §13.1 rule 5)

The console sidebar is a raised hardware panel: `--sd-surface` ground, `--sd-radius-panel`, a 1px inset edge (`ink` 10%), one short offset shadow, and a speaker-grille dot texture (`radial-gradient` dots, `ink` 11%, 7px pitch). This is the only console surface with a resting shadow and texture, requested explicitly for the shell. Hover on items steps up to paper; the active item stays the ink pill with an `--sd-indicator` LED.

Cursor light (governed by §17.2): pointer movement writes `--sd-light-x/y` (registered `@property`, 140ms transition) once per animation frame — no React state. Under the cursor the grille dots turn accent with a 9% accent wash, and a 1.5px masked edge lights up near the pointer. Hidden for touch pointers, `(hover: none)`, reduced motion and `data-animations='off'`; the static panel is unchanged in those cases.

---

## 18. Density, player bar, queue, navigation shortcuts and Library filters

Added on 2026-10-24. Checked with TypeScript, ESLint, the test suite (`tests/PlayerShellFeatures.test.ts`) and the production build. **Not rendered in a browser for this update**: layout at each width, both themes and both languages still need a manual look.

### 18.1 Interface density

- `data-density="compact"` on `<html>` (unchanged mechanism). The v2 override is `[data-density='compact'] .desktop-layout { … }` in `tokens.css`, so it only acts inside the console shell. Home/Login/Sign Up and portal panels (`SelectMenu` list, `ConfirmDialog`) keep the standard scale.
- Compact values: `--sd-gap-1…6` (0.375 / 0.5 / 0.75 / 1 / 1.5 / 2.5rem), `--sd-margin`, `--sd-panel-padding`, `--sd-control-height-sm|md|lg` (2 / 2.25 / 3rem) and the new row tokens. Type sizes do not change.
- New row tokens (standard → compact): `--sd-row-min-height` 3.5 → 2.75rem, `--sd-row-pad-y` 0.5 → 0.25rem, `--sd-row-gap` 0.25 → 0.125rem, `--sd-cell-pad-x` 0.75 → 0.5rem. They are used by `.sd-table`, Home's `.sd-track-row`, `.sd-playlist-item` and `.sd-sessions-history__row`. **New lists and tables should use these tokens, not literal paddings**, so they follow density.
- Under `(pointer: coarse)` compact keeps the standard control heights, so touch targets don't get smaller.
- The legacy `--space-*`/`--size-*` overrides in `index.css` still apply to the Mixer and decks.

### 18.2 Player bar (`layouts/PlayerBar`) — now v2

- A hardware panel from the sidebar family: `--sd-surface` background, `--sd-radius-panel`, a 1px inset edge (ink 10%), no grille and no shadow. It uses the v2 atoms `IconButton`, `Icon` and `Fader` (thinner cap inside `.sd-player`).
- **Transport = Deck A** (the bar already showed it). There is no second engine. Play/Pause and seek act on Deck A. Prev/Next/Shuffle/Repeat act on the shared queue. Volume is the engine Master, so the deck channel faders are untouched. The fader shows the effective volume (0 while muted), and raising it unmutes.
- Active modes (shuffle, repeat, open queue) use an ink fill plus a small `--sd-indicator` dot. Repeat cycles off → whole queue → one track (`Repeat` / `Repeat1`). Every icon button has a translated `label`, and toggles use `aria-pressed`.
- Favourites: `services/favorites/favoritesService` (ids in `localStorage` `systemdj.favorites`). It is the only source of truth for the heart. No favourites model existed before.

### 18.3 Visualizer (`components/player/PlayerVisualizer`)

- A canvas behind the bar's content (`pointer-events: none`, `aria-hidden`), masked so it fades toward the top and keeps the text on a flat background. The colour is the live `--sd-accent`, re-read when `data-accent`/`data-theme` changes.
- Data: `audioEngine.readMasterSpectrum()` reads the **existing** Master `AnalyserNode` tap (read-only: no new nodes and no change to the graph). The tap sits after master gain, so mute and volume show in the wave. Bands are log-spaced and mirrored (lows in the centre), with fast attack and slow release (`visualizerModel.ts`).
- Loop: one `requestAnimationFrame`, with no React state per frame. It runs only while a deck plays or the decay is still falling. With nothing playing the canvas is empty: no fake ambient signal.
- Governed by §17.2: `useAnimationsEnabled()` false → no loop and the canvas is hidden. CSS also hides it under `data-animations='off'` and reduced motion. Playback is unaffected.
- Setting: Settings → Appearance → Motion → "Player bar wave", with `visualizerIntensity` `subtle | balanced (default) | vivid` (opacity and gain). It is disabled while animations are off.

### 18.4 Queue (`services/player/playerQueue` + `playerService`, `components/player/QueuePanel`)

- One queue. Home (Play on a recent track: the queue becomes the recent list, starting at that track), Playlists (Play = saved order; Shuffle = random order) and the bar all use it. Shuffle reorders only the play order, never the persisted `trackIds`.
- Panel: the same family as the notifications popover (paper, 2px ink border, radius 1.5rem, no shadow), opening above the queue button. It shows "Now playing" (surface row; accent `Tag` while playing) and "Up next" (numbered, `Pending` paper tag, play-now, remove), plus Clear, which keeps the current track. Escape or an outside click closes it and focus goes back to the button.

### 18.5 Navigation shortcuts

- Shift + 1–7 → Home, Library, Playlists, Mixer, Sessions (sidebar order), Settings, My Profile. They are reassignable in Settings → Shortcuts → Navigation (letter or digit, unique, Shift always required) and persisted as `navigationBindings`.
- They go through the same global handler as the DJ shortcuts. They are resolved before the mix selectors, ignored in editable/ARIA form controls and with Ctrl/Alt/Meta, and turned off by the same "Enable keyboard shortcuts" switch. The shell registers `navigate` through `services/navigation/consoleNavigator`. Navigating doesn't remount the shell, so playback continues.

### 18.6 Home and Library

- Home's "Recently Added": the whole row is one button (stretched `::after`) that loads the track into the deck selected in "Mix Recommendations". The state is lifted into `Dashboard` (`referenceDeck.ts`). Hover and focus show a paper background plus a 3px `--sd-indicator` inset edge. Play is a separate button, not nested.
- Library filters: `SegmentedControl` All tracks / My local files, plus a `SelectMenu` for analysis status: any / analyzed (`analyzed` only) / pending (`pending`, `analyzing`) / failed or unsupported. The logic is in `utils/libraryFilters.ts`. **Known limitation:** every import (including YouTube) is stored in IndexedDB, so "My local files" currently matches "All tracks". The filter excludes only `source.type === 'url'`, which no current import produces.


---

## 19. Mix recommendations and Sessions layout

Added on 2026-10-24.

- **Mix recommendations (Home).** Each result is a paper card with three zones: a header (rank, title/artist, and a compatibility block on the inverse field whose bar uses sage ≥ 80, acid ≥ 50, soft ink below that, which are the same thresholds as before); readouts for tempo, key and energy (sage = compatible, acid = needs attention, surface = no data, each with a check/alert/dash icon so colour is never the only signal, and energy as a 10-segment meter); and the reasoning plus a suggested transition, with evidence and source tags and the load buttons in the footer. The deck that is not the reference gets the ink button. The deck selector shows the reference's analysed BPM · key. Under a 34rem card width (container query) the score moves below the title and the readouts stack. Calculation and data are unchanged.
- **Sessions.** New molecule `StepIndicator` (`done` sage + check, `current` ink ring, `upcoming`, `attention` acid) shows record → export → download, derived from the page state. Capture (1) and Export (2) sit side by side; history (3) spans the full width. Export groups the file settings in one paper card and has a status card (aria-live, indicator edge while running) and a primary action with a format summary. Export limits sit in a native `<details>`. While recording, the capture panel offers "Go to Mixer"; the capture keeps running because the shell does not remount.
