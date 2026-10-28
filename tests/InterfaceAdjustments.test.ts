/**
 * SYSTEM DJ — Test Suite: Ajustes de interfaz
 * Confirmaciones rápidas (toasts) fuera del flujo, barra de reproducción retirada solo en
 * Mixer, Play/Pausa de playlists con icono y ancho de contenido compartido.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ToastStore, TOAST_DURATION_MS, TOAST_STAGGER_MS } from '../src/services/notifications/toastService.ts';

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Toasts', () => {
  it('apila el más reciente arriba, escalona las entradas y se retira solo tras la duración', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = new ToastStore();
      store.show('success', 'uno');
      store.show('error', 'dos');
      // El segundo espera su turno en lugar de entrar a la vez
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['uno']);
      mock.timers.tick(TOAST_STAGGER_MS);
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['dos', 'uno']);

      mock.timers.tick(TOAST_DURATION_MS - TOAST_STAGGER_MS);
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['dos']);
      mock.timers.tick(TOAST_STAGGER_MS);
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
      for (let i = 0; i < 3; i++) mock.timers.tick(TOAST_STAGGER_MS);
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['d', 'c', 'b']);
      assert.equal(calls, 4);

      const [newest] = store.getSnapshot();
      store.dismiss(newest.id);
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['c', 'b']);
    } finally {
      mock.timers.reset();
    }
  });

  it('agrupa avisos repetidos en uno solo con contador que se actualiza en el sitio', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = new ToastStore();
      store.show('success', 'Análisis completado');
      const [first] = store.getSnapshot();
      store.show('success', 'Análisis completado');
      store.show('success', 'Análisis completado');
      assert.equal(store.getSnapshot().length, 1);
      assert.equal(store.getSnapshot()[0].id, first.id);
      assert.equal(store.getSnapshot()[0].text, 'Análisis completado (3)');

      // Cada repetición reinicia la cuenta atrás
      mock.timers.tick(TOAST_DURATION_MS - 1);
      store.show('success', 'Análisis completado');
      mock.timers.tick(TOAST_DURATION_MS - 1);
      assert.equal(store.getSnapshot()[0].text, 'Análisis completado (4)');
    } finally {
      mock.timers.reset();
    }
  });

  it('con función de texto y contador explícito compone singular y plural', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = new ToastStore();
      const text = (count: number) => (count === 1 ? 'Track deleted' : `Tracks deleted (${count})`);
      store.show('success', text, { group: 'deleted' });
      assert.equal(store.getSnapshot()[0].text, 'Track deleted');
      store.show('success', text, { group: 'deleted' });
      assert.equal(store.getSnapshot()[0].text, 'Tracks deleted (2)');
      store.show('success', text, { group: 'deleted', count: 10 });
      assert.equal(store.getSnapshot()[0].text, 'Tracks deleted (10)');
      assert.equal(store.getSnapshot().length, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('un aviso en cola también absorbe sus repeticiones', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const store = new ToastStore();
      store.show('info', 'importado');
      store.show('success', 'analizado');
      store.show('success', 'analizado');
      mock.timers.tick(TOAST_STAGGER_MS);
      assert.deepEqual(store.getSnapshot().map((toast) => toast.text), ['analizado (2)', 'importado']);
    } finally {
      mock.timers.reset();
    }
  });

  it('la biblioteca no muestra avisos en línea: borrados y análisis van a los toasts agrupados', () => {
    const library = read('src/pages/Library.tsx');
    assert.doesNotMatch(library, /setFeedback|<Notice/);
    assert.match(library, /group: 'library-deleted'/);
    assert.match(library, /group: 'library-analysis-done', count: batch\.done/);
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
  it('cabecera, área de trabajo y barra ocupan todo el ancho de la ventana', () => {
    assert.doesNotMatch(read('src/index.css'), /--layout-frame-width/);
    const css = read('src/layouts/DesktopLayout.css');
    assert.match(css, /\.desktop-layout \{[^}]*width: 100%;/);
    assert.doesNotMatch(css, /margin-inline: auto/);
  });

  it('Home, Login y Registro ocupan todo el ancho, como la consola', () => {
    const css = read('src/components/templates/LandingTemplate.css');
    assert.match(css, /\.sd-landing \{[^}]*width: 100%;/);
    assert.doesNotMatch(css, /layout-frame-width|margin-inline: auto/);
  });

  it('las secciones no reducen su ancho por su cuenta', () => {
    assert.doesNotMatch(read('src/components/templates/ConsoleTemplate.css'), /--layout-content-inset/);
    assert.doesNotMatch(read('src/pages/Mixer.css'), /--layout-content-inset/);
  });

  it('los avisos fijos se alinean con el borde derecho de la ventana', () => {
    const css = read('src/components/molecules/ToastViewport.css');
    assert.match(css, /right: var\(--sd-gap-4\);/);
    assert.doesNotMatch(css, /layout-frame-width/);
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

describe('Ruta raíz', () => {
  it('`/` siempre muestra la presentación, con o sin sesión', () => {
    const landing = read('src/pages/Landing.tsx');
    assert.doesNotMatch(landing, /<Navigate/);
    assert.match(read('src/App.tsx'), /<Route path="\/" element=\{<Landing \/>\} \/>/);
  });
});

describe('Presentación — cambio de tema e idioma', () => {
  it('ambos cambios pasan por una View Transition', () => {
    const navbar = read('src/components/organisms/LandingNavbar.tsx');
    assert.match(navbar, /withViewTransition\('language'/);
    assert.match(navbar, /withViewTransition\('theme'/);
  });

  it('respeta la preferencia de animaciones y el movimiento reducido', () => {
    assert.match(read('src/design-system/viewTransition.ts'), /settingsStore\.getSnapshot\(\)\.animations/);
    const tokens = read('src/design-system/tokens.css');
    assert.match(tokens, /@media \(prefers-reduced-motion: reduce\) \{\s+::view-transition-old\(root\)/);
    assert.match(tokens, /::view-transition-new\(sd-page-content\)/);
  });
});

describe('Longitud máxima de los campos de texto', () => {
  it('una sola constante compartida, aplicada por los átomos de entrada', async () => {
    const { INPUT_MAX_LENGTH } = await import('../src/config/constants.ts');
    assert.equal(INPUT_MAX_LENGTH, 100);
    for (const path of ['src/components/atoms/TextField.tsx', 'src/components/ui/Input.tsx']) {
      const source = read(path);
      assert.match(source, /maxLength = INPUT_MAX_LENGTH/);
      assert.match(source, /maxLength=\{maxLength\}/);
    }
  });

  it('la búsqueda superior no fija su propio límite', () => {
    const header = read('src/layouts/Header.tsx');
    assert.match(header, /<TextField/);
    assert.doesNotMatch(header, /maxLength=\{\d+\}/);
  });
});
