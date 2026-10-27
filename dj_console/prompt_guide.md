# Prompt: Recreate a Professional DJ Console Using HTML and CSS

Design a web interface that visually reproduces the physical structure of a professional DJ console, using the provided image as a reference. The goal is to recreate its layout, proportions, materials, controls, and appearance using HTML, CSS, and interactive components.

## 1. General Structure

The console should be represented as a large horizontal rectangle with slightly rounded corners, a dark housing, and the appearance of professional audio equipment.

The main surface should have a matte black finish, with subtle metallic reflections, defined edges, shadows, and small details that simulate the relief of a physical console.

The entire interface should function as a single visual unit, even though it is internally divided into three main sections:

- Left Deck: Controls and playback for the first track.
- Central Mixer (Master Mixer): General mixing and volume controls.
- Right Deck: Controls and playback for the second track.

The three sections should be aligned horizontally, integrated into a single housing, and visually separated by subtle divisions, thin lines, and differences in relief.

## 2. Upper Digital Screen

A rectangular module representing an integrated digital screen should protrude from the upper central part of the console, housed in a raised enclosure.

This module should have:

- A black frame with slightly rounded edges.
- A wide rectangular screen.
- A slight tilt or optional visual perspective.
- Shadows that convey depth.
- A small button panel above or around the screen.

The screen should look like an independent physical component that protrudes from the main surface while remaining structurally connected to it.

## 3. Left Deck: First Track

The left Deck should occupy approximately 35% of the console's width.

Its layout should include:

Upper section: Small rotary knobs, configuration buttons, and auxiliary controls.

Central area: A large circular jog wheel resembling a playback disc. It should feature several concentric rings, a circular center, and metallic details around the edge. Use gradients, inner shadows, and borders to simulate depth.

Lower section: Two circular playback and navigation buttons, along with a matrix of eight square buttons arranged in two rows and four columns.

The eight buttons should represent performance pads or hot cues, used to trigger specific points in a song. Each button should have defined edges, a slightly raised surface, and visual states using colored illumination.

Side section: Include a vertical slider control for adjusting the track's tempo.

## 4. Central Mixer (Master Mixer)

The central mixer should occupy approximately 30% of the total width.

It should be distinguishable from the two Decks through a more compact and symmetrical vertical arrangement.

Include:

- Two columns of rotary controls for the left and right channels.
- Three-band equalizers for each channel: bass, midrange, and treble.
- Gain and volume controls.
- Vertical audio level indicators.
- Vertical volume faders for each channel.
- A horizontal crossfader at the bottom.
- Audio selection, monitoring, and configuration buttons.

The controls should have a realistic physical appearance: dark circular bodies, small white indicators, and shadows that simulate raised rotary knobs.

The level indicators can use illuminated green, yellow, and red segments.

## 5. Right Deck: Second Track

The right Deck should be visually equivalent to the left one, maintaining the same layout and proportions.

It should include:

- Auxiliary controls at the top.
- A large circular jog wheel in the center.
- Playback and navigation buttons.
- Eight performance pads in a grid of four columns and two rows.
- A vertical tempo fader.
- Sync and configuration buttons.

Both Decks should maintain clear visual symmetry, although each may have its own states, illumination colors, and track information.

## 6. Materials, Colors, and Lighting

Use a color palette inspired by professional DJ equipment:

- Matte black for the main housing.
- Graphite gray for secondary panels.
- Metallic gray for edges and control surfaces.
- White for labels and markings.
- Blue, green, yellow, and occasionally red for illuminated indicators.

Apply subtle gradients, inner shadows, small reflections, and differences in elevation to achieve a three-dimensional appearance without relying on external images.

The buttons should look like physical components mounted on the surface, not simple flat elements on a web page.

## 7. CSS Implementation

Build each part as an independent component:

- `DJConsole`: General housing.
- `DigitalScreen`: Upper screen.
- `Deck`: Reusable structure for both tracks.
- `JogWheel`: Circular disc.
- `PerformancePads`: Eight-button grid.
- `DeckControls`: Auxiliary and playback controls.
- `TempoSlider`: Vertical tempo control.
- `MasterMixer`: Central mixer.
- `ChannelStrip`: Individual channel controls.
- `VolumeFader`: Volume slider.
- `Crossfader`: Horizontal mixing slider.

Use CSS Grid to distribute the three main sections and Flexbox to organize the internal controls. Use borders, gradients, shadows, and pseudo-elements to simulate materials and physical relief.

Define dimensions and proportions using CSS variables to facilitate future adjustments.

The console should preserve its horizontal structure and proportions when the window is resized, adapting to smaller screens without disrupting the controls' arrangement.

## 8. Expected Result

The final interface should resemble a professional DJ console viewed from above and slightly from the front, with a rectangular housing, two symmetrical Decks, a central mixer, and a raised digital screen.

Priority: Respect the physical layout, proportions, visual hierarchy, and appearance of the components. Do not turn the console into a conventional dashboard or distribute its controls into separate cards. Everything should be perceived as a single hardware surface recreated using CSS.

The implementation should use actual HTML elements and CSS, with JavaScript or React only when necessary to add interactivity.