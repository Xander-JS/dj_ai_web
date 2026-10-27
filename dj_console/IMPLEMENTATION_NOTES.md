# Mixer refactor — implementation notes

## Progress

| Step | Folder | Status |
|---|---|---|
| 1 | `01` — digital screen | **Done** |
| 2 | `02-03` — Deck A / Deck B | **Done** |
| 3 | `04` — Master mixer | **Done** |
| 4 | `05-06` — Downbeat & Compás | **Done** |
| 5 | `07` — screen side panel | **Done** |

Gate at the end of step 1: `npm test` (871 tests, 0 failures), `tsc -b`, `npm run lint` (0 errors; the only warning is the pre-existing one in `SmartRecommendationCard.tsx`) and `npm run build` all pass.

Gate at the end of step 2: `npm test` (903 tests, 0 failures), `tsc -b`, `npm run lint` (0 errors, same pre-existing warning) and `npm run build` all pass. The layout was checked in Firefox at 1440 px and 1920 px.

Gate at the end of step 3: `npm test` (919 tests, 0 failures), `tsc -b`, `npm run lint` (0 errors, same pre-existing warning) and `npm run build` all pass. The layout was checked in headless Firefox at 1920, 1440, 1000 and 860 px.

Gate at the end of step 4: `npm test` (919 tests, 0 failures), `tsc -b`, `npm run lint` (0 errors, same pre-existing warning) and `npm run build` all pass. The layout was checked in headless Firefox at 1920, 1440, 1180 and 1000 px (`/mixer` needs a login, so a temporary entry rendered `DJConsole` alone; it was deleted).

Gate at the end of step 5: `npm test` (940 tests, 0 failures), `tsc -b`, `npm run lint` (0 errors, same pre-existing warning) and `npm run build` all pass. The layout was checked in headless Firefox at 1920, 1440 and 1100 px, plus 844 × 390 with `fitHeight` (phone landscape), with the same temporary entry as in step 4 (deleted).

### Pending and relevant for the next steps

- **Deck height vs. mixer height.** Rechecked in step 5: the decks and the mixer still end at the same height. With panel 7 the DOWNBEAT modules are narrower and end about 25 px below the screen at the 1400 px design width, which only moves the main row down by that amount.
- **The REC counter blink phase.** The REC key LED and the screen counter dot use the same `ConsoleLed` atom and the same 1 Hz animation. Both start in the same render, so they stay in phase.
- **Phone mode is untested on real devices.** The decision logic is unit-tested and the fitted layout was checked at 844 × 390, but headless Firefox cannot emulate `pointer: coarse`, the Fullscreen API or orientation lock. Please try `/mixer` on an Android phone (Chrome) and an iPhone (Safari) before release. At 844 × 390 the console renders at about 0.4 ×, so pads and keys are small. A later improvement could give phones a shorter console (smaller jog wheels and screen) so it scales less.
- **KEY LOCK latency.** With KEY LOCK on, a deck's audio goes through the pitch shifter and comes out about 20 ms late (half the 40 ms grain window, see Step 2). The transport clock does not include that delay, so a key-locked deck sounds about 20 ms behind where BAR SYNC / ALIGN place it. That is within a typical DJ beatmatch tolerance, but it is not sample-accurate. A later fix could add a matching delay to the other deck, or offset the key-locked deck's start position by the shifter latency. Nothing in 03–07 asks for this, so I left it.
- **Deck colours.** Folder 07 says "Deck A purple, Deck B green, matching the digital screen". Folder 01 says the screen uses "the same tones as in `Deck.css`". Those tones are `--color-primary-500` (the user's accent setting, purple by default) and `--color-secondary-500` (hue 320, magenta-pink, **not green**). Step 1 follows folder 01 and keeps the existing tokens. If Deck B must be green, change `--console-tone-b` in `consoleTheme.css` once and every console part follows. **Decision needed from you.**
- **Conflicts between subfolders, resolved by specificity:**
  - *Track loading.* `04/master_mixer.md` §6 says the `Load track…` selectors move "to the upper area of each deck (sections 5 and 6)". `01/digital_screen.md` defines LOAD A / LOAD B on the screen, replacing the pickers and their `V` / `N` shortcuts, and `05-06` does not mention loading. Loading lives only on the screen.
  - *REC.* `04` §6 says the REC panel moves to section 7. `01` puts REC in the screen button row, and `07` says panel 7 holds only the live indicator, Eject and Reference. REC stays on the screen.
  - *C1 (`Consola de mezcla` + `En vivo` / `En espera`).* `01` said to keep it in step 1. `04` §6 takes both out of the mixer, and `07` §1 keeps only the LED, as `EN VIVO` / `LIVE`. Step 3 removed the title and the mixer header, and moved the LED next to the screen (see the `EN VIVO` item above).
- **The `ejecutar.sh` reply keyword.** The script waits for `finalizar` in the reply, while REFACTOR_PROMPT §2 asks for "implementado carpeta XX". My end-of-step reply contains both, so the script can advance.

---

## Step 1 (`01`) — what was built

### Components (Atomic Design inside the `dj` feature)

The v2 atomic folders (`src/components/{atoms,molecules,organisms}`) belong to Home/Login/Sign-up. The rest of the app is feature-based (see `DESIGN_SYSTEM.md` §5). The console parts follow the same atomic split inside the DJ feature, so anyone changing one part of the console finds it under `src/components/dj/`:

| Level | File | Role |
|---|---|---|
| atom | `dj/atoms/ConsoleLed.tsx` | Round LED: unlit dome when off, light plus halo when on, optional 1 Hz blink (steady with reduced motion or with Ajustes → Animaciones off). Reused later for the downbeat LEDs, LIVE, CUE, etc. |
| atom | `dj/atoms/ConsoleKey.tsx` | Backlit rectangular hardware key (neutral or deck-tone light). |
| atom | `dj/atoms/Waveform.tsx` (moved from `dj/Waveform.tsx`) | SVG peak bars. Owns its own `Waveform.css`; bar colour follows `--console-tone`. |
| molecule | `dj/molecules/ScreenButtonRow.tsx` | MENU, GRID, LOAD A, LOAD B, REC. |
| molecule | `dj/molecules/ScreenDeckIdent.tsx` | Rows 6 and 8: deck letter, title, artist, or the red alert. |
| molecule | `dj/molecules/ScreenWaveform.tsx` | Rows 7 and 9: waveform, progress fill, playhead, Hot Cue and CUE markers, click-to-seek. |
| molecule | `dj/molecules/ScreenTechInfo.tsx` | Blocks 10 and 11: 2 × 5 technical grid. |
| molecule | `dj/molecules/ScreenRecCounter.tsx` | Red dot plus `mm:ss` in the top-right corner. |
| molecule | `dj/molecules/ScreenReplaceDialog.tsx` | Dialog 11 (`alertdialog`). |
| organism | `dj/organisms/ScreenLoadMenu.tsx` | Menu view: fieldset/legend MENU, subsections, search, list and key bar. |
| organism | `dj/organisms/DigitalScreen.tsx` | The raised module with the button row and both views. |
| organism | `dj/organisms/DJConsole.tsx` | The single dark-plastic housing: screen on top, Deck A, mixer and Deck B below. `pages/Mixer.tsx` only renders it. |

`Deck`, `MixerConsole`, `ConsoleKnob` and `ConsoleFader` stayed where they were in step 1. Steps 2 and 3 moved them into `dj/organisms` and `dj/atoms`.

### Services (pure logic, unit-tested in Node)

- `services/console/digitalScreenStore.ts` holds the screen state: view, active subsection, `gridEnabled`, the pending replace and a `focusRequest` counter. It replaces `trackPickerBridge.ts`, which I deleted. The buttons and the `V` / `N` shortcuts act only while a screen is mounted (inside the Mixer), as the bridge did before. Unmounting returns the screen to the normal view and keeps GRID.
- `services/console/screenMenuModel.ts` holds the menu rules: list rows, title-only accent-insensitive search, initial selection, the eight-key navigation table per zone, and the load / confirm / no-op decision.
- `services/console/screenDisplayModel.ts` computes the normal-view tech values and the alert that replaces title and artist (SYNC rejection first, then playback error).
- `services/console/libraryLoadFeedback.ts` holds the `loadTrackToDeck` and library-read logic, moved unchanged from `ConsoleTrackPicker`, with the same toasts.
- `hooks/useSessionCapture.ts` is the capture state plus a 500 ms clock, moved from `ConsoleRecPanel`.

### Key capture (functional change; tests in `tests/DigitalScreen.test.ts`)

- `keyboardShortcuts.ts` checks `target.isNavigationCaptured()`, which reads `digitalScreenStore`, before acting. While the menu is open, the plain arrows, Home, End, Enter and Esc are left to the screen, so `↑ / ↓` no longer move MASTER and `← / →` no longer move the crossfader.
- Combinations with a held key (`F / J + ↑ / ↓` for the channel faders, the mix selector keys) and with Shift (curve, Pitch Bend) keep working. So do transport, CUE, SYNC, Hot Cues, MUTE, REC and LOAD.
- The screen listboxes carry `data-dj-shortcuts="pass"`, so `isEditableTarget` does not treat them as form controls. Focus is on the list when the menu opens, and the global shortcuts must keep working there. The search field is still an editable target: typing never triggers shortcuts.
- The screen handles its eight keys with one `window` listener. It works even when DOM focus is outside the screen. The exception is focus on another native console control (a fader or knob range input), which keeps its arrows.
- `ShortcutTarget.toggleTrackPicker` was renamed to `pressLoadButton`. The action type and the binding ids stay `library` / `libraryA` / `libraryB`, so saved user bindings need no migration. The Ajustes descriptions now say "LOAD A / LOAD B".

### Removed in this step

- `ConsoleTrackPicker.tsx/.css`, `ConsoleRecPanel.tsx/.css` and `services/console/trackPickerBridge.ts`.
- The `mixer-deckbar` row and its CSS in `MixerConsole`. The channel area takes the freed height, and the three-column proportions are unchanged.
- From `Deck.tsx` and `Deck.css`: title, artist and error line, the TEMPO / KEY / CAMELOT / ENERGÍA / TIME block, the waveform and its markers, and the unused `trackTitle` / `trackArtist` / `bpm` / `keyStr` / `timeRemaining` props.
- The `SelectMenu` props that only the picker used: `handleRef`, `onOpen`, `returnFocus`, `onMenuKey`, `menuClassName`.
- i18n keys: `mixer.picker_label`, `picker_placeholder`, `picker_aria`, `picker_search`, `rec_panel`, `rec_status`, `rec_on`, `rec_off`, `rec_elapsed`, `dj.tempo`, `dj.key_lock`, `dj.camelot`, `dj.energy`, `dj.time`.
- i18n keys reused: `mixer.picker_empty`, `picker_no_results`, `picker_library_error`, `rec_label`, `rec_start`, `rec_stop`, all `rec_*` toasts, `dj.no_track`, `dj.unknown_artist`, `dj.seek_title`, `dj.bar_sync_time_tooltip`.
- New texts live under `mixer.screen.*` (ES + EN).

### Decisions where the spec was open

- **The REC panel's `ON` / `OFF` readout and its "final duration after stopping".** The spec defines the counter as existing only while recording. The REC key LED shows ON/OFF, `aria-pressed` and the label say it to screen readers, and the saved session is in Sesiones. Nothing else changed: same `toggleSessionCaptureWithFeedback`, same toasts, same start rules.
- **The tech headers** (`BPM`, `Time`, `Key`, `Camelot`, `Energy`) are identical in ES and EN, as in the Spanish mockup. They are still i18n keys.
- **The TIME tooltip.** "Posición actual: {s.sss}s / Duración: {s.sss}s" stays as the `title` of the Time cell on the screen.
- **The waveform keeps `role="slider"` without keyboard support**, as documented in functional doc §6.4 / §12.3. Not "fixed", per REFACTOR_PROMPT §4.
- **The loaded-track marker** is a small dot in the deck colour before the title, plus screen-reader text. The selected row uses a deck-colour fill with a border. Colour is never the only cue: the active subsection also gets `▸` and a border.
- **Enter on the dialog.** Besides the 300 ms guard, key auto-repeat is ignored, so holding Enter never confirms.
- **Focus** returns to the list after the dialog closes (Esc, Cancel or Replace) and when MENU or LOAD switch subsections.
- **Concurrent loads.** Only one load per deck runs at a time from the menu. A repeated Enter during decoding does nothing. `loadTrackToDeck` itself is unchanged.
- **Library duration.** `Track.duration` is stored as metadata, so the Duration column never decodes audio (the spec asked to report if it was missing; it is not).
- **Dark-plastic material.** `public/assets/mixer/textures/` contains only `brushed-metal.jpg`, and there is no plastic texture among the assets. Following REFACTOR_PROMPT §5, the plastic is recreated with CSS in `consoleTheme.css` (`--console-plastic`): a two-layer micro-grain over a near-black gradient. The housing and screen look the same in light and dark mode. Only the drop shadow that separates the console from the page background follows the theme (`--console-housing-shadow`).
- **Screen width.** About 31 % of the console width, as in the sketch, with a minimum of 27rem so both 5-column tech grids stay readable on 1280–1600 px windows (checked with screenshots).
- **The design skills `impeccable` and `design-taste-frontend` are not installed** on this machine (`~/.claude/skills` contains only the synced document skills), so I could not read them. I applied the same quality goals by hand: hover, active, focus-visible and disabled states on every key; tabular numerals; reduced-motion fallbacks for every animation; and visible focus rings on the listboxes and search field.

### Responsive (superseded in step 5)

The console keeps Deck A | mixer | Deck B with the screen protruding above the housing. Below 1024 px the mixer column is 19rem. Below 900 px everything stacks: screen, Deck A, mixer, Deck B, as the page did before. The phone landscape full-screen mode from REFACTOR_PROMPT §7 is still pending (see Progress).

---

## Step 2 (`02-03`) — what was built

### Components

| Level | File | Role |
|---|---|---|
| atom | `dj/atoms/JogWheel.tsx` | The jog wheel. A brushed-metal ring (`brushed-metal.jpg` asset plus CSS ticks), the platter, an inner ring and the deck-colour centre label (marker, letter, `JOG`). The platter turns at 33⅓ rpm × the real rate, only while playing. Decorative: `aria-hidden`, no pointer events. |
| atom | `dj/atoms/ConsoleBadge.tsx` | Notice badge: thin coloured border, uppercase silkscreen, its own CSS tooltip (hover and keyboard focus). It renders a `<button>` when it has an action (analysis). |
| atom | `dj/atoms/ConsoleKey.tsx` (extended) | New `amber` / `green` / `red` lights, `filled` (SYNC ✓) and `pulse` (ALIGN running). The existing `neutral` / `deck` lights are unchanged for the screen keys. |
| molecule | `dj/molecules/DeckNoticeStrip.tsx` | Row 1: the notices, centred and wrapping. It keeps an 18 px height when empty, so the jog wheel does not jump when a track loads. |
| molecule | `dj/molecules/DeckSyncRow.tsx` | Row 3: BAR SYNC · ALIGN · SYNC · KEY LOCK, the same order on both decks. |
| molecule | `dj/molecules/DeckHotCues.tsx` | Row 4: `HOT CUES` + `BORRAR`, and the 2 × 4 pads. It owns the delete-mode state. |
| molecule | `dj/molecules/DeckTransport.tsx` | Transport column: round CUE (amber) and PLAY / PAUSE (green), with the caption above PLAY. |
| molecule | `dj/molecules/DeckPitchFader.tsx` | Pitch column: `−8%`, the inverted fader with the deck-colour 0 % line, `+8%`, `TEMPO`, and the Pitch Bend − / + keys directly below it (REFACTOR_PROMPT §6). |
| organism | `dj/organisms/Deck.tsx` (moved from `dj/Deck.tsx`) | Composes the grid, the CUE press handling and the BAR SYNC guide line. The downbeat editor moved out in step 4. |

`services/console/deckPanelModel.ts` holds the pure rules: which notices show and in what order, their colour and tooltip; the label, light, fill, pulse, disabled state and `aria-pressed` of each sync key; and the BAR SYNC guide. It returns i18n keys plus values (nested messages allowed), so `tests/DeckPanel.test.ts` checks the rules in Node. `Deck.tsx` only translates and renders.

### Layout

- A grid with three columns (transport 20 · main 70 · pitch 10) and four rows (notices · jog · sync · cues), built with `grid-template-areas`. Deck B reverses the columns and areas (pitch left, transport right). The sync row keeps its left-to-right order.
- Everything scales with the deck width through a container query on `.dj-deck`. The jog wheel is `min(60cqi, 27rem)`. The pitch column starts at `0.55 × --jog-size`, in the lower half of the jog, and ends with the last pad row. The sync keys use the same 4-column grid and gap as the pads, so the columns line up.
- CUE and PLAY / PAUSE are `aspect-ratio: 1` circles capped by the column width. The column spans from the top of the sync row to the bottom of the pads, with `space-between`.

### KEY LOCK (functional change; tests in `tests/KeyLock.test.ts`)

- **Store.** `DeckStoreState.isKeyLocked` (default off) and `toggleKeyLock(deckId)`. Toggling never touches rate, pitch or SYNC. The value is kept on eject, like a CDJ's Master Tempo.
- **Engine.** With KEY LOCK on, `AudioEngineService.setDeckKeyLock` routes the deck's source through an AudioWorklet pitch shifter (`audio/keyLock/`) that applies 1 / rate, so the pitch fader changes speed but not key. With it off, the source connects straight to the channel, exactly as before.
  - The worklet module is loaded the first time a deck enables KEY LOCK, through a dynamic import of `keyLockModule.ts` (`?worker&url`), so Node tests never resolve it.
  - The pitch fader, Pitch Bend, ALIGN ramps and slew cancellations all program the source's `playbackRate` and the shifter's `rate` parameter at the same moment, through one combined parameter (`getRateParam`). The pitch correction therefore follows every ramp.
  - Each source start sends `reset` to the shifter, so no audio from the previous position leaks after a seek or Hot Cue jump.
  - Without AudioWorklet support, or if the module fails to load, the state is kept and the audio stays on the direct path. Nothing breaks.
- **DSP** (`granularPitchShifter.ts`, pure and tested). A two-head delay line with sin² / cos² crossfades and a 40 ms window. At factor 1 (fader centred) the phase drifts slowly (≤ 0.3 % detune) until only one head plays, which avoids the comb filtering of two summed taps. Tests: a 440 Hz tone sped up to ×0.92, ×1.08 or ×1.16 comes back within ±4 Hz of 440 Hz. At factor 1 the output is the input delayed by half a window. The level is kept, and there are no non-finite values.
- The key is enabled even without a track, because the setting applies to whatever plays next.

### Notices (02-03 §1)

| Notice | Text | Colour | Notes |
|---|---|---|---|
| Analysis | `library.status_*` (`PENDIENTE`, `ANALIZANDO...`, …) | green analysed, red error, amber unsupported, neutral otherwise | A button in PENDIENTE / ERROR (click, Enter, Space). It shows ANALIZANDO while the request is pending, and the real analysis error goes in the tooltip. |
| `PROVISIONAL` | `dj.phase_align_badge_prov` | amber | Tooltip: `dj.phase_align_grid_tooltip`. |
| SYNC role | `MASTER` / `SLAVE ← B` | deck colour | Tooltips unchanged (BPM, pitch, limit). |
| ALIGN | `ALIGN · {state}` (new `dj.align_notice`) | deck colour while active, green done / within tolerance, red rejected, neutral cancelled | `dj.phase_align_active` now carries `{{percent}}`. |
| BAR SYNC | `BAR SYNC · {state}` (new `dj.bar_sync_notice`) | Same as the key: amber armed, deck colour aligned, green done, red rejected | The positions and Δ that the old badge printed inline are in the tooltip (`bar_sync_*_badge_tooltip`). |
| Reference | `seed.badge` (`REFERENCIA N`) | neutral | — |

### Decisions where the spec was open

- **The jog platter is the disc chosen in Ajustes.** 02-03 describes a "dark platter". Settings already lets the user pick one of three disc images (`jogDisc`), and dropping it would silently remove a feature. The platter shows that disc, inside the metal ring and under the deck-colour label.
- **Labels on narrow decks.** At about 1440 px each deck is roughly 300 px wide. The sync key legends and the `PLAY / PAUSE` caption wrap onto two balanced lines (`BAR / SYNC`, `KEY / LOCK`) instead of being cut off, as narrow hardware keys do.
- **CUE lights up** amber while held (pointer or keyboard) and while the store reports CUP playback, so the `Q` / `I` shortcuts light it too. **PLAY** lights green while playing and exposes `aria-pressed`. Its accessible name follows the action (Play / Pause).
- **The BAR SYNC key's accessible name** is always "BAR SYNC", plus the state when the visible text changes (`BAR SYNC: ARMADO`). The guide line under the deck stays linked with `aria-describedby`.
- **BORRAR switches itself off** when the last Hot Cue is deleted or the deck has no track, instead of staying armed while disabled.
- **The SYNC rejection** message stays on the screen ident row (step 1). The deck has no duplicate.
- **Pad colours** reuse `HOT_CUE_COLORS` from the store (red, orange, yellow, green, turquoise, light blue, purple, magenta), so the screen markers and the pads match.
- **Design-skill layer** (applied by hand, see step 1): rubber-key depth with a 1 px press on `:active`, visible `focus-visible` rings on every control, disabled at 40 % opacity, tabular numerals on changing numbers, and reduced-motion / Animaciones-off fallbacks for the jog spin, the ALIGN pulse and the analysis pulse.

### Removed in this step

- The whole old deck header and its CSS: title rows, `Badge`-based role badge, the compact `.status-badge` variant, `.deck-tooltip-trigger`, the downbeat and meter-pending badges, `.btn-dj-*`, the old jog, pitch, Hot Cue and transport styles, and the tablet media queries (the container query replaces them). `Deck.tsx` no longer imports `ui/Badge` or `Badge.css`.
- i18n keys removed: `dj.bar_sync_badge_preparing`, `…_armed`, `…_aligned`, `…_completed`, `…_cancelled`, `…_rejected`, `dj.bar_sync_badge_downbeat`, `dj.bar_sync_badge_downbeat_title`, `dj.meter_pending`, `dj.meter_unit_pending`.
- i18n keys added (ES + EN): `dj.key_lock`, `dj.key_lock_on_tooltip`, `dj.key_lock_off_tooltip`, `dj.sync_row_label`, `dj.play_pause`, `dj.tempo`, `dj.align_notice`, `dj.bar_sync_notice`, `dj.bar_sync_tooltip_blocked`. `dj.phase_align_active` gained `{{percent}}`.
- Tests that read `Deck.tsx` as text now use `tests/helpers/deckSource.ts` (the organism plus its molecules, atoms and model). The BAR SYNC UI tests check the model's output for real store states, not source strings.

---

## Step 3 (`04`) — what was built

### Components

| Level | File | Role |
|---|---|---|
| atom | `dj/atoms/ConsoleKnob.tsx` (moved from `dj/ConsoleKnob.tsx`) | Rotary knob on `knob-main.png`. Channel knobs have a cap anodised in the deck colour (a `mix-blend-mode: color` layer keeps the brushed reflections). The MASTER knob stays plain aluminium. All knobs have a white position indicator drawn with CSS, which replaces the image's dark notch. Optional `startLabel` / `endLabel` hang left and right of the knob without moving it off centre (FILTER: `LPF` / `HPF`). `label` is now optional (MASTER has none). Sizes are `channel` and `master`; the mixer sets them with `--mixer-knob`. |
| atom | `dj/atoms/ConsoleFader.tsx` (moved from `dj/ConsoleFader.tsx`) | Unchanged behaviour. The focus ring now uses `--console-focus`, like the keys. |
| atom | `dj/atoms/LevelMeter.tsx` (new, was inline in `MixerConsole`) | Segmented LED meter: green, amber, red, with the top clip segment lit from 95. |
| atom | `dj/atoms/ConsoleLed.tsx` (extended) | New `dim` prop: lit at half intensity with no halo (the channel LED in pause or while loading). |
| molecule | `dj/molecules/MixerChannelStrip.tsx` | One channel column: `CH n` + signal LED, GAIN · HI · MID · LOW · FILTER, CUE (`ConsoleKey` with an amber LED), the fader and the VU on the inner side. |
| molecule | `dj/molecules/MixerMasterStrip.tsx` | `MASTER`, the larger knob with no label, the two-bar stereo meter and MUTE (`ConsoleKey` with a red LED). |
| molecule | `dj/molecules/MixerCrossfader.tsx` | `← A` · crossfader (ticks at 0 / 25 / 50 / 75 / 100 %) · `B →`, and CP · LIN · CUT below. |
| molecule | `dj/molecules/ConsoleLiveIndicator.tsx` | `EN VIVO` / `LIVE` with its LED (final form; placed provisionally, see Progress). |
| organism | `dj/organisms/MixerConsole.tsx` (moved from `dj/MixerConsole.tsx`) | The mixer plate. It reads the VU levels from the engine at about 30 Hz in local state and lays out the three columns and the crossfader. |

`services/console/mixerPanelModel.ts` holds the pure rules: the channel LED (colour, dim, tooltip keys), the FILTER value text, the effective meter levels (0 when the deck is not playing; master 0 with MUTE or when nothing plays), the `← A` / `B →` brightness (the real curve gains) and the curve keys. `tests/MixerPanel.test.ts` covers it in Node. Tests that read the mixer source now use `tests/helpers/mixerSource.ts`, which joins the organism, the molecules and the model.

### Stereo master meter (functional change; tests in `tests/MixerPanel.test.ts`)

04 §3 asks for a stereo meter with two parallel bars. The engine only had a mono master analyser, so two bars would have shown the same signal twice. `AudioEngineService` now adds a measuring tap after the master gain: a unity gain fixed at two channels with `speakers` mixing, so a mono track reaches both sides, then a `ChannelSplitter` and one analyser per side. `getMasterStereoVUMeter()` returns `{ left, right }`, both 0 when nothing plays. The tap does not feed the output. If the context has no `createChannelSplitter`, there is no tap, and both bars show the mono master level. `getMasterVUMeter()`, the spectrum API used by the player visualiser, and the output chain are unchanged. `dispose()` disconnects the tap.

### Layout

- The mixer uses the same plate as the decks: `--console-plate`, `--console-plate-edge` and `--console-plate-shadow`, new tokens in `consoleTheme.css` that `Deck.css` now uses too. The columns are `1fr · 0.72fr · 1fr`. The MASTER column has a 1 px `--console-divider` line on each side, and the crossfader section has the same line on top. There are no boxes or recessed trays.
- Everything scales with the mixer width through a container query: knob size `clamp(1.9rem, 10.5cqi, 3.1rem)`, MASTER knob 1.25 ×, and the header and `← A` / `B →` type sizes. At 1440 px the mixer is 352 × 514 px.
- The headers `CH 1` · `MASTER` · `CH 2` and the letters `← A` · `B →` are plain bold text (800 weight), with no badges.
- In the stacked layout (≤ 900 px), the mixer is capped at 30rem and centred.

### Decisions where the spec was open

- **Material and theme.** The old aluminium / graphite panel and its `brushed-metal.jpg` background are gone. The light-theme and dark-theme token sets (`--console-panel*`, `--console-recess*`, `--console-ink*`, `--console-led-off`, `--console-screen`, `--console-glow`, `--console-meter-*`) are deleted. The fader slots, ticks and meters use fixed dark-plastic values. Only the housing shadow still follows `data-theme`.
- **MASTER and crossfader colour.** 04 says the MASTER column and the curve keys are neutral. `--console-tone-master` changed from cyan to a cold white (`hsl(220 14% 88%)`). The MASTER arc, the crossfader cap line and fill, and the lit curve key are all neutral now.
- **MUTE and channel CUE** use the `ConsoleKey` atom with a `ConsoleLed` inside: red for MUTE, amber for CUE, the same rubber keys as the decks. The old MUTE image switch (`button-off.png` / `button-on.png`) is a tall toggle plate that does not fit the "small rectangular control with an LED" in 04 §3. Both images are no longer referenced, and I removed them from `MIXER_ASSETS`. The files are still in `public/assets/mixer/buttons/`.
- **`knob-small.png`** is a 3/4 perspective view. Rotating it with the value would look wrong, so all knobs keep `knob-main.png`, which is seen from the top.
- **The `Silenciado` state** that the spectrum display used to show is now carried by the dimmed MASTER arc, the MUTE LED and the knob's `aria-valuetext` (`80% · Silenciado`).
- **The channel signal LED** keeps its logic and tooltip: green with real level, amber at half light when paused with a track, deck colour at half light while loading, off when empty. It sits right after `CH 1` / `CH 2`.
- **The curve group** keeps `mixer.curve` (`Curva`) as its accessible name, although the visible label is gone (04 §4).
- **Design-skill layer** (applied by hand, see step 1): visible focus rings on every knob, fader and key; a 1 px press on the keys; tabular, uppercase silkscreen; reduced-motion and Animaciones-off fallbacks for the knob rotation and meter transitions.

### Removed in this step

- The spectrum display (`mixer-spectrum`, the 16-band loop in `MixerConsole`). `readMasterSpectrum` stays in the engine because `PlayerVisualizer` uses it.
- The mixer header (`Consola de mezcla` title and the `En vivo` / `En espera` status), the `A` / `B` channel badges, the `Curva` and `Crossfader` labels, and the recessed trays around the channels, EQ and crossfader.
- The old `MixerConsole.css` (aluminium panel, tablet media queries) and the `.console-legend` class.
- i18n keys removed: `mixer.crossfader`, `console_title`, `status_live`, `status_standby`, `spectrum_label`, `no_signal`, `crossfader_title`.
- i18n keys added (ES + EN): `mixer.live`, `live_on`, `live_off`, `meter_master_left`, `meter_master_right`.

---

## Step 4 (`05-06`) — what was built

### Components

| Level | File | Role |
|---|---|---|
| atom | `dj/atoms/ConsoleLcd.tsx` (new) | Mini LCD: very dark blue glass, thin edge, cyan monospaced digits. It shows only its value. New tokens `--console-lcd-bg`, `--console-lcd-edge`, `--console-lcd-ink` in `consoleTheme.css`. |
| atom | `dj/atoms/ConsoleSelectorKnob.tsx` (new) | A rotary switch with fixed positions: a round dark body, a white indicator line and printed labels around it (selected label white, others dim). Click turns to the next position, a label jumps to it, ←/→ step without wrapping. It is a `role="slider"` with `aria-valuetext`. The labels are `aria-hidden` buttons outside the tab order, so the knob is a single tab stop. |
| atom | `dj/atoms/ConsoleLed.tsx` (extended) | New colours `neutral` (SIN CONFIRMAR) and `tone` (deck accent, CONFIRMADO). |
| molecule | `dj/molecules/DownbeatStatusLeds.tsx` | Zone 1: the four stacked LEDs. Each row also says "lit" / "off" to screen readers. |
| molecule | `dj/molecules/DownbeatMeterZone.tsx` | Zone 2: `POSICIÓN (S)` + LCD (playhead `mm:ss.mmm`) and `MÉTRICA` + LCD in one row, the 4-detent horizontal fader below (reuses `ConsoleFader` with `min 0`, `max 3`, step 1), with a tick and label under each detent. |
| molecule | `dj/molecules/DownbeatActions.tsx` | Zone 4: CONFIRMAR with a blinking amber pending LED, LIMPIAR below. Dimmed keys use `aria-disabled`, so they stay focusable and their tooltip still explains why. |
| organism | `dj/organisms/DownbeatPanel.tsx` | Modules 5 and 6: the title `DOWNBEAT & COMPÁS · A/B` (letter in the deck accent), the amber note-value warning LED and the four zones. It holds the local selection (knob, candidate, meter) and calls `confirmDownbeat` / `clearDownbeat`. |
| organism | `dj/organisms/DJConsole.tsx` | The top row is now `DOWNBEAT A · screen · DOWNBEAT B`, each module bottom-aligned with the screen, right above its deck. In the stacked layout (≤ 900 px) each module sits above its deck. |

`services/console/downbeatPanelModel.ts` holds the pure rules: track facts (suggested position = `downbeat.suggestedPosition` or `firstBeatTime`; confirmation only if `isDownbeatConfirmed` matches the current SHA-256), initial knob position and meter, knob click order CAB → OFF → SUG → CAB (SUG skipped when there is no suggestion), LED lighting, the pending-change LED, the CONFIRMAR / LIMPIAR states and tooltips, the clock format and the confirm parameters. `tests/DownbeatPanelModel.test.ts` covers the rules in Node. `tests/DownbeatManualEditor.test.ts` was rewritten to drive the same model against the real store and IndexedDB (confirm, clear, the other deck updating, missing hash, out-of-range position, saving lock, track change, i18n parity).

### Confirmation source (functional change)

05-06 §1 says the LEDs after confirmation show the source used to confirm, and that the knob starts there when the track is loaded again. That source was not stored. `ManualDownbeatConfirmation` now has an optional `origin: 'playhead' | 'suggested'`, `ConfirmDownbeatParams` passes it, and `createManualDownbeatConfirmation` keeps it. It is persisted with the rest of the confirmation. `isDownbeatConfirmed`, BAR SYNC and the hash rules are unchanged. For confirmations saved before this step (no `origin`), the source is inferred: `suggested` if the position equals the suggestion to the millisecond, otherwise `playhead`.

### Decisions where the spec was open

- **Narrow widths.** The four zones fit side by side only when the module is at least about 43rem (688 px) wide, which happens on windows wider than about 2000 px. Below that, the module keeps the same reading order but puts zones 1 · 3 · 4 in one row and the position/meter zone under them at full width, separated by a printed line. Below 22rem (tablet landscape, 900–1200 px windows), the LEDs get their own row, then source | actions, then the meter, and `MÉTRICA` can wrap under `POSICIÓN`. Tab order is the DOM order in every layout. Both are container queries, so they follow the module width, not the window.
- **The note-value warning** (REFACTOR_PROMPT §6) is an amber LED with a short `UNIDAD` / `NOTE VALUE` silkscreen in the module header, right side. The full text (`dj.meter_unit_pending_tooltip`) is its tooltip and accessible label. It only shows when a confirmed downbeat has no confirmed note value.
- **The `SIN CONFIRMAR` guidance** (`dj.meter_pending_tooltip`) is the tooltip of the `SIN CONFIRMAR` LED row. The `CONFIRMADO` row tooltip shows the confirmed position, or the missing-hash explanation when the track has no valid SHA-256.
- **OFF and LIMPIAR causes.** CONFIRMAR at OFF and LIMPIAR with nothing confirmed get their own tooltips (`dj.downbeat_btn_confirm_disabled_off`, `dj.downbeat_btn_clear_disabled`), so every dimmed key says why.
- **Arrows at the end of the knob** do nothing. Otherwise, pressing ← at CAB would capture the playhead again without the DJ turning the knob.
- **After LIMPIAR** the knob and meter stay where they are, and the LEDs go back to following the knob (05-06 §4). After a new confirmation (also from the other deck with the same track), the module reloads to what was confirmed.
- **Loading / error state.** The store refuses to confirm while a deck is loading or in error, so the module is locked in those states too, like while saving.
- **Design-skill layer:** visible focus rings on the knob, fader and keys; the pending LED blink respects reduced motion through the shared `ConsoleLed` animation; LCDs use tabular digits so the clock does not jitter while playing.

### Removed in this step

- The provisional downbeat editor in `organisms/Deck.tsx` and its CSS block in `organisms/Deck.css` (status badge, position input, Cabezal / Sugerido buttons, meter select).
- i18n keys removed: `dj.downbeat_badge_confirmed`, `downbeat_badge_none`, `downbeat_badge_suggested`, `downbeat_btn_capture`, `downbeat_btn_capture_tooltip`, `downbeat_btn_use_suggested`, `downbeat_btn_use_suggested_tooltip`, `meter_pending`, `meter_unit_pending`.
- i18n keys added (ES + EN): `dj.downbeat_led_*` (unconfirmed, playhead, suggested, confirmed, on, off), `downbeat_source_*` (label, caption, the three positions with short labels and tooltips, `suggested_unavailable`), `downbeat_position_confirmed` / `_candidate` / `_none`, `downbeat_meter_fader`, `downbeat_status_label`, `downbeat_confirm_pending`, `downbeat_btn_confirm_disabled_off`, `downbeat_btn_clear_disabled`, `downbeat_unit_warning_label`.
- `tests/BarSyncUIIntegration.test.ts` §8.1 read the old badge from the `Deck.tsx` source. It now checks the behaviour instead: a confirmation stops counting (CONFIRMADO off) when the file hash changes.

---

## Step 5 (`07`) — what was built

### Components

| Level | File | Role |
|---|---|---|
| atom | `dj/atoms/ConsoleRingKey.tsx` (new) | A physical button whose only state indicator is a 2 px LED ring: the border shines in `--console-tone` when lit, and is a near-panel dark tone when off. The body, label and size never change (07 §3). `blinking` makes the ring flash at 5 Hz. A short 1 px press travel. |
| molecule | `dj/molecules/SidePanelDeckColumn.tsx` (new) | One deck column: the plain bold letter, `EXPULSAR` and `REFERENCIA`. It holds the hold-to-eject handling (pointer and keyboard). It is a `role="group"` named `Deck A` / `Deck B`, so the two identical buttons are told apart by screen readers. |
| organism | `dj/organisms/ScreenSidePanel.tsx` (new) | Module 7: `ConsoleLiveIndicator` as the first row, a printed line, then the two columns. It reads `useDJStore` and `useSeedStore` and calls the existing `unloadDeck` and `toggleSeed`. Same plastic frame and shadows as the screen. |
| organism | `dj/organisms/DJConsole.tsx` | Renders panel 7 inside the screen cell and scales the whole console (see below). It takes a `fitHeight` prop for phone mode. |
| organism | `dj/organisms/Deck.tsx` | The provisional `⏏` / target keys and the `aux` grid area are gone. The notice strip keeps its old span (an empty cell where `aux` was). |
| page | `pages/Mixer.tsx` | Turns phone mode on and shows the two fallback overlays. |

Pure logic, tested in Node by `tests/ScreenSidePanel.test.ts`:

- `services/console/sidePanelModel.ts` holds the LED ring rules and `createHoldTimer`, which takes an injectable clock.
- `services/console/consoleScale.ts` holds the scaling rule.
- `services/console/immersiveMode.ts` holds the phone query and which overlay to show.

`hooks/useMixerImmersiveMode.ts` wires the Fullscreen, Screen Orientation and history APIs.

### Behaviour (07 §4)

- **Eject:**
  - The ring is lit while a track is loaded.
  - Paused or stopped: a click ejects at once.
  - Playing: the press must be held for 800 ms, and the ring flashes during the hold. Releasing earlier cancels, and the ring stays lit. Pointer capture keeps the hold on touch even if the finger drifts. A cancelled pointer, lost capture or blur also cancels the hold.
  - Keyboard: Enter or Space held down does the same hold. A hidden description (`dj.eject_hold_hint`) tells screen readers about the hold while the deck plays.
  - Empty or loading deck: no action. The old key was also blocked while loading.
  - It calls the existing `unloadDeck`, so CUP, ALIGN, SYNC, BAR SYNC, the pitch position and session capture behave exactly as before.
- **Reference:** the ring is lit when the loaded track is a seed. A click toggles `useSeedStore.toggleSeed`, and `aria-pressed` reflects the state. It does nothing without a track. The state belongs to the track, so the same track on the other deck lights at once.
- **Tooltips and labels:** Eject has the tooltip `dj.eject_title` and the accessible label `dj.eject` (`Expulsar pista`). Reference uses `seed.mark` / `seed.unmark` as its tooltip. The visible labels are fixed: `dj.eject_button` and `dj.reference_button`.
- **Disabled look:** a button that cannot act keeps its exact look (07 §3 forbids body changes). It only gets `aria-disabled` and a default cursor.

### Placement

The sketch hangs module 7 on the screen's right edge, rising above the housing. Here it overlaps the screen frame by 6 px, starts half the screen rise above the housing edge, and is 11.5rem wide.

To stop it from covering module 6, the screen cell reserves the same width on **both** sides. That keeps the screen centred over the mixer and the two DOWNBEAT modules equal in width. The cost is narrower modules (about 265 px at the 1400 px design width).

The narrowest DOWNBEAT layout changed to fit them: LEDs beside the source knob, CONFIRMAR and LIMPIAR side by side, then the meter.

### Responsive behaviour and phone mode (REFACTOR_PROMPT §7)

- **Scaling replaces stacking.** The ≤ 1024 px and ≤ 900 px media queries in `DJConsole.css` and `MixerConsole.css` are deleted. Below 1400 px of available width, the console is drawn at 1400 px and reduced with `transform: scale()`, keeping its proportions and control arrangement. `transform` does not change `offsetHeight`, so the frame gets `natural height × scale` and clips the unscaled overflow. Fader, knob and waveform drags use `getBoundingClientRect` with `clientX/Y`, which are both in transformed coordinates, so they keep working.
- **Real app widths.** In the app (with the sidebar), a 1440 px window gives the console about 1030 px, so it renders at about 0.74 ×. The design width is 1400 px because at 1180 px the modules drop to about 190 px and clip their keys.
- **Phone detection.** A phone is `pointer: coarse` with a short side ≤ 540 px, in either orientation, so tablets keep the normal layout.
- **Phone mode on.** In phone mode, `<html>` gets `mixer-immersive`, which hides the header, sidebar and player bar and gives `main` the full `100dvh`. The console then fits both width and height (`fitHeight`), respects the safe-area insets and is centred.
- **Tap to start.** `Toca para empezar` / `Tap to start` (`mixer.immersive.tap_*`) shows when the Fullscreen API exists, because it needs a user gesture. The tap requests full screen on `<html>` and then `screen.orientation.lock('landscape')`. If the browser refuses full screen, the overlay is not shown again.
- **Rotate your device.** `Gira tu dispositivo` / `Rotate your device` (`mixer.immersive.rotate_*`) shows whenever a phone is in portrait after that, which covers iOS Safari, with no element full screen or lock. Its phone icon is CSS only and stays still with reduced motion or animations off.
- **Back goes to Home.** Two paths, because Android Chrome's Back first exits full screen without a `popstate`:
  - a `popstate` replaces the entry Back went to with Home (`/dashboard`);
  - leaving full screen also navigates to Home.

  Leaving the section undoes everything: the class is removed, the orientation is unlocked and full screen is exited.

### Decisions where the spec was open

- **Deck colours** are unchanged: the screen tones, per 01 and the open item in Progress. 07 says the rings match the screen colours, and they do through `--console-tone`.
- **Button labels** use the console's uppercase silkscreen (like CONFIRMAR / LIMPIAR), not the sentence case in the HTML mock.
- **The deck letters** are 14 px bold silkscreen white, a little larger than the 9.5 px button labels, as 07 §2 asks.
- **Reduced motion:** the hold flash becomes a steady half-lit ring.
- **Design-skill layer:** focus rings on every button, a 2.5rem touch height on coarse pointers, `touch-action: manipulation`, no context menu on the long press, and no text selection.

### Removed in this step

- In `Deck.tsx`: the `⏏` / target keys, the `lucide-react` `Target` import, the `unloadDeck` / `toggleSeed` wiring and the `ConsoleKey` import. In `Deck.css`: the `.deck-panel__aux*` rules and the `aux` grid area.
- In `DJConsole.css`: the `.dj-console__live` rules, the 2.25rem top padding of the DOWNBEAT cells (it only made room for the loose indicator), and the 1024 / 900 px media queries. In `MixerConsole.css`: the 900 px rule.
- i18n keys added (ES + EN): `dj.eject_button`, `dj.reference_button`, `dj.eject_hold_hint`, `mixer.side_panel`, and `mixer.immersive.tap_title`, `tap_hint`, `rotate_title`, `rotate_hint`. None were removed: `dj.eject`, `dj.eject_title` and `seed.mark` / `seed.unmark` moved with the buttons.
- Tests updated for the new structure: `DeckMusicalAnalysisIntegration` 5.12 (eject lives in panel 7), `MixerInterfaceIntegration` 2 (the page passes `fitHeight`), and `MixerPanel` (the live indicator is in panel 7).

---

## Element inventory

Every control, indicator, badge, message and toast in `functional_mixer_documentation.md`, with its place in the new design. "Step" is the step that implements the final placement. ✅ means already placed.

### Deck A / Deck B (functional doc §2.1, §3, §4)

| # | Element | New location | Step |
|---|---|---|---|
| — | Track title / `Sin pista` | Screen, row 6 / 8 (ident row) | ✅ 1 |
| — | Artist / `Desconocido` | Screen, row 6 / 8, after the title | ✅ 1 |
| — | SYNC rejection messages `dj.sync_reject_*` (§10.2) | Screen ident row, replacing title and artist in red, `role="alert"` | ✅ 1 |
| — | Playback error message (`playbackState === 'error'`) | Same ident row, red, `role="alert"` (REFACTOR_PROMPT §6) | ✅ 1 |
| D1 | `⏏` Eject | Panel 7, `Expulsar` button with LED border and 0.8 s hold while playing. | ✅ 5 |
| D2 | Reference target + `Referencia N` badge | Panel 7, `Referencia` button with LED border and `aria-pressed`. The `Referencia N` notice is in the deck notice strip. | ✅ 2 (badge), ✅ 5 (button) |
| D3 | Analysis badge (`Pendiente`… / clickable in pending and failed) | Deck notice strip above the jog wheel, still clickable | ✅ 2 |
| D4 | TEMPO / KEY / CAMELOT / ENERGÍA / TIME | Screen tech blocks 10 / 11 (`BPM`, `Time`, `Key`, `Camelot`, `Energy`). The elapsed-time tooltip is kept on Time. | ✅ 1 |
| D5 | Waveform (click-to-seek, progress, playhead, Hot Cue and CUE markers, pulsing while analysing) | Screen rows 7 / 9 | ✅ 1 |
| D6 | `BORRAR` (delete mode) | Deck, Hot Cues header, right | ✅ 2 |
| D7 | Pads 1–8 | Deck, 2 × 4 grid under the sync row | ✅ 2 |
| D8–D13 | Downbeat editor: position field, `Cabezal`, `Sugerido`, `Métrica`, `Confirmar`, `Limpiar` | Module 5 / 6: the position display (playhead time); the source knob CAB / OFF / SUG replaces Cabezal / Sugerido and the free position field; the 4-detent meter fader replaces the select; CONFIRMAR with a pending-change LED; LIMPIAR | ✅ 4 |
| D14 | `SYNC` / `SYNC ✓` / `MASTER` | Deck sync row, 3rd key | ✅ 2 |
| D15 | `ALIGN` / `NN%` | Deck sync row, 2nd key | ✅ 2 |
| D16 | `BAR SYNC` and states | Deck sync row, 1st key | ✅ 2 |
| D17 | `CUE` (momentary, CUP) | Deck transport column, round amber button | ✅ 2 |
| D18 | `PLAY` / `PAUSE` | Deck transport column, round green button with the `PLAY / PAUSE` caption | ✅ 2 |
| D19 | Jog wheel (decorative, spins at 33⅓ rpm × rate) | Deck, central row | ✅ 2 |
| D20 | Pitch fader (inverted, ±range labels) | Deck pitch column (right on A, left on B) with the `TEMPO` caption | ✅ 2 |
| D21 | Pitch Bend − / + | Directly below the pitch fader (REFACTOR_PROMPT §6) | ✅ 2 |
| new | `KEY LOCK` | Deck sync row, 4th key. Real implementation: AudioWorklet pitch shifter (see Step 2). | ✅ 2 |
| — | SYNC role badge `MASTER` / `SLAVE ← X` + tooltips | Deck notice strip | ✅ 2 |
| — | `PROVISIONAL` badge | Deck notice strip | ✅ 2 |
| — | ALIGN status badge (`Modulando… (NN%)`, …) | Deck notice strip | ✅ 2 |
| — | BAR SYNC status badge (`ARMADO`, …) + tooltips | Deck notice strip | ✅ 2 |
| — | `DOWNBEAT ✓ 4/4` | Removed from the deck in step 2 (02-03 §1). Replaced by the CONFIRMADO + source LEDs in module 5 / 6 (05-06 §1);  | ✅ 4 |
| — | `COMPÁS SIN CONFIRMAR` | Replaced by the module 5 / 6 LEDs (`SIN CONFIRMAR` / `CABEZAL` / `SUGERIDO` lit, `CONFIRMADO` off). The full text stays in the tooltip of the `SIN CONFIRMAR` LED zone, so the guidance is not lost. | ✅ 4 |
| — | `UNIDAD SIN CONFIRMAR` + note-value warning (§9.2) | An amber LED in module 5 / 6 with the full warning in its tooltip and accessible label (REFACTOR_PROMPT §6) | ✅ 4 |
| — | Downbeat editor status badge (`CONFIRMADO (MANUAL)` / `SUGERIDO (NO CONFIRMADO)` / `SIN CONFIRMAR`) and detail `{pos}s ({beats}/{unit})` | Module 5 / 6 status LEDs, plus the position display tooltip (`Downbeat confirmado: 12.480 s`) | ✅ 4 |
| — | `Confirmación no disponible: … SHA-256` warning | Tooltip of the dimmed CONFIRMAR (05-06 Messages) | ✅ 4 |
| — | Downbeat errors (`La posición debe ser…`, `Error al persistir…`) | Toasts (05-06 Messages) | ✅ 4 |
| — | BAR SYNC guidance / rejection line under the deck (`BAR SYNC: …`, §3.7) | Same line under the deck, plus the BAR SYNC key tooltip (02-03 §3) | ✅ 2 |
| — | Hot Cue pad tooltips (`Fijar` / `Saltar a` / `Eliminar Hot Cue N`) | Unchanged on the pads (also their accessible name) | ✅ 2 |
| — | CUE tooltip, Pitch Bend tooltips, SYNC / ALIGN / BAR SYNC tooltips | Unchanged on their controls | ✅ 2 |

### Central console (functional doc §2.2, §5)

| # | Element | New location | Step |
|---|---|---|---|
| C1 | `Consola de mezcla` + `En vivo` / `En espera` LED | Title and `En espera` dropped (04 §6, 07 §1). The red `EN VIVO` / `LIVE` LED (`ConsoleLiveIndicator`) is the first row of panel 7. | ✅ 5 |
| C2 / C4 | Deck A / Deck B track pickers (`V` / `N`) | Screen LOAD A / LOAD B keys and the menu view, with the same `V` / `N` bindings | ✅ 1 |
| C3 | REC panel (`ON` / `OFF`, `mm:ss`, `REC`, `5`) | Screen REC key with a built-in LED, plus the counter in the display corner while recording | ✅ 1 |
| C5 | Channel header: `A` / `B` badge, `CH 1` / `CH 2`, signal LED | Plain `CH 1` / `CH 2` text (no letter badge, 04 §1). The signal LED is right after the channel name, with the same tooltip and logic (REFACTOR_PROMPT §6). | ✅ 3 |
| C6–C8 | GAIN, HI, MID, LOW, FILTER (LPF / HPF) | Channel column, five stacked knobs, labels below, `LPF` / `HPF` left and right of FILTER | ✅ 3 |
| C9 | Channel `CUE` (PFL, visual only) | Below FILTER, a small key with an amber LED, still without audio effect | ✅ 3 |
| C10 / C11 | Channel fader + VU | Bottom of the column, no `VOL` label, the VU on the inner side (toward MASTER) | ✅ 3 |
| C12 | MASTER knob | Top of the MASTER column, slightly larger, no label, no double-click reset | ✅ 3 |
| C13 | Spectrum display / `Sin señal` / `Silenciado` | **Removed** (04 §3 / §6: the screen waveforms replace it). The `Silenciado` state stays visible through the dimmed MASTER arc and the MUTE LED. | ✅ 3 |
| C14 | `MUTE` (`B`) | Bottom of the MASTER column, a small key with a red LED | ✅ 3 |
| C15 | Master VU | Tall stereo meter (two bars, real L / R) in the MASTER column | ✅ 3 |
| C16 | Crossfader + `A` / `B` side lights | Full-width bottom row, with `← A` and `B →` as plain text whose brightness follows the real gains | ✅ 3 |
| C17 | Curve `CP` / `LIN` / `CUT` | Under the crossfader, centred. The `Curva` label is dropped (04 §4). | ✅ 3 |

### Toasts (functional doc §10.5) — all kept, same texts

| Toast | Triggered from |
|---|---|
| `Agregado a Deck X` / `No se pudo cargar en Deck X` / `Error al cargar en Deck X: …` | Screen menu loading (`libraryLoadFeedback.ts`) ✅ |
| `No se pudo leer la biblioteca.` | Screen menu, each time it opens ✅ |
| `Sesión guardada`, `La grabación terminó sin eventos…`, `Reproduce un deck…`, `Espera a que termine la exportación…`, `No se pudo cambiar el estado de la grabación.` | Screen REC key and the `5` shortcut (`sessionCaptureFeedback.ts`, unchanged) ✅ |

### Shortcuts (functional doc §11.1)

All unchanged, except that `V` / `N` now act as LOAD A / LOAD B (01) and that, while the screen menu is open, the plain arrows, Home, End, Enter and Esc go to the screen instead of MASTER and the crossfader.

### Simulated or partial items (functional doc §12) — relocated as they are

The channel CUE (PFL) has no audio. The jog wheel is decorative. The `loading` state is never set. `PREPARANDO…` is never visible. A Master-side SYNC break stays silent. The waveform supports click only. None of these were changed.
