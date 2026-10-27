# Screen Side Panel Layout (Module 7)

The SYSTEM DJ screen side panel is a small vertical module attached to the right edge of the digital screen. It protrudes slightly over the upper edge of the console housing, between the digital screen and the Deck B identification area. It shares the screen's housing material: a black frame with slightly rounded edges and shadows that convey depth, so it reads as part of the same raised enclosure.

The panel groups the console's general status and the track management actions for both decks. These are infrequent actions that should stay away from the performance controls (jog wheels, Hot Cues, transport, and mixer).

Its layout is organized into a status row and a lower section with two deck columns.

## 1. First Row: Live Indicator

At the top, a single row contains a circular LED followed by the fixed text `EN VIVO` / `LIVE`.

- The text is always visible and never changes.
- The LED is the only element that changes:
  - **On (red):** at least one deck is playing.
  - **Off (dark gray):** both decks are stopped or paused.
- It is read-only and has no interaction.
- A thin horizontal line separates this row from the lower section.

This indicator replaces the `En vivo` / `En espera` LED in the mixing console header (C1). The `En espera` / `Standby` text is no longer shown: an unlit LED already communicates that state.

## 2. Lower Section: Deck Columns

Below the separator, the panel is divided into two columns of equal width:

- First column: Deck A.
- Second column: Deck B.

Each column contains, from top to bottom:

1. The deck letter (`A` or `B`).
2. The `Expulsar` / `Eject` button.
3. The `Referencia` / `Reference` button.

### Deck Letters

The letters `A` and `B` are plain reference text. They are bold, slightly larger than the button labels, and use the panel's light text color. They have no badge, background, border, or deck color.

## 3. Button Design

The four buttons are identical in size and appearance, and they look like physical buttons mounted on the panel: a matte dark gray surface, slightly raised, with a short downward movement when pressed.

- **Fixed labels:** each button only shows its text (`Expulsar` / `Eject` or `Referencia` / `Reference`). No icons, no subtitles, and the text never changes.
- **No visual state changes on the button body:** the background, text color, and size stay the same in every situation.
- **LED border:** the button border is the only state indicator and works like an LED ring around the button.
  - **Lit:** the border shines in the deck's color (Deck A purple, Deck B green), matching the colors used on the digital screen.
  - **Off:** the border becomes a dark tone almost identical to the panel, so it looks unlit.

The user reads the state of each button only by whether its border is lit.

## 4. Functional Behavior

### Eject Button (D1)

This button replaces the `⏏` button in the deck header.

**LED border:**

- Lit while the deck has a track loaded.
- Off when the deck is empty.

**When pressed:**

- **Deck paused or stopped:** the track is ejected immediately.
- **Deck playing:** the button must be held for 0.8 seconds. During the hold, the border blinks quickly as a warning. Releasing before 0.8 seconds cancels the ejection and the border stays lit. This prevents accidental ejections during a live set.
- **Deck empty:** no action.

**Ejecting** runs the existing `unloadDeck` action:

- Cancels a CUP preview.
- Cancels ALIGN on both decks.
- Breaks the SYNC/MASTER relationship.
- Returns the other deck's BAR SYNC to idle if it was `ARMADO` / `ALINEADO`.
- Keeps the pitch fader position.
- Records the event in the session capture.

After ejecting, the borders of both buttons in that column turn off.

Tooltip: `Descargar pista de este deck` / `Unload track from this deck`. Accessible label: `Expulsar pista` / `Eject track`.

### Reference Button (D2)

This button replaces the target button in the deck header.

**LED border:**

- Lit when the loaded track is marked as a reference (seed).
- Off when it is not marked, or when the deck is empty.

**When pressed:**

- With a track loaded, it toggles the reference state (`useSeedStore.toggleSeed(trackId)`), and the border turns on or off accordingly.
- Without a track, it does not respond.

The reference state belongs to the track, not to the deck. Loading a track that was already marked lights the border immediately.

It has no audio effect.

Tooltip: `Marcar como pista de referencia` / `Quitar pista de referencia`. The `aria-pressed` attribute reflects the state, so screen readers can announce what the border shows visually.

## General Layout Criteria

- The buttons are fixed physical controls: their label, color, and shape never change. State is communicated only through the LED border.
- The live indicator follows the same principle: fixed text, with only the LED turning on or off.
- The Deck A and Deck B columns are symmetrical. The only visual difference is the color of their LED borders.
- The deck letters are plain bold text without any decorative style.
- The panel contains only the live indicator, Eject, and Reference. Transport controls, Pitch Bend, channel signal LEDs, and error messages remain in their respective areas of the interface.
