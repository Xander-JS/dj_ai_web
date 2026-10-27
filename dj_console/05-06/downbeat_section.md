# Downbeat & Bar Module Layout (Section 5 — Deck A / Section 6 — Deck B)

Section 5 is the Downbeat & Bar module of Deck A. It is a wide, low horizontal strip located at the top left of the SYSTEM DJ console, directly above the Deck A body (Section 2) and to the left of the digital screen (Section 1).

Its purpose is to prepare the track before mixing: the DJ chooses where the first beat of the bar (downbeat) is, chooses the bar's meter, and confirms both. BAR SYNC (Section 2) is the only control that uses this confirmation, so this module is the place where the track is made ready for bar-level synchronization.

Section 5 (Deck A) and Section 6 (Deck B) are equivalent. They use the same component, the same controls and the same behavior. Section 6 is described in the last part of this document. Specifying Section 5 therefore also specifies Section 6.

## What This Section Does Not Contain

- Analysis, PROVISIONAL, SYNC, ALIGN and BAR SYNC notices: they are shown above the jog wheel in Section 2.
- The BAR SYNC button: it belongs to the sync row in Section 2.
- Downbeat or bar markers on the waveform: they do not exist in the current design.
- The badges `DOWNBEAT ✓ 4/4`, `COMPÁS SIN CONFIRMAR` and `UNIDAD SIN CONFIRMAR`: they are replaced by the status LEDs of this module and are no longer shown in Section 2.

## General Structure

The module is a dark graphite panel with slightly rounded corners and a thin border, slightly raised from the console surface, as an auxiliary hardware panel. It occupies the full width of its section.

At the top left there is a small silkscreen title:

`DOWNBEAT & COMPÁS · A`

The letter `A` uses the Deck A accent color, so the module is visually linked to its deck.

Below the title, the module is divided into four zones, arranged horizontally from left to right and separated by thin vertical divider lines, like the printed divisions of a real console:

1. Status LEDs.
2. Position and meter.
3. Source knob.
4. Actions.

The zones follow the order in which the DJ works: read the status, adjust the values, choose the source and confirm. Zones have generous spacing between them; controls must not look crowded.

## 1. First Zone: Status LEDs

Four small round LEDs stacked vertically, each followed by its label. The zone has no title; the LEDs are self-explanatory.

From top to bottom:

| LED | Label | Color when lit |
|---|---|---|
| 1 | `SIN CONFIRMAR` | Neutral gray |
| 2 | `CABEZAL` | Green |
| 3 | `SUGERIDO` | Amber |
| 4 | `CONFIRMADO` | Deck accent color |

LEDs that are off show a dark body with a thin gray border.

### Lighting rules

The LEDs answer one question: what is the downbeat status of this track?

**Before confirmation** (no valid manual confirmation for the loaded track), exactly one LED is lit, following the current position of the source knob:

- Knob at `OFF`: `SIN CONFIRMAR` is lit.
- Knob at `CAB`: `CABEZAL` is lit.
- Knob at `SUG`: `SUGERIDO` is lit.

**After confirmation**, two LEDs are lit at the same time:

- `CONFIRMADO`.
- The LED of the source used to confirm: `CABEZAL` or `SUGERIDO`.

This pair stays fixed for as long as the confirmation exists, even if the DJ later turns the knob or moves the meter fader. The knob shows the source selected now; the LEDs show the source that was confirmed.

A confirmation is valid only if it is linked to the SHA-256 fingerprint of the loaded audio file. If the file changes, the confirmation is degraded and the LEDs return to the before-confirmation rules.

## 2. Second Zone: Position and Meter

The widest zone of the module. It has two rows.

### Row 1: Mini digital displays

A single horizontal row with two small digital displays, each preceded by its label:

`POSICIÓN (S)  [ 00:42.318 ]          MÉTRICA  [ 4/4 ]`

- `POSICIÓN (S)` is aligned to the left of the zone; `MÉTRICA` is aligned to the right.
- Displays are small LCD-style rectangles: very dark blue background, thin border, monospaced cyan digits.

**Position display:**

- Shows only the current playhead time of the track, in `mm:ss.mmm` format.
- It updates continuously while the track plays and stays still while it is paused.
- It shows `00:00.000` when no track is loaded.
- Tooltip: the confirmed downbeat position, or the current candidate position if there is no confirmation (for example `Downbeat confirmado: 12.480 s`).

**Meter display:**

- Shows only the selected meter: `4/4`, `3/4`, `2/4` or `6/8`.
- It always reflects the current position of the meter fader.

### Row 2: Meter fader

A horizontal fader directly below the displays, using the full width of the zone. It has a recessed dark track and a small rectangular metallic knob.

The fader has four fixed positions (detents). The knob always snaps to one of them; there are no intermediate values.

Below the track, aligned with each position, there is a short tick mark and an informative label:

```
|---------------|---------------|---------------|
4/4            3/4             2/4             6/8
```

Meaning of each position (beats per bar / note value):

| Position | Beats per bar | Note value |
|---|---|---|
| `4/4` | 4 | 4 |
| `3/4` | 3 | 4 |
| `2/4` | 2 | 4 |
| `6/8` | 6 | 8 |

Interaction:

- Drag the knob, or click on the track, to move to the nearest position.
- Keyboard (with focus on the fader): left and right arrows move one position.
- Moving the fader updates the meter display immediately. It does not save anything by itself; the change must be confirmed.

Initial position when a track is loaded: the confirmed meter, or `4/4` if there is none.

## 3. Third Zone: Source Knob

A rotary selector with three positions, centered in its zone. It has a round dark body and a white indicator line that points to the selected position.

Printed labels around the knob:

- Left: `CAB` (Cabezal / playhead).
- Top: `OFF`.
- Right: `SUG` (Sugerido / suggested).

Below the knob, the caption `FUENTE`.

The label of the selected position is shown in white; the others in dimmed gray.

### Positions

| Position | Meaning | Candidate downbeat position |
|---|---|---|
| `CAB` | The downbeat is taken from the playhead | The playhead time at the moment the knob is turned to `CAB` |
| `OFF` | No source selected | None |
| `SUG` | The downbeat is taken from the analysis | The suggested position (`downbeat.suggestedPosition`, or `firstBeatTime` if it does not exist) |

### Interaction

- Clicking the knob turns it to the next position, in the order `CAB → OFF → SUG → CAB`.
- Clicking a printed label (`CAB`, `OFF`, `SUG`) turns the knob directly to that position.
- Keyboard (with focus on the knob): left and right arrows change the position.
- Turning the knob to `CAB` captures the current playhead time as the candidate position. To capture a new time, the DJ places the playhead at the desired point and selects `CAB` again.
- Turning the knob to `SUG` uses the suggested position from the analysis. If there is no suggested position, the `SUG` position is disabled and its label stays dimmed.
- In `OFF` there is no candidate position, so `CONFIRMAR` cannot be used.

Initial position when a track is loaded:

- If the track has a valid confirmation: the source used to confirm it.
- Otherwise, if a suggested position exists: `SUG`.
- Otherwise: `OFF`.

## 4. Fourth Zone: Actions

Two rectangular buttons stacked vertically.

### CONFIRMAR

The main button of the module. It has a small round LED on the left of its text.

Action: saves the manual confirmation of the downbeat and bar for this track:

- Downbeat position: the candidate position from the knob, rounded to milliseconds.
- Beats per bar and note value: from the meter fader.
- SHA-256 fingerprint of the file, date and origin `manual`.

After confirming:

- The status LEDs switch to `CONFIRMADO` plus the source LED.
- If the same track is loaded on the other deck, its module updates as well.
- Any outdated BAR SYNC preparation is invalidated.

**Pending-change LED:**

- The LED blinks amber when there is a change that has not been confirmed. This happens when:
  - there is no confirmation and the knob is at `CAB` or `SUG`, or
  - there is a confirmation, but the knob source, the candidate position or the meter no longer match it.
- The LED is off when what is selected matches what is confirmed, or when the knob is at `OFF`.
- The blinking invites the DJ to press `CONFIRMAR`; it never confirms by itself.

`CONFIRMAR` is dimmed and does nothing when:

- The knob is at `OFF`.
- There is no track loaded.
- The track has no valid SHA-256 fingerprint. Tooltip: `No se puede confirmar: la pista no dispone de huella SHA-256 válida`.
- A save is in progress.

### LIMPIAR

A secondary button below `CONFIRMAR`, with no LED.

Action: deletes the manual confirmation (downbeat and note value) of this track.

After clearing:

- `CONFIRMADO` turns off and the LEDs follow the knob again.
- Any outdated BAR SYNC preparation is invalidated.

`LIMPIAR` is dimmed and does nothing when there is no confirmation.

## Messages

Errors are shown as short notifications (toasts), and the cause of a disabled control is shown in its tooltip:

- `La posición debe ser un número válido entre 0 y la duración de la pista.`
- `Error al persistir downbeat en almacenamiento local.`
- `Confirmación no disponible: la pista carece de una huella SHA-256 válida.`

## States of the Whole Module

- No track loaded: all controls are dimmed, every LED is off and the position display shows `00:00.000`.
- Saving: all controls are temporarily disabled until the save finishes.
- Persistence: the confirmation is stored per track and is restored every time that track is loaded, on either deck.

## Relationship with Other Sections

- BAR SYNC (Section 2) requires a confirmed downbeat and a confirmed note value on both decks, with the same meter. If the `CONFIRMADO` LED is off on either deck, BAR SYNC will be rejected.
- ALIGN (Section 2) does not use this confirmation; it uses the provisional beatgrid from the analysis.
- The `PROVISIONAL` notice (Section 2) and the `SUG` position share the same origin: the first beat estimated by the analysis.

## Section 6 (Deck B): Equivalent Configuration

Section 6 uses exactly the same component, zones, controls, states and behavior as Section 5. Only its position and identity change:

- Position: top right of the console, directly above the Deck B body (Section 3) and to the right of the digital screen (Section 1).
- Zone order: keeps the same left-to-right order (status LEDs, position and meter, source knob, actions) so the module reads the same on both decks.
- Identity: the title reads `DOWNBEAT & COMPÁS · B`, and the Deck B accent color replaces the Deck A accent color in the title and the `CONFIRMADO` LED.

## General Layout Criteria

- The module is a single horizontal strip with four zones separated by thin vertical lines.
- The second zone (position and meter) is the widest; the other three have fixed widths.
- Status LEDs are stacked vertically and have no zone title.
- The two mini displays are small and share a single row; they show only their value.
- The meter fader has exactly four positions, with tick marks and labels below.
- The source knob has three positions: `CAB`, `OFF`, `SUG`.
- Spacing between zones and controls is generous; nothing should look crowded.
- Everything is perceived as part of the console hardware, not as a web form.
