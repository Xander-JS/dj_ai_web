/**
 * SYSTEM DJ — Test Suite: Ajustes de interfaz
 * Confirmaciones rápidas (toasts) fuera del flujo, barra de reproducción retirada solo en
 * Mixer, Play/Pausa de playlists con icono y ancho de contenido compartido.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ToastStore, TOAST_DURATION_MS } from '../src/services/notifications/toastService.ts';

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Toasts', () => {
  it('apila el más reciente arriba y se retira solo tras la duración', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = new ToastStore();
      store.show('success', 'uno');
      store.show('error', 'dos');
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['dos', 'uno']);

      mock.timers.tick(TOAST_DURATION_MS - 1);
      assert.equal(store.getSnapshot().length, 2);
      mock.timers.tick(1);
      assert.equal(store.getSnapshot().length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('limita la pila a tres avisos y notifica a los suscriptores', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = new ToastStore();
      let calls = 0;
      store.subscribe(() => calls++);
      for (const text of ['a', 'b', 'c', 'd']) store.show('info', text);
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['d', 'c', 'b']);
      assert.equal(calls, 4);

      const [newest] = store.getSnapshot();
      store.dismiss(newest.id);
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['c', 'b']);
    } finally {
      mock.timers.reset();
    }
  });

  it('Inicio confirma las cargas con toasts en lugar de avisos en línea', () => {
    const dashboard = read('src/pages/Dashboard.tsx');
    const recommendations = read('src/components/dashboard/SmartRecommendationCard.tsx');
    assert.match(dashboard, /toastStore\.show\('success', t\('library\.load_success'/);
    assert.doesNotMatch(dashboard, /loadFeedback/);
    assert.doesNotMatch(recommendations, /dashboard\.load_deck_[ab]/);
    assert.match(read('src/components/molecules/ToastViewport.css'), /position: fixed/);
  });
});

describe('Shell — barra de reproducción en Mixer', () => {
  it('se retira solo en la ruta de Mixer sin desmontarse', () => {
    const layout = read('src/layouts/DesktopLayout.tsx');
    assert.match(layout, /pathname === NAV_SECTION_PATHS\.mixer/);
    assert.match(layout, /<PlayerBar hidden=\{isPlayerHidden\} \/>/);
    assert.match(read('src/layouts/PlayerBar.tsx'), /inert=\{hidden\}/);
  });

  it('respeta el movimiento reducido', () => {
    const css = read('src/layouts/DesktopLayout.css');
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /:root\[data-animations='off'\] \.layout-player/);
  });
});

describe('Playlists — Play/Pausa', () => {
  it('usa solo icono con nombre accesible traducido', () => {
    const playlists = read('src/pages/Playlists.tsx');
    assert.doesNotMatch(playlists, /\{isContextPlaying \? t\('player\.pause'\) : t\('common\.play'\)\}/);
    assert.match(playlists, /label=\{isContextPlaying \? t\('playlists\.pause_playlist'\) : t\('playlists\.play_sequential'\)\}/);
  });
});

describe('Marco global de la aplicación', () => {
  it('cabecera, área de trabajo y barra comparten un marco centrado del 92 %', () => {
    assert.match(read('src/index.css'), /--layout-frame-width: max\(92vw, min\(100vw - 2 \* var\(--layout-gutter\), 80rem\)\)/);
    const css = read('src/layouts/DesktopLayout.css');
    assert.match(css, /width: var\(--layout-frame-width\);\s+margin-inline: auto;/);
    assert.doesNotMatch(css, /width: 100vw/);
  });

  it('Home, Login y Registro usan el mismo marco que la consola', () => {
    assert.match(read('src/components/templates/LandingTemplate.css'), /\.sd-landing \{[^}]*width: var\(--layout-frame-width\);[^}]*margin-inline: auto;/);
  });

  it('las secciones no reducen su ancho por su cuenta', () => {
    assert.doesNotMatch(read('src/components/templates/ConsoleTemplate.css'), /--layout-content-inset/);
    assert.doesNotMatch(read('src/pages/Mixer.css'), /--layout-content-inset/);
  });

  it('los avisos fijos se alinean con el borde del marco', () => {
    assert.match(read('src/components/molecules/ToastViewport.css'), /right: calc\(\(100vw - var\(--layout-frame-width, 100vw\)\) \/ 2/);
  });
});

describe('Ajustes — columnas', () => {
  it('separa navegación y vista y las alinea por el borde superior de sus títulos', () => {
    const css = read('src/pages/Settings.css');
    assert.match(css, /align-items: start;\s+gap: var\(--sd-gap-6\);/);
    assert.match(css, /\.sd-settings__title,\s+\.sd-settings__view-title \{\s+text-box-trim: trim-start;\s+text-box-edge: cap alphabetic;/);
  });
});

describe('Home — recientes y recomendaciones', () => {
  it('la duración ocupa su columna y Play gana aire sin moverse', () => {
    const css = read('src/pages/Dashboard.css');
    assert.match(css, /grid-template-columns: 5rem 3rem 3\.25rem;/);
    assert.match(css, /\.sd-track-row__play \{[^}]*margin-left: var\(--sd-gap-1\);/);
    assert.doesNotMatch(css, /\.sd-track-row__duration \{[^}]*min-width/);
  });

  it('muestra una recomendación a la vez con navegación acotada y sin los textos retirados', () => {
    const card = read('src/components/dashboard/SmartRecommendationCard.tsx');
    assert.match(card, /recommendations\.slice\(pageIndex, pageIndex \+ 1\)/);
    assert.match(card, /disabled=\{pageIndex === 0\}/);
    assert.match(card, /disabled=\{pageIndex >= recommendations\.length - 1\}/);
    assert.match(card, /<AnimatePresence mode="popLayout" initial=\{false\} custom=\{slideDirection\}>/);
    assert.match(card, /layoutId="smart-rec-deck-indicator"/);
    assert.match(card, /key=\{activeDeck\}/);
    for (const removed of ['ai_explanation_label', 'musical_reasoning', 'transition_tip', 'rec.transitionSuggestion', 'rec.aiExplanation || rec.justification']) {
      assert.ok(!card.includes(removed), `la tarjeta aún muestra ${removed}`);
    }
    const es = JSON.parse(read('src/i18n/locales/es/translation.json'));
    const en = JSON.parse(read('src/i18n/locales/en/translation.json'));
    for (const key of ['recommendation_nav', 'recommendation_prev', 'recommendation_next', 'recommendation_position']) {
      assert.equal(typeof es.dashboard[key], 'string');
      assert.equal(typeof en.dashboard[key], 'string');
    }
  });
});

describe('Sesiones — captura e historial', () => {
  it('muestra la duración desde el estado inicial y retira los eventos con animación', () => {
    const page = read('src/pages/Sessions.tsx');
    assert.match(page, /<dl className="sd-sessions-readouts">\s+<div className="sd-sessions-readout">/);
    assert.match(page, /formatDuration\(captureDurationMs \/ 1000\)\.padStart\(5, '0'\)/);
    assert.match(page, /\{capture\.session && !capture\.active && \(\s+<motion\.div\s+key="events"/);
    assert.match(read('src/pages/Sessions.css'), /\.sd-sessions-readouts \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });

  it('separa más las sesiones guardadas con el sistema de espaciado', () => {
    assert.match(read('src/pages/Sessions.css'), /\.sd-sessions-history__list \{[^}]*gap: var\(--sd-gap-1\);/);
  });
});
