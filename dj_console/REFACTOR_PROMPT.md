# Task: General refactor of the Mixer section (`/mixer`)

We are going to refactor the entire Mixer section of SYSTEM DJ. The full specification lives in the `dj_console/` folder at the root of the project. Implement it step by step, in the exact order defined below, and stop after each step.

## 1. Specification sources

`dj_console/` contains:

- `functional_mixer_documentation.md`: describes how the Mixer section currently works, every control it has, and how each one connects to the store (`useDJStore`) and the audio engine (`AudioEngineService`). This is the source of truth for **behavior**.
- `prompt_guide.md`: a high-level description of the intended visual design. Use it **only as a general reference**.
- `sketch.html`: the general sketch of the new layout. Each module is labeled with a number:
  - **1**: Digital screen
  - **2, 3**: Deck A, Deck B
  - **4**: Mixer / Master
  - **5, 6**: DOWNBEAT & COMPÁS (DOWNBEAT & BAR) panels for Deck A and Deck B
  - **7**: A small panel attached to the right edge of the digital screen (1)
- Five subfolders, one per module group. Each describes in much more detail how that module's elements are laid out and how they interact (e.g. `01/` includes the digital screen specification).

**Priority when sources conflict:** subfolders → `sketch.html` → `functional_mixer_documentation.md` (for behavior) → `prompt_guide.md`. The root-level files are a guiding model; the subfolders give the precise context.

## 2. Execution order and stopping rule

Execute the subfolders strictly in this order, one per step:

1. `dj_console/01`
2. `dj_console/02-03`
3. `dj_console/04`
4. `dj_console/05-06`
5. `dj_console/07`

**When you finish a step, stop and reply with only this message: "implementado carpeta XX"**, replacing XX with the folder you just completed (e.g. "Finalicé implementación carpeta 02-03"). Do not start the next step until I explicitly tell you to continue. I will review your work between steps.

Before writing any code in step 1, read the whole `dj_console/` folder (all root files and all subfolders) so you understand the complete target design. Then implement only what belongs to the current step.

## 3. Element inventory (do this before step 1)

Cross-check every control, indicator, badge, message and toast listed in `functional_mixer_documentation.md` against the subfolders and `sketch.html`. In the new design some elements move. For example, the waveforms move from the decks into the digital screen. No functionality may be lost silently.

Write the result to `dj_console/IMPLEMENTATION_NOTES.md`. For each element, record:

- where it lives in the new design;
- for any element without a defined placement, where you decided to put it and why.

This is how I will review your decisions, since your end-of-step reply will be only the completion message.

## 4. Scope and functional rules

- **Stay focused on this task.** Do not drift into unrelated improvements. You may modify other files when the Mixer refactor genuinely requires it, but think through each change in terms of how this section works and make sure nothing that currently works elsewhere in the app breaks.
- **Preserve existing behavior.** Keep the logic in `useDJStore`, `AudioEngineService` and related services intact. Only change them when a subfolder explicitly asks for a functional change, or when it is strictly necessary to support the new UI.
- Do **not** "fix" the items listed as simulated or partial in section 12 of the functional documentation unless a subfolder asks you to. Examples are the channel CUE (PFL) having no audio effect and the decorative jog wheel. Relocate them into the new design as they are.
- **Functional changes require tests.** At least one subfolder (notably `01`) specifies a functional refactor. Whenever you change behavior, write tests using the project's existing test setup that verify the new behavior and guard the existing one. At the end of every step, run the test suite, the type check, the linter and the build, and fix anything you broke before replying "Finalizar".
- **Reuse and clean up.** The current Mixer already has components that partially resemble the target design: `Deck`, `Waveform`, `MixerConsole`, `ConsoleKnob`, `ConsoleFader`, `ConsoleTrackPicker`, `ConsoleRecPanel`, and others. Reuse whatever fits. Delete components, styles, assets references and code that become unused after the refactor.

## 5. Design rules

### Visual assets
We already have downloaded visual assets in `public/assets/mixer/`. It is organized into several subdirectories of images. Use them. If an element you need has no asset, recreate it with CSS (gradients, shadows, borders, pseudo-elements). Do not use external images.

### Console material and themes
The console body uses the dark plastic texture we provided in the assets. The app must support both dark and light mode, but the console itself stays essentially the same in both, because its material is that dark plastic. Only minor details around it may adapt to the theme, such as surrounding backgrounds, transparencies or overlays. Follow the theming mechanism the app already uses.

### Atomic Design
The project follows Atomic Design. Apply the same concept: split the console into atoms, molecules and organisms where it makes sense. Use judgment and do not split just for the sake of it. The goal is that anyone who wants to change a specific part of the console can find it easily. Verify, case by case, whether a component belongs in the atomic structure or should stay where it is.

### Internationalization
Every visible text, tooltip, aria-label and message must be available in Spanish and English via the existing i18n setup (`src/i18n/locales/es` and `src/i18n/locales/en`). Reuse existing keys (`dj.*`, `mixer.*`, etc.) where they fit. Add or modify keys as needed. Delete keys that become unused after the refactor.

### Real-hardware philosophy
The interface must feel like a single physical DJ console, not a web dashboard. Avoid dropdown-heavy menus, lists of options, or card layouts where a real console would use a button, LED, knob, indicator or its screen. When you must decide where an element goes, ask yourself how real DJ hardware would present it.

### Design skills
Use my global skills **impeccable** and **design-taste-frontend** during every step. Read them before writing UI code. Apply them to everything the specification leaves open:
- spacing, alignment and typography details;
- interaction states (hover, focus, active, disabled);
- accessibility;
- micro-details that make the console feel like polished physical hardware.

They are a quality layer, not a source of design decisions. If a skill's guidance conflicts with the subfolders, `sketch.html`, our assets in `public/assets/mixer/`, or the dark-plastic console material, the specification always wins. Do not replace our assets, layout, proportions or palette with choices suggested by the skills. If you deviate from a skill's recommendation because of the spec, there is no need to note it; if you apply a skill to make a decision the spec didn't cover, record it in `IMPLEMENTATION_NOTES.md`.

## 6. Elements not yet modeled in the sketch

The following elements were not placed in our design. Add them as specified:

**Deck A and Deck B (each):**
- **Playback error message**: show it in the deck's identification row on the digital screen, replacing the title and artist in red, the way CDJs display errors on their screen. Keep `role="alert"`. The same row also shows the SYNC rejection messages described in §3.1 and §10.2 of the functional documentation.
- **Unconfirmed note value warning (downbeat editor)**: an amber LED/indicator in that deck's DOWNBEAT & COMPÁS panel, with the full warning text in its tooltip and accessible label.
- **Pitch Bend − / + (D21)**: place the two buttons directly below that deck's pitch fader (the vertical tempo slider). Keep their momentary behavior and active-state highlight.

**Central console:**
- **CH 1 and CH 2 signal LEDs (C5)**: place each LED next to its channel name (`CH 1` / `CH 2`). Keep their tooltip and lighting logic.

## 7. Responsive behavior and mobile mode

The console must scale with the device size while keeping its horizontal proportions and control arrangement.

On small devices (phones), entering the Mixer section switches to a dedicated full-screen landscape mode:

- Enter full screen and lock orientation to landscape. Portrait is too cramped for the console.
- Hide everything else in the app (navigation, header, sidebar, etc.). Only the console and its controls remain.
- Use the back gesture/button to leave the mode. It must always return to the Home panel, regardless of which section the user came from.

Handle the platform limitations gracefully:

- The Fullscreen API requires a user gesture.
- The Screen Orientation lock is unsupported on some browsers, notably iOS Safari.
- Provide fallbacks where needed, e.g. a "tap to start" overlay to trigger full screen, and a "rotate your device" overlay when the device is in portrait and the lock is unavailable. Both overlays must be translated.

## 8. Summary of each step's definition of done

- The current subfolder's specification is fully implemented.
- No existing Mixer functionality is lost.
- Tests are added for any functional change; tests, type check, lint and build all pass.
- Unused code and i18n keys are removed; new texts exist in Spanish and English.
- `dj_console/IMPLEMENTATION_NOTES.md` is updated.
- Your reply is only: **implementado carpeta XX**

## 9. Continuity between steps

I may clear the conversation between steps, so treat `dj_console/IMPLEMENTATION_NOTES.md` as your memory. Keep a "Progress" section at the top of it listing the completed folders and anything pending or relevant for the next step.

At the start of every step after a cleared conversation:
1. Re-read this prompt (`dj_console/REFACTOR_PROMPT.md`).
2. Read `IMPLEMENTATION_NOTES.md`.
3. Read the subfolder for the current step, plus any other `dj_console/` file you need.
Then implement only that step.
