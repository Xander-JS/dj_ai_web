/**
 * SYSTEM DJ — Test Suite: Entrada del Mixer, Expulsar / Referencia en los decks y EN VIVO en la
 * pantalla. El panel junto a la pantalla ya no existe; sus funciones viven en cada deck y en la
 * botonera de la pantalla.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), 'utf-8');
const exists = (file: string) => fs.existsSync(path.resolve(root, file));
const locale = (lang: string) => JSON.parse(read(`src/i18n/locales/${lang}/translation.json`));

describe('Panel junto a la pantalla — retirado', () => {
  it('no quedan sus componentes, modelo, estilos ni claves', () => {
    for (const file of [
      'src/components/dj/organisms/ScreenSidePanel.tsx',
      'src/components/dj/organisms/ScreenSidePanel.css',
      'src/components/dj/molecules/SidePanelDeckColumn.tsx',
      'src/components/dj/molecules/SidePanelDeckColumn.css',
      'src/components/dj/atoms/ConsoleRingKey.tsx',
      'src/services/console/sidePanelModel.ts',
    ]) {
      assert.equal(exists(file), false, `${file} debe eliminarse`);
    }
    const consoleCode = read('src/components/dj/organisms/DJConsole.tsx');
    assert.doesNotMatch(consoleCode, /ScreenSidePanel/);
    assert.doesNotMatch(read('src/components/dj/organisms/DJConsole.css'), /side-panel/);
    for (const lang of ['es', 'en']) {
      const json = locale(lang);
      assert.equal(json.mixer.side_panel, undefined, `mixer.side_panel sobra en ${lang}`);
      assert.equal(json.dj.eject_hold_hint, undefined, `dj.eject_hold_hint sobra en ${lang}`);
    }
  });
});

describe('EN VIVO / EN ESPERA en la pantalla', () => {
  it('cierra la botonera por la derecha, después de REC', () => {
    const row = read('src/components/dj/molecules/ScreenButtonRow.tsx');
    assert.ok(row.indexOf('screen-key-rec') < row.indexOf('screen-button-row__status'));
    assert.match(read('src/components/dj/molecules/ScreenButtonRow.css'), /grid-auto-flow: column/);
  });

  it('tiene texto en ambos idiomas para los dos estados', () => {
    assert.equal(locale('es').mixer.standby, 'EN ESPERA');
    assert.equal(locale('en').mixer.standby, 'STANDBY');
    assert.equal(locale('es').mixer.live, 'EN VIVO');
    assert.equal(locale('en').mixer.live, 'LIVE');
  });
});

describe('Expulsar y Referencia en cada deck', () => {
  const utility = read('src/components/dj/molecules/DeckUtilityButtons.tsx');
  const button = read('src/components/dj/atoms/HardwareButton.tsx');
  const buttonCss = read('src/components/dj/atoms/HardwareButton.css');
  const feedback = read('src/services/console/deckUtilityFeedback.ts');

  it('reutilizan unloadDeck y toggleSeed con su aviso', () => {
    assert.match(feedback, /djStore\.unloadDeck\(deckId\)/);
    assert.match(feedback, /seedStore\.toggleSeed\(trackId\)/);
    assert.match(feedback, /'dj\.toast_ejected'/);
    assert.match(feedback, /'dj\.toast_reference_removed'/);
    assert.match(feedback, /'dj\.toast_reference_set'/);
  });

  it('Expulsar es hundido y Referencia enclavable con aria-pressed; ambos se desactivan sin pista', () => {
    assert.match(utility, /variant="momentary"[\s\S]*disabled=\{!ejectEnabled\}/);
    assert.match(utility, /variant="latching"[\s\S]*disabled=\{!referenceEnabled\}[\s\S]*aria-pressed=\{referenceLit\}/);
    assert.match(button, /<button\s+type="button"/);
  });

  it('la luz sale del icono y el botón baja 2 px al pulsarlo', () => {
    assert.match(buttonCss, /\.hw-button__cap\.is-lit \.hw-button__icon \{\s*filter:/);
    assert.match(buttonCss, /translateY\(2px\)/);
    assert.match(buttonCss, /prefers-reduced-motion: reduce/);
  });

  it('Deck A los pone en su esquina izquierda (Auto Loop sobre el fader de tempo) y Deck B en espejo', () => {
    const css = read('src/components/dj/organisms/Deck.css');
    assert.match(css, /grid-template-areas: "utility notices \.";/);
    assert.match(css, /\.dj-deck\.deck-b \.deck-panel__top \{\s*grid-template-areas: "\. notices utility";/);
    assert.match(css, /"top top loop"\s*"jog jog pitch"/);
    assert.match(css, /"loop top top"\s*"pitch jog jog"/);
  });

  it('los avisos están traducidos con la letra del deck', () => {
    const es = locale('es').dj;
    const en = locale('en').dj;
    assert.equal(es.toast_ejected, 'Canción expulsada del Deck {{deck}}');
    assert.equal(en.toast_ejected, 'Track ejected from Deck {{deck}}');
    assert.equal(es.toast_reference_set, 'Referencia marcada en Deck {{deck}}');
    assert.equal(en.toast_reference_set, 'Reference set on Deck {{deck}}');
    assert.equal(es.toast_reference_removed, 'Referencia quitada en Deck {{deck}}');
    assert.equal(en.toast_reference_removed, 'Reference removed from Deck {{deck}}');
    assert.ok(es.reference_short && en.reference_short);
  });
});

describe('Entrada del Mixer', () => {
  const css = read('src/pages/MixerEntrance.css');
  const hook = read('src/hooks/useMixerEntrance.ts');

  it('las versiones completa y breve definen su duración total en CSS', () => {
    assert.match(css, /\.mixer-entrance--full \{\s*--mixer-entrance-total: 4000ms;/);
    assert.match(css, /\.mixer-entrance--short \{\s*--mixer-entrance-total: 800ms;/);
    assert.match(hook, /'--mixer-entrance-total'/);
  });

  it('se salta con cualquier clic o tecla sin bloquear el evento', () => {
    assert.match(hook, /addEventListener\('pointerdown', finish, \{ capture: true, passive: true \}\)/);
    assert.match(hook, /addEventListener\('keydown', finish, \{ capture: true, passive: true \}\)/);
    assert.doesNotMatch(hook, /preventDefault|stopPropagation/);
  });

  it('no anima con movimiento reducido ni con las animaciones apagadas', () => {
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
    assert.match(hook, /useAnimationsEnabled\(\)/);
  });

  it('la barra lateral se retira en Mixer y una pestaña la muestra encima', () => {
    const layout = read('src/layouts/DesktopLayout.tsx');
    assert.match(layout, /isMixer && 'desktop-layout--mixer'/);
    assert.match(layout, /aria-expanded=\{sidebarPeek\.isOpen\}/);
    for (const lang of ['es', 'en']) {
      const nav = locale(lang).navigation;
      assert.ok(nav.sidebar_show && nav.sidebar_hide, `Faltan las claves de la pestaña en ${lang}`);
    }
  });
});
