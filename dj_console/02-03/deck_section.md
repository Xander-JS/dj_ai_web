# Deck Section Layout (Section 2 — Deck A / Section 3 — Deck B)

Section 2 is the main body of Deck A, located on the left side of the SYSTEM DJ console, directly below Section 5 (Downbeat & Bar module) and to the left of the central mixer (Section 4). It contains the controls the DJ uses while performing: the jog wheel, transport, synchronization, Hot Cues and tempo.

Deck A (Section 2) and Deck B (Section 3) are equivalent. They use the same component, the same controls and the same behavior. Deck B is a horizontal mirror of Deck A, as described in the last section of this document. Specifying Section 2 therefore also specifies Section 3.

Together with the digital screen (Section 1), this completes the modeling of Sections 1, 2 and 3.

## What This Section Does Not Contain

- Song title, artist and waveform: they are shown on the digital screen (Section 1).
- Technical data (BPM, Time, Key, Camelot, Energy): shown on the digital screen (Section 1).
- Downbeat & Bar controls (status LEDs, position and meter displays, meter fader, source knob, Confirm and Clear): they belong to Section 5 (Deck A) and Section 6 (Deck B).
- Mixer controls (gain, EQ, filter, channel fader, crossfader): they belong to Section 4.

## General Structure

The section is a dark rectangular hardware panel with slightly rounded corners, a matte black finish and subtle borders, integrated into the console housing.

Internally it is organized as a grid of three columns and four rows:

- Left column (transport column): approximately 20% of the width. Holds CUE and PLAY/PAUSE.
- Central column (main column): the widest column. Holds the sync row and the Hot Cues.
- Right column (pitch column): approximately 9% of the width. Holds the tempo (pitch) fader.

Rows, from top to bottom:

1. Informative notices.
2. Jog wheel.
3. Sync row.
4. Hot Cues.

The first two rows span the left and central columns. The pitch column spans rows 2 to 4.

## 1. First Row: Informative Notices

A horizontal strip of small badges, centered above the jog wheel. Each badge is a small rectangle with a thin colored border and uppercase text. Badges appear only when their state applies; the strip wraps if needed.

Notices shown in this strip:

- Analysis status: `PENDIENTE`, `ANALIZANDO...`, `ANALIZADO`, `ERROR` or `NO COMPATIBLE`. In `PENDIENTE` and `ERROR` the badge is interactive: clicking it (or Enter/Space) starts the musical analysis.
- `PROVISIONAL`: the beatgrid is estimated from the first detected transient. Read-only.
- SYNC role: `MASTER` or `SLAVE ← B`. Hidden when SYNC is not active.
- ALIGN status: `MODULANDO... (NN%)`, `MANIOBRA FINALIZADA`, `CANCELADO`, `EN TOLERANCIA (<1ms)` or a rejection reason. Hidden while ALIGN is idle.
- BAR SYNC status: `ARMADO`, `ALINEADO`, `LISTO`, `CANCELADO` or `RECHAZADO`. Hidden while BAR SYNC is idle.
- Reference track: `REFERENCIA N`, when the track is marked as a seed.

Downbeat and meter badges (`DOWNBEAT ✓ 4/4`, `COMPÁS SIN CONFIRMAR`, `UNIDAD SIN CONFIRMAR`) are not shown here; Section 5 already communicates that state with its LEDs and displays.

Badge colors carry meaning: green for completed analysis, amber for provisional or warning states, the deck color for SYNC and BAR SYNC states, red for rejections, and neutral gray for informational states.

## 2. Second Row: Jog Wheel

The jog wheel is the dominant element of the section. It is a large circle, centered horizontally over the transport and main columns, and occupies most of the section's upper half.

It is built from concentric layers:

- An outer metallic ring with fine radial ticks.
- A dark platter.
- An inner ring.
- A central label in the deck color, showing a short vertical position marker, the deck letter (`A`) and the text `JOG`.

Behavior:

- The jog wheel rotates only while the deck is playing, at 33⅓ rpm scaled by the actual playback speed.
- It is decorative: it does not respond to clicks, drags or keyboard input (no scratch, nudge or search).

## 3. Third Row: Sync Row

A row of four rectangular buttons of equal size, placed in the central column directly below the jog wheel. The row has exactly the same width as the Hot Cue grid below it, and its four columns align with the four columns of pads.

From left to right:

1. `BAR SYNC`
2. `ALIGN`
3. `SYNC`
4. `KEY LOCK`

Each button has a dark raised body, a thin border and uppercase text only (no icons). Active states are shown by changing the border and text color, without changing the button's size or position.

### BAR SYNC

Prepares this deck, while stopped or paused, at the same bar phase as the Master deck that is playing, using the confirmed downbeats.

- Visible states: `BAR SYNC` (idle), `ARMADO` (amber), `ALINEADO` (deck color), `LISTO` (green), `RECHAZADO` (red).
- Clicking while `ARMADO` or `ALINEADO` cancels the preparation.
- When it cannot be used, a short guidance line starting with `BAR SYNC:` appears below the deck, and the reason is added to the button's tooltip.

### ALIGN

Gradually aligns the beat phase of this deck with the other deck, using a temporary speed ramp.

- Enabled only when a track is loaded and the deck is playing.
- While active, the button shows the progress percentage (`NN%`) and pulses; clicking it cancels the maneuver.
- Result states change the border color: green when finished, red when rejected.

### SYNC

Matches this deck's BPM to the Master deck's BPM by adjusting the pitch. It never changes the phase.

- Visible states: `SYNC` (idle), `SYNC ✓` (filled with the deck color, slave active) and `MASTER` (amber, this deck is the tempo reference).
- Clicking `SYNC ✓` turns SYNC off while keeping the current speed.
- If SYNC is rejected, the reason is shown on the digital screen in place of this deck's artist name.

### KEY LOCK

Keeps the musical key of the track fixed when the tempo changes. With KEY LOCK on, moving the pitch fader changes the speed but not the pitch of the notes, so voices and melodies keep their original key.

- Toggle button. Off: neutral style. On: border and text in the deck color.
- This control is new: the store already declares `isKeyLocked` and `toggleKeyLock`, but there is no implementation yet.

## 4. Fourth Row: Hot Cues

Located in the central column, below the sync row.

Header line:

- Left: the label `HOT CUES`.
- Right: a small `BORRAR` button that toggles delete mode. It is highlighted while active and disabled when there are no Hot Cues.

Below the header, a grid of eight square pads in two rows and four columns, with equal spacing. These are the largest buttons of the section after CUE and PLAY/PAUSE.

Each slot has a fixed color: 1 red, 2 orange, 3 yellow, 4 green, 5 turquoise, 6 light blue, 7 purple, 8 magenta.

Pad states:

- Empty: dark base with a thin top accent in the slot color; shows the slot number and `—`.
- Saved: background tinted and border in the slot color; shows the slot number and the position `m:ss`.
- Delete mode: red border and text on saved pads.
- Disabled (no track loaded): reduced opacity.

Interaction:

- Click on an empty pad: saves a Hot Cue at the current playhead position.
- Click on a saved pad: jumps to that position, keeping play or pause.
- Click with delete mode active, Shift+click or right click on a saved pad: deletes it.
- Keyboard: Deck A uses `1`–`4` for slots 1–4. Slots 5–8 are mouse only.

## 5. Left Column: CUE and PLAY/PAUSE

Two circular buttons of the same size, stacked vertically and centered in the transport column.

Vertical alignment: the column spans from the top edge of the sync row to the bottom edge of the last row of Hot Cues. The top of the CUE button aligns with the top of `BAR SYNC`, and the bottom of the PLAY/PAUSE button aligns with the bottom of the last row of pads. The space between both buttons is distributed automatically.

Horizontal spacing: the column leaves a generous margin on both sides of the buttons, so they do not touch the panel edge or the main column.

Both buttons must always remain perfect circles, regardless of the available space.

### CUE

- Circular button with the text `CUE`, amber border and amber text.
- Behavior depends on the CUE mode in Settings:
  - `cdj` (default): pressing while playing pauses and returns to the CUE point. Pressing while paused sets the CUE point if the playhead moved, and plays from it while held (CUP); releasing pauses and returns to the CUE point.
  - `standard`: pressing while playing jumps to the CUE point and keeps playing. Paused behavior is the same as `cdj`.
- Shows an amber highlight while pressed.
- Keyboard: `Q` (held).

### PLAY/PAUSE

- Circular button with play and pause icons, green border and green icons.
- Above the button, a small label: `PLAY / PAUSE`.
- Pressing toggles playback. Play resumes from the current position; pause keeps the exact position.
- If BAR SYNC is armed or aligned, Play starts the deck in phase with the Master.
- Keyboard: `F + Space`.

## 6. Right Column: Pitch (Tempo) Fader

A vertical rectangular fader, taller than it is wide, located at the right edge of Deck A.

Vertical position:

- Its top edge starts at approximately the lower half of the jog wheel.
- Its bottom edge aligns with the bottom edge of the last row of Hot Cues.

Structure, from top to bottom:

- `−8%` label at the top.
- A recessed vertical track with a center line in the deck color marking 0%.
- A rectangular metallic knob with a horizontal indicator line.
- `+8%` label at the bottom.
- The caption `TEMPO`.

Behavior:

- The fader is inverted, as on a CDJ: moving up lowers the tempo and moving down raises it.
- The range labels follow the pitch range set in Settings (±6, ±8 or ±16%).
- Moving the fader changes the playback speed. Without KEY LOCK it also changes the pitch of the notes.
- Moving this deck's fader while it is the SYNC slave turns SYNC off. Moving it while it is the Master propagates the new tempo to the slave.
- Disabled when no track is loaded.

## Colors and Materials

- Housing and panel: matte black and graphite gray.
- Buttons: dark raised bodies with thin gray borders.
- Text and labels: white or light gray, uppercase.
- Deck A accent color: used for the jog wheel center, the pitch center line, and the active states of SYNC and KEY LOCK.
- Fixed colors: amber for CUE, green for PLAY/PAUSE, and the eight slot colors for the Hot Cues.

## Deck B (Section 3): Mirror Configuration

Deck B uses exactly the same component, controls, states and behavior as Deck A. Only its position and identity change:

- Mirrored layout: the pitch fader moves to the left edge of the deck, and the CUE and PLAY/PAUSE column moves to the right of the Hot Cues. The jog wheel, the sync row and the Hot Cue grid keep their order from top to bottom.
- Sync row order: keeps the same left-to-right order (`BAR SYNC`, `ALIGN`, `SYNC`, `KEY LOCK`) so that text reads the same on both decks.
- Identity: the jog wheel shows the letter `B`, and the Deck B accent color replaces the Deck A accent color.
- Texts that name the opposite deck change accordingly (`SLAVE ← A`).
- Keyboard: CUE `I`, PLAY/PAUSE `J + Space`, Hot Cues `7`, `8`, `9`, `0` for slots 1–4.

## General Layout Criteria

- The jog wheel has visual priority and is the largest element of the section.
- The sync row and the Hot Cue grid share the same width and column alignment.
- CUE and PLAY/PAUSE always remain circular and span from the top of the sync row to the bottom of the Hot Cues.
- The pitch fader starts at the lower half of the jog wheel and ends aligned with the bottom of the Hot Cues.
- Informative notices sit above the jog wheel and appear only when their state applies.
- Deck A and Deck B are symmetrical mirrors with identical behavior, distinguished only by position, letter and accent color.
- Everything is perceived as a single hardware surface, not as separate cards.
