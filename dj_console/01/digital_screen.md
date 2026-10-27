# Digital Screen — Layout and Interaction

Oct 25, 2026 · @Goloso

## Purpose and references

Build the SYSTEM DJ digital screen: a raised display module above the mixer with a five-button row, a normal view that shows both decks' tracks and waveforms, a menu view for loading tracks, and a confirmation dialog. Track loading and session recording move from the central mixer console to this screen.

This prompt replaces any previous version of the digital screen specification. Read before starting:

- `functional_mixer_documentation.md`: verified behavior of the Mixer page, cited as "functional doc §N". It is the source of truth for existing logic, store actions and UI strings.
- `prompt_guide.md`: hardware look of the console (materials, relief, lighting). The screen and its buttons must match it.
- Three attached HTML mockups: the normal view with the button row, the menu view, and the confirmation dialog. The numbers in this prompt (1–11) match the numbers in the mockups. The mockups define layout and hierarchy, not final styling.

Reuse existing logic wherever this prompt names it; do not duplicate it. All new UI text goes through i18n with both Spanish and English entries; strings below are given as `ES` / `EN`.

## Scope

In scope:

- The screen module and its five-button row (1–5).
- The normal view (6–11) and the REC counter.
- The menu view for loading tracks into Deck A and Deck B (6–10).
- The confirmation dialog for replacing a track that is playing (11).
- Keyboard and mouse navigation of the screen.
- Removing from the central console the controls that move to the screen.

Out of scope, covered by a separate prompt:

- The zoomed waveform with beats and bars that GRID enables. Here, implement only the GRID button and its on/off state (`gridEnabled`); the waveforms must not change when it is toggled.

No audio engine changes are required for this prompt.

## Physical module

The screen is a separate physical component that rises from the upper center of the console, as described in `prompt_guide.md` §2:

- A raised enclosure with a black frame, slightly rounded corners and shadows that convey depth.
- The five-button row sits on the top edge of the frame, above the display area.
- The display area is a wide dark rectangle that holds either the normal view or the menu view. It never shows jog wheels, Hot Cue pads, transport controls or mixer controls; those stay in their own areas of the console.
- The screen has exactly two views, `normal` and `menu`. The button row is visible in both.

## Button row (1–5)

Five rectangular buttons of equal width in one row, styled as backlit hardware keys. Labels are the same in both languages. Left to right:

| # | Label | Action | Lighting | Shortcut |
| --- | --- | --- | --- | --- |
| 1 | `MENU` | Opens the menu view on the last used subsection (LOAD A the first time). If the menu is open, closes it. | Lit while the menu is open | — |
| 2 | `GRID` | Toggles `gridEnabled`. Its visual effect is defined in a separate prompt. | Lit while `gridEnabled` is true | — |
| 3 | `LOAD A` | Opens the menu with LOAD A selected and focus on the track list. If the menu is open on LOAD A, closes it; if open on LOAD B, switches to LOAD A. | Deck A color while LOAD A is the active subsection | `V` |
| 4 | `LOAD B` | Same as LOAD A, for Deck B. | Deck B color while LOAD B is the active subsection | `N` |
| 5 | `REC` | Starts or stops session capture with `toggleSessionCaptureWithFeedback` (functional doc §5.4). Works in both views. | Built-in LED (below) | `5` |

**GRID while the menu is open.** Shown dimmed and does not respond, because the waveforms are hidden. Its state is kept.

**REC LED.** A small round LED to the left of the `REC` label, inside the button:

- Not recording: dark gray, visible as an unlit physical part.
- Recording: red, slow blink of about 1 Hz. With reduced motion (`prefers-reduced-motion` or the app's animation setting), steady red.
- If capture cannot start (no deck playing, or an export in progress), the LED stays off and the existing warning toast is shown.
- On stop, the LED turns off and the existing toasts apply (`Sesión guardada`, etc.).

The LED reflects the real state of `sessionCaptureControl`, not the click: starting capture with shortcut `5` also lights it.

## Normal view (6–11)

The normal view stacks four full-width rows and a two-column technical section. Waveforms have visual priority: they take the full width and most of the height. Deck A elements use the Deck A accent color and Deck B elements the Deck B accent color, the same tones as in `Deck.css`.

| # | Element | Content | Size |
| --- | --- | --- | --- |
| 6 | Deck A identification | Track title and artist of Deck A | Compact row |
| 7 | Deck A waveform | Waveform of the track on Deck A | Full width, tall |
| 8 | Deck B identification | Track title and artist of Deck B | Compact row |
| 9 | Deck B waveform | Waveform of the track on Deck B | Full width, tall |
| 10 | Deck A technical info | 2 rows × 5 columns | Left half |
| 11 | Deck B technical info | 2 rows × 5 columns | Right half |

**Identification (6, 8).** Title, then artist, truncated with an ellipsis. With no track, show the existing empty strings (`Sin pista` / `No Track Loaded`); with no artist, `Desconocido` / `Unknown`.

**Waveforms (7, 9).** Same data and behavior as the existing waveform (functional doc §6): peak bars from `analysis.waveformPeaks`, fixed full-track overview, deck-colored progress fill, 2 px red playhead, Hot Cue and main CUE markers, and click-to-seek with `seekDeck`. Unanalyzed tracks show only the baseline.

**Technical info (10, 11).** First row: headers `BPM`, `Time`, `Key`, `Camelot`, `Energy`. Second row: the values for that deck, as defined in functional doc §7.1:

| Header | Value | No data |
| --- | --- | --- |
| BPM | Effective BPM, 1 decimal (analyzed BPM × playback rate) | `—` |
| Time | Remaining time `-m:ss` | `-0:00` |
| Key | Detected key, only when analysis is `analyzed` | `—` |
| Camelot | Camelot code, only when analysis is `analyzed` | `—` |
| Energy | `N.0/10` | `—` |

Both columns share an identical structure so the decks can be compared at a glance.

**REC counter.** While recording, show a compact indicator in the top-right corner of the display area: a red dot and the elapsed time `mm:ss`.

- It exists only while recording and disappears on stop.
- Time updates every 500 ms, as the current REC panel does.
- It appears in both views, in the same position.
- In the normal view it must not cover the Deck A title (6): the title truncates to leave room. In the menu view it must not cover the `MENU` legend, which sits on the left.
- The dot blinks in sync with the REC LED and follows the same reduced-motion rule.

## Menu view (6–10)

The menu view replaces the whole content of the display area. In this view, numbers 6–11 refer to the menu mockups, not to the normal view.

**6. MENU container.** The parent container of 7, 8 and 9. Its legend `MENU` interrupts the top border line on the left. Implement it with native `<fieldset>` and `<legend>`. There is no separate title strip.

**7. Subsections.** A narrow left column with two entries, `LOAD A` and `LOAD B`, each in its deck's color. The active subsection is marked and sets the load target. Keep the structure open to more entries in the future.

**8. Search field.** Text input with placeholder `Buscar por título` / `Search by title`. Filters the list by title only, case- and accent-insensitive.

**9. Track list.** Reads the library from IndexedDB each time the menu opens, as the current picker does (functional doc §5.3). Columns, in this order:

| Column | Content | No data |
| --- | --- | --- |
| Title | Track title, truncated with an ellipsis | — |
| BPM | Analyzed BPM, rounded to an integer | `—` |
| Camelot | Camelot code, only when analysis is `analyzed` | `—` |
| Duration | `m:ss` | `—` |

- Artist is not shown.
- Numeric columns are right-aligned.
- The selected row is highlighted with the color of the active subsection's deck.
- The track already loaded on the target deck carries a subtle marker, distinct from the selection highlight.
- The list scrolls to keep the selected row visible.
- Empty library and no search results: reuse the existing strings for those states. Library read error: existing toast `No se pudo leer la biblioteca.`
- If the library does not store duration as metadata, report it before implementing; do not decode audio files to obtain it.

**10. Key bar.** Outside container 6, below it. Text depends on state:

| State | ES | EN |
| --- | --- | --- |
| Menu | `↑↓ moverse · Inicio/Fin primera/última · → entrar a la lista · ← volver a subapartados · Enter cargar · Esc salir` | `↑↓ move · Home/End first/last · → enter list · ← back to subsections · Enter load · Esc exit` |
| Confirmation dialog open | `Enter reemplazar · Esc cancelar` | `Enter replace · Esc cancel` |

The key bar is never dimmed.

## Navigation

The screen is operated with eight keys: `↑`, `↓`, `Home`, `End`, `→`, `←`, `Enter` and `Esc`. Menu focus is in one of three zones: subsections (7), search field (8) or track list (9).

| Key | In subsections | In track list | In search field |
| --- | --- | --- | --- |
| `↑` / `↓` | Change subsection | Move selection. `↑` on the first row moves focus to the search field | `↓` moves focus to the first row |
| `Home` / `End` | First / last subsection | First / last row | Native text-cursor behavior |
| `→` | Move focus to the list | No effect | Native behavior |
| `←` | No effect | Back to subsections | Native behavior |
| `Enter` | Move focus to the list | Load the selected row (see Loading) | Move focus to the first row |
| `Esc` | Close the menu | Close the menu | Clear the text; if already empty, close the menu |

**On open,** focus goes to the list. The selected row is the track loaded on the target deck; if none, the first row. Switching subsection applies the same rule.

**After loading,** the menu stays open with the same row selected. It closes only with `Esc`, `MENU`, or the LOAD button of the active subsection.

**Key capture.** While the menu view is open, the screen consumes the eight navigation keys and they do not reach the global shortcuts (functional doc §11.1): `↑`/`↓` do not change MASTER and `←`/`→` do not move the crossfader. Implement this with a screen-mode state that `keyboardShortcuts` checks before acting, not with scattered `stopPropagation` calls. All other shortcuts (transport, CUE, SYNC, Hot Cues, MUTE, REC, channel faders) keep working. While the search field has focus, letters and digits type into it and do not trigger shortcuts, as already happens with editable fields. With the menu closed, the eight keys return to their current functions.

**V and N shortcuts.** `V` acts as pressing LOAD A and `N` as pressing LOAD B, with the button-row logic. They replace their current behavior on the console pickers.

**Mouse.** Click a subsection to activate it. Click a row to select it; double-click to load it. The wheel scrolls the list. Click the search field to focus it.

## Loading tracks and confirmation dialog (11)

Loading uses `loadTrackToDeck`, the same process the current picker and the Library use, with all its side effects and toasts (functional doc §5.3): it breaks SYNC, cancels ALIGN, invalidates an armed BAR SYNC, and shows `Agregado a Deck X` or the matching error.

- **Target deck stopped, paused or empty:** `Enter` or double-click loads directly.
- **Target deck playing:** open the confirmation dialog instead of loading.
- **Same track already loaded on that deck:** do nothing.

**Confirmation dialog (11).** Centered over the display area, not over the page. The rest of the console stays fully operable.

| Part | ES | EN |
| --- | --- | --- |
| Title | `El Deck A está sonando` | `Deck A is playing` |
| Line 1 | `Sale: {título actual}` | `Out: {current title}` |
| Line 2 | `Entra: {título elegido}` | `In: {selected title}` |
| Buttons | `Cancelar`, `Reemplazar` | `Cancel`, `Replace` |

- Replace is highlighted with the target deck's color. Buttons do not mention keys; key bar 10 explains them.
- The menu container dims behind the dialog. Key bar 10 switches to its dialog text and stays undimmed.

Behavior:

- `Enter` or clicking Replace: loads the track, closes the dialog and returns to the list with the menu open.
- `Esc` or clicking Cancel: closes only the dialog. The menu stays open; a second `Esc` closes it.
- `Enter` is ignored for the first 300 ms after the dialog opens, so an accidental double press does not confirm.
- While the dialog is open, `↑`, `↓`, `←`, `→`, `Home` and `End` have no effect.
- Pressing `MENU`, `LOAD A` or `LOAD B` while the dialog is open acts as Cancel, then applies the button's action.
- If the deck stops playing while the dialog is open, the dialog stays; confirming still loads.

## Changes to the central mixer console

Remove from `MixerConsole` the top bar with the track pickers and the REC panel, since they now live on the screen:

- C2 and C4, the `Deck A` / `Deck B` pickers (`ConsoleTrackPicker`).
- C3, the REC panel (`ConsoleRecPanel`).

Keep the logic they used (`loadTrackToDeck`, `trackPickerBridge` if still useful, `sessionCaptureControl`, `sessionCaptureFeedback`) and connect it to the screen. Delete the visual components only if they end up unused. Keep header C1 (`Consola de mezcla` and the `En vivo` / `En espera` LED). Rebalance the freed space so the console keeps its proportions and symmetry.

## Accessibility

- Button row: real `<button>` elements; MENU, GRID, LOAD A, LOAD B and REC expose `aria-pressed` for their state. REC's accessible label stays as today: `Iniciar la grabación de la sesión` or `Detener y guardar la grabación`.
- Menu container: `<fieldset>` with `<legend>MENU</legend>`.
- Subsections and track list: `listbox` pattern with `aria-activedescendant`, so logical focus follows the selection without moving DOM focus on every row.
- Confirmation dialog: `role="alertdialog"` with its title and description linked. On open, focus goes to Replace; on close, it returns to the list row.
- REC counter: accessible text `Grabando, mm:ss` / `Recording, mm:ss`, not announced on every update.
- Deck color is never the only cue: the active subsection and the selected row also carry a border or marker.

## Acceptance criteria

- [ ] The screen renders as a raised module above the mixer, with the button row MENU, GRID, LOAD A, LOAD B, REC in that order, in both views.
- [ ] The normal view shows rows 6–11 with deck colors, and the technical info shows `—` when data is missing.
- [ ] MENU, LOAD A, LOAD B, `V` and `N` open, switch and close the menu as specified in the button table.
- [ ] GRID toggles its state and light without changing the waveforms, and is dimmed while the menu is open.
- [ ] With the menu open, `↑`/`↓` do not change MASTER and `←`/`→` do not move the crossfader; once closed, they do again.
- [ ] With the menu open, PLAY, CUE, SYNC, channel faders, MUTE and REC still respond to their shortcuts.
- [ ] Loading onto a stopped deck shows no dialog; loading onto a playing deck does.
- [ ] In the dialog, `Esc` closes it without closing the menu, and `Enter` within the first 300 ms does not confirm.
- [ ] After loading, the menu stays open and the new track shows the loaded marker.
- [ ] The search field filters by title, and typing in it does not trigger DJ shortcuts.
- [ ] The REC LED and counter reflect the real capture state, including when started with shortcut `5`.
- [ ] The central console no longer shows the track pickers or the REC panel, and keeps its proportions.
- [ ] All new strings exist in both the Spanish and English locales.
