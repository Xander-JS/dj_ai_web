# Master Mixer Layout

The SYSTEM DJ master mixer (section 4) will be located in the center of the console, between the Deck A and Deck B sections, and directly below the digital screen. Its layout will be organized into three vertical columns (CH 1, MASTER and CH 2) and a lower crossfader section that spans the full width of the mixer.

The mixer must be perceived as part of the same hardware surface as the decks: it is not a separate card or panel. The three columns will be separated only by thin, subtle vertical divider lines, and the crossfader section by a thin horizontal line.

## 1. Column Headers

At the top of each column, a reference label will be shown:

- Left column: `CH 1`
- Center column: `MASTER`
- Right column: `CH 2`

These labels will be displayed as plain text only: large and bold, centered over their column, with no background, border, badge or box around them. They do not include the deck letter (no `A · CH 1` or `B · CH 2`).

## 2. Channel Columns: CH 1 (Deck A) and CH 2 (Deck B)

Both channel columns will be identical in structure and arranged symmetrically. CH 1 controls Deck A and CH 2 controls Deck B. Each column retains its deck's distinctive color (the same colors used for that deck in the digital screen and deck sections) on the knob bodies, the fader cap and the level fill.

From top to bottom, each channel column will contain:

### 2.1 Rotary Knobs

Five rotary knobs stacked vertically and centered in the column:

1. GAIN
2. HI
3. MID
4. LOW
5. FILTER

Each knob's label will be placed directly below the knob, centered, in small secondary text. The labels must not appear to the side of the knobs.

FILTER is a special case because it has three positions. Its labels will be distributed around the knob:

- `LPF` to the left of the knob (low-pass side).
- `HPF` to the right of the knob (high-pass side).
- `FILTER` below the knob, like the other knobs.

Each knob will have a small white position indicator and a luminous arc. On GAIN, HI, MID, LOW and FILTER (bipolar controls) the arc starts from the center position.

### 2.2 CUE Button

Below the FILTER knob, a small rectangular `CUE` button with an LED, centered in the column. This is the channel pre-listen (PFL) button; it is not the same as the CUE button in the deck transport.

### 2.3 Channel Fader and Level Meter

At the bottom of the column, a vertical channel volume fader centered under the knobs, with a vertical channel level meter (VU) immediately next to it on the inner side (toward the MASTER column).

- The fader has no text label (no `VOL`).
- The level meter uses illuminated segments: green at the bottom, yellow in the middle and red at the top (clip).

## 3. Center Column: MASTER

The center column will be narrower than the channel columns and will contain, from top to bottom:

1. **MASTER knob:** A single rotary knob, slightly larger than the channel knobs, centered under the `MASTER` header. It has no label below it, because the header already identifies it. Its arc starts from the minimum position (unipolar control).
2. **Master level meter:** A tall stereo meter made of two parallel vertical bars (left and right), occupying most of the column's height, with green, yellow and red segments. It has no text label.
3. **MUTE switch:** A small rectangular `MUTE` control with an LED at the bottom of the column.

The master column will not contain the spectrum display.

## 4. Lower Section: Crossfader

Below the three columns, separated by a thin horizontal line, the crossfader section will span the full width of the mixer.

### 4.1 Crossfader Row

- A horizontal crossfader track, centered, with tick marks at 0, 25, 50, 75 and 100 % and a cap at the center by default.
- To the left of the track: the text `← A`, with the arrow pointing left.
- To the right of the track: the text `B →`, with the arrow pointing right.

The letters A and B will be displayed as plain text only, large and bold, with no circle, background or border around them. The section will not include a `Crossfader` label.

### 4.2 Curve Selector

Below the crossfader, three small buttons grouped together and centered: `CP`, `LIN` and `CUT`. Only one can be active at a time, and the active one is highlighted.

## 5. Behavior

### 5.1 Knobs

- Dragging vertically changes the value: 160 px covers the full range. Holding Shift gives fine adjustment (×4, 640 px).
- With keyboard focus, the arrow keys, Home and End change the value.
- Double-clicking GAIN, HI, MID, LOW or FILTER returns the knob to its default value (center, 50). The MASTER knob has no double-click reset.
- The knob graphics always reflect the stored value, so they also update when the value changes through a keyboard shortcut.

| Control | Effect |
|---|---|
| GAIN | Input gain, from 0.0× to 2.0× (center = 1.0×, max. +6 dB). |
| HI | High shelving at 2.5 kHz, ±12 dB. |
| MID | Peaking band at 1 kHz, ±12 dB. |
| LOW | Low shelving at 300 Hz, ±12 dB. |
| FILTER | Left of center: low-pass from 20 kHz down to 200 Hz. Center: neutral. Right of center: high-pass from 20 Hz up to 8 kHz. |
| MASTER | Output volume, 0–100 %. Initial value: 80 %. |

### 5.2 Channel CUE (PFL)

Pressing it toggles its LED and pressed state. It currently has no audio effect, because the audio engine has no headphone or pre-listen output.

### 5.3 Faders and Level Meters

- Dragging the fader cap moves it without jumping; clicking on the track moves the cap to that point. The arrow keys work with focus. Initial value: 80 %.
- The channel meter shows the real channel level after GAIN, EQ, FILTER and the channel fader, but before the crossfader and the master volume. It only moves while that deck is playing. The top red segment lights from level 95.
- The master meter shows the real mix level after the master volume. It drops to zero with MUTE on or when nothing is playing.
- Channel controls stay enabled even when the deck is empty; their values are kept for the next track.

### 5.4 MUTE

Sets the master output to zero while keeping the MASTER knob's nominal value; turning it off restores the output. While muted, the MASTER knob's arc is dimmed. Shortcut: `B`.

### 5.5 Crossfader and Curves

- Position 0 = only Deck A, 100 = only Deck B, 50 = center. Shortcut: `←` / `→` in steps of 5.
- The brightness of the `← A` and `B →` texts reflects the real gain applied to each side with the active curve.
- Curves:
  - `CP` (constant power): smooth blend, −3 dB at the center.
  - `LIN` (linear): A decreases and B increases proportionally.
  - `CUT` (fast cut / scratch): both sides at full level except at the very ends.
- Changing the curve recalculates the gains at the current position. The initial curve comes from Settings; the buttons only change it for the current session. Shortcut: `Shift + ←` / `→`.

## 6. Elements Moved Out of the Mixer

The following elements of the previous mixer will no longer appear in section 4:

- The `Mixing console` title and the `Live` / `Standby` LED: moved to the button panel next to the digital screen (section 7).
- The REC panel (`ON` / `OFF`, `mm:ss` time and `REC` button): moved to section 7.
- The `Load track…` selectors for Deck A and Deck B: moved to the upper area of each deck (sections 5 and 6).
- The 16-band spectrum display: removed, because the digital screen already shows the waveforms.

Their behavior does not change; only their location does.

## General Layout Criteria

- The mixer is organized into three vertical columns (CH 1, MASTER, CH 2) and a full-width crossfader section at the bottom.
- CH 1 and CH 2 are identical and symmetrical; the MASTER column is narrower and centered.
- Column headers and the crossfader letters are plain text: large, bold, with no background or border.
- Every knob label goes below its knob, except FILTER, which also has `LPF` on the left and `HPF` on the right.
- The channel faders, the master meter and the crossfader have no text labels.
- Each channel uses its deck's distinctive color; the MASTER column and the curve buttons use neutral colors, except for the highlighted active curve.
- Track information, waveforms, the jog wheels, Hot Cues and playback controls remain outside this section, in their respective areas of the interface.
