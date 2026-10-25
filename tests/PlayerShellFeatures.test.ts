/**
 * SYSTEM DJ — Test Suite: Reproductor, densidad, navegación y filtros
 * Cola compartida de la barra (orden, aleatorio, repetir, quitar/vaciar, fin de pista),
 * playlists de una y varias pistas, atajos de sección, deck de destino de Home, filtros de
 * la Biblioteca, favoritos, modelo del visualizador y persistencia de las nuevas preferencias.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PlayerQueue, shuffled, type PlayerTransport } from '../src/services/player/playerQueue.ts';
import {
  DEFAULT_NAVIGATION_BINDINGS,
  createShortcutHandlers,
  resolveNavigationShortcut,
  sanitizeNavigationBindings,
  validateNavigationBinding,
  type NavSection,
  type ShortcutTarget,
} from '../src/services/keyboard/keyboardShortcuts.ts';
import { navigateToSection, registerConsoleNavigator } from '../src/services/navigation/consoleNavigator.ts';
import { resolveReferenceDeck } from '../src/components/dashboard/referenceDeck.ts';
import { filterLibraryRows, isLinkTrack, isLocalTrack, matchesAnalysisFilter } from '../src/utils/libraryFilters.ts';
import { FavoritesStore, FAVORITES_STORAGE_KEY } from '../src/services/favorites/favoritesService.ts';
import {
  REST_LEVEL,
  VISUALIZER_BANDS,
  bandRanges,
  levelAt,
  shouldKeepAnimating,
  updateLevels,
} from '../src/components/player/visualizerModel.ts';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, SettingsStore, sanitizeSettings } from '../src/store/useSettingsStore.ts';
import type { AnalysisStatus, Track } from '../src/types/track.ts';

function track(id: string, status: AnalysisStatus = 'analyzed'): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    duration: 180,
    durationFormatted: '3:00',
    type: 'audio',
    source: { type: 'indexeddb', indexedDbKey: id },
    analysis: { status },
    dateAdded: 0,
  };
}

/** Transporte simulado: registra cargas y Play como lo haría Deck A. */
function fakeTransport(options: { failIds?: string[] } = {}) {
  const log: string[] = [];
  const state = { loadedId: null as string | null, time: 0, playing: false };
  const transport: PlayerTransport = {
    load: async (t) => {
      log.push(`load:${t.id}`);
      if (options.failIds?.includes(t.id)) return false;
      state.loadedId = t.id;
      state.time = 0;
      state.playing = false;
      return true;
    },
    play: async () => {
      log.push(`play:${state.loadedId}`);
      state.playing = true;
    },
    restart: () => {
      log.push('restart');
      state.time = 0;
    },
    getLoadedTrackId: () => state.loadedId,
    getCurrentTime: () => state.time,
  };
  return { transport, log, state };
}

/** Generador determinista para el aleatorio. */
function seeded(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const ids = (queue: PlayerQueue) => queue.getSnapshot().entries.map((e) => e.track.id);

describe('PlayerQueue — reproducción en orden', () => {
  it('una playlist de una sola pista se carga y además se reproduce', async () => {
    const { transport, log } = fakeTransport();
    const queue = new PlayerQueue(transport);
    const started = await queue.playTracks([track('solo')], { shuffle: false, contextId: 'playlist:1' });
    assert.equal(started, true);
    assert.deepEqual(log, ['load:solo', 'play:solo']);
    assert.equal(queue.hasNext(), false);
    assert.equal(queue.getSnapshot().contextId, 'playlist:1');
  });

  it('empieza por la primera pista guardada y avanza en orden hasta el final', async () => {
    const { transport, log } = fakeTransport();
    const queue = new PlayerQueue(transport);
    await queue.playTracks([track('a'), track('b'), track('c')], { shuffle: false });
    assert.equal(queue.getCurrentEntry()?.track.id, 'a');
    await queue.handleTrackEnded();
    await queue.handleTrackEnded();
    assert.equal(queue.getCurrentEntry()?.track.id, 'c');
    // Sin repetir, al acabar la última la cola se detiene
    assert.equal(await queue.handleTrackEnded(), false);
    assert.deepEqual(log.filter((l) => l.startsWith('play')), ['play:a', 'play:b', 'play:c']);
  });

  it('una cola vacía no hace nada', async () => {
    const { transport, log } = fakeTransport();
    const queue = new PlayerQueue(transport);
    assert.equal(await queue.playTracks([]), false);
    assert.equal(await queue.next(), false);
    assert.equal(await queue.previous(), false);
    assert.deepEqual(log, []);
  });

  it('Anterior reinicia tras 3 s y vuelve a la previa al principio de la pista', async () => {
    const { transport, log, state } = fakeTransport();
    const queue = new PlayerQueue(transport);
    await queue.playTracks([track('a'), track('b')], { startIndex: 1, shuffle: false });
    state.time = 10;
    await queue.previous();
    assert.equal(queue.getCurrentEntry()?.track.id, 'b');
    assert.equal(log.at(-1), 'restart');
    state.time = 1;
    await queue.previous();
    assert.equal(queue.getCurrentEntry()?.track.id, 'a');
    // En la primera pista, sin previa, solo reinicia
    await queue.previous();
    assert.equal(queue.getCurrentEntry()?.track.id, 'a');
    assert.equal(log.at(-1), 'restart');
  });

  it('no avanza si el deck tiene otra pista cargada a mano', async () => {
    const { transport, state } = fakeTransport();
    const queue = new PlayerQueue(transport);
    await queue.playTracks([track('a'), track('b')], { shuffle: false });
    state.loadedId = 'manual';
    assert.equal(await queue.handleTrackEnded(), false);
    assert.equal(queue.getCurrentEntry()?.track.id, 'a');
  });

  it('la última petición gana si dos cargas se solapan', async () => {
    const { transport, log } = fakeTransport();
    const queue = new PlayerQueue(transport);
    const first = queue.playTracks([track('x')]);
    const second = queue.playTracks([track('y')]);
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(log.filter((l) => l.startsWith('play')), ['play:y']);
  });

  it('informa del error de carga y no reproduce', async () => {
    const { transport, log } = fakeTransport({ failIds: ['bad'] });
    const failed: string[] = [];
    const queue = new PlayerQueue(transport, { onLoadError: (t) => failed.push(t.id) });
    assert.equal(await queue.playTracks([track('bad')]), false);
    assert.deepEqual(failed, ['bad']);
    assert.ok(!log.some((l) => l.startsWith('play')));
  });
});

describe('PlayerQueue — repetir', () => {
  it('cicla off → all → one → off', () => {
    const queue = new PlayerQueue(fakeTransport().transport);
    const seen = [queue.getSnapshot().repeat];
    for (let i = 0; i < 3; i++) {
      queue.cycleRepeat();
      seen.push(queue.getSnapshot().repeat);
    }
    assert.deepEqual(seen, ['off', 'all', 'one', 'off']);
  });

  it('repetir la cola vuelve a la primera; repetir una pista la relanza', async () => {
    const { transport, log } = fakeTransport();
    const queue = new PlayerQueue(transport);
    await queue.playTracks([track('a'), track('b')], { shuffle: false });
    queue.setRepeat('all');
    await queue.next();
    assert.equal(queue.hasNext(), true);
    await queue.handleTrackEnded();
    assert.equal(queue.getCurrentEntry()?.track.id, 'a');
    queue.setRepeat('one');
    log.length = 0;
    await queue.handleTrackEnded();
    assert.deepEqual(log, ['play:a']);
    assert.equal(queue.getCurrentEntry()?.track.id, 'a');
  });
});

describe('PlayerQueue — aleatorio', () => {
  const many = ['1', '2', '3', '4', '5', '6', '7', '8'].map((id) => track(id));

  it('Fisher–Yates conserva todos los elementos sin repetir', () => {
    const result = shuffled([1, 2, 3, 4, 5, 6], seeded());
    assert.deepEqual([...result].sort(), [1, 2, 3, 4, 5, 6]);
  });

  it('una playlist en aleatorio suena entera, sin repetir ni perder la primera, y no altera el orden guardado', async () => {
    const { transport, log } = fakeTransport();
    const queue = new PlayerQueue(transport, { random: seeded(11) });
    const saved = many.map((t) => t.id);
    await queue.playTracks(many, { shuffle: true, contextId: 'playlist:p' });
    const order = ids(queue);
    assert.notDeepEqual(order, saved, 'el orden de reproducción es aleatorio');
    assert.deepEqual([...order].sort(), [...saved].sort());
    assert.deepEqual(many.map((t) => t.id), saved, 'el array de origen no se modifica');
    for (let i = 0; i < many.length; i++) await queue.handleTrackEnded();
    const played = log.filter((l) => l.startsWith('play:')).map((l) => l.slice(5));
    assert.equal(played.length, many.length);
    assert.equal(new Set(played).size, many.length);
    assert.ok(played.includes('1'));
  });

  it('activar el aleatorio mantiene la actual y baraja solo las pendientes; apagarlo vuelve al orden guardado', async () => {
    const { transport } = fakeTransport();
    const queue = new PlayerQueue(transport, { random: seeded(3) });
    await queue.playTracks(many, { shuffle: false });
    await queue.next();
    queue.setShuffle(true);
    assert.equal(queue.getCurrentEntry()?.track.id, '2');
    assert.deepEqual(ids(queue).slice(0, 2), ['1', '2']);
    assert.deepEqual([...ids(queue)].sort(), many.map((t) => t.id).sort());
    queue.setShuffle(false);
    assert.deepEqual(ids(queue), many.map((t) => t.id));
    assert.equal(queue.getCurrentEntry()?.track.id, '2');
  });

  it('una pista elegida suena primero aunque el aleatorio esté activo', async () => {
    const { transport } = fakeTransport();
    const queue = new PlayerQueue(transport, { random: seeded(5) });
    queue.setShuffle(true);
    await queue.playTracks(many, { startIndex: 4 });
    assert.equal(queue.getCurrentEntry()?.track.id, '5');
    assert.equal(queue.getSnapshot().shuffle, true);
  });
});

describe('PlayerQueue — quitar y vaciar', () => {
  it('quita una pendiente, nunca la que suena, y vacía las pendientes conservando la actual', async () => {
    const { transport } = fakeTransport();
    const queue = new PlayerQueue(transport);
    await queue.playTracks([track('a'), track('b'), track('c'), track('d')], { shuffle: false, startIndex: 1 });
    const [first, current, third] = queue.getSnapshot().entries;
    assert.equal(queue.remove(current.uid), false);
    assert.equal(queue.remove(third.uid), true);
    assert.deepEqual(ids(queue), ['a', 'b', 'd']);
    // Quitar una ya sonada desplaza el índice sin cambiar la actual
    assert.equal(queue.remove(first.uid), true);
    assert.equal(queue.getCurrentEntry()?.track.id, 'b');
    queue.clearUpcoming();
    assert.deepEqual(queue.getUpcoming(), []);
    assert.equal(queue.getCurrentEntry()?.track.id, 'b');
    assert.equal(queue.hasNext(), false);
  });

  it('notifica a los suscriptores en cada cambio', async () => {
    const queue = new PlayerQueue(fakeTransport().transport);
    let calls = 0;
    const unsubscribe = queue.subscribe(() => { calls++; });
    await queue.playTracks([track('a'), track('b')]);
    queue.toggleShuffle();
    queue.cycleRepeat();
    unsubscribe();
    queue.cycleRepeat();
    assert.equal(calls, 3);
  });
});

describe('Atajos de navegación', () => {
  function target(sections: NavSection[]): ShortcutTarget {
    return {
      togglePlayDeck: () => {}, handleCueDown: () => {}, handleCueUp: () => {}, toggleSync: () => {},
      getCrossfader: () => 50, setCrossfader: () => {}, hasHotCue: () => false, jumpToHotCue: () => {},
      setHotCue: () => { sections.push('hotcue' as NavSection); }, getMixValue: () => 50, setMixValue: () => {},
      navigate: (section) => { sections.push(section); },
    };
  }
  function ev(code: string, extra: Record<string, unknown> = {}) {
    const e = {
      code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false,
      defaultPrevented: false, target: null as EventTarget | null, prevented: false,
      preventDefault() { e.prevented = true; },
      ...extra,
    };
    return e;
  }

  it('Shift + 1–5 abre Inicio, Biblioteca, Playlists, Mixer y Sesiones', () => {
    const sections: NavSection[] = [];
    const { onKeyDown } = createShortcutHandlers(target(sections));
    for (const digit of ['1', '2', '3', '4', '5']) onKeyDown(ev(`Digit${digit}`, { shiftKey: true }));
    assert.deepEqual(sections, ['home', 'library', 'playlists', 'mixer', 'sessions']);
  });

  it('sin Shift el dígito sigue siendo un Hot Cue, y no actúa al escribir', () => {
    const sections: NavSection[] = [];
    const { onKeyDown } = createShortcutHandlers(target(sections));
    onKeyDown(ev('Digit1'));
    assert.deepEqual(sections, ['hotcue']);
    onKeyDown(ev('Digit2', { shiftKey: true, target: { tagName: 'INPUT' } }));
    onKeyDown(ev('Digit3', { shiftKey: true, target: { tagName: 'DIV', isContentEditable: true } }));
    onKeyDown(ev('Digit4', { shiftKey: true, target: { tagName: 'BUTTON', getAttribute: () => 'combobox' } }));
    onKeyDown(ev('Digit5', { shiftKey: true, ctrlKey: true }));
    onKeyDown(ev('Digit5', { shiftKey: true, defaultPrevented: true }));
    assert.deepEqual(sections, ['hotcue']);
  });

  it('tiene prioridad sobre una selectora de mezcla con la misma tecla y no repite al mantener', () => {
    const sections: NavSection[] = [];
    const { onKeyDown } = createShortcutHandlers(
      target(sections),
      () => ({ ...{ 'A.gain': 'Digit5', 'A.high': 'KeyE', 'A.mid': 'KeyD', 'A.low': 'KeyC', 'A.filter': 'KeyF', 'B.gain': 'KeyH', 'B.high': 'KeyI', 'B.mid': 'KeyK', 'B.low': 'KeyM', 'B.filter': 'KeyJ' } }),
    );
    const press = ev('Digit5', { shiftKey: true });
    onKeyDown(press);
    onKeyDown(ev('Digit5', { shiftKey: true, repeat: true }));
    assert.deepEqual(sections, ['sessions']);
    assert.equal(press.prevented, true);
  });

  it('valida y sanea asignaciones personalizadas', () => {
    assert.equal(validateNavigationBinding(DEFAULT_NAVIGATION_BINDINGS, 'home', 'KeyH'), null);
    assert.equal(validateNavigationBinding(DEFAULT_NAVIGATION_BINDINGS, 'home', 'Digit2'), 'duplicate');
    assert.equal(validateNavigationBinding(DEFAULT_NAVIGATION_BINDINGS, 'home', 'Space'), 'invalid');
    assert.deepEqual(sanitizeNavigationBindings({ home: 'KeyH' }), { ...DEFAULT_NAVIGATION_BINDINGS, home: 'KeyH' });
    assert.deepEqual(sanitizeNavigationBindings({ home: 'Digit2' }), DEFAULT_NAVIGATION_BINDINGS);
    assert.equal(resolveNavigationShortcut({ code: 'KeyH', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }, { ...DEFAULT_NAVIGATION_BINDINGS, home: 'KeyH' }), 'home');
  });

  it('el puente solo navega con el shell montado', () => {
    const paths: string[] = [];
    assert.equal(navigateToSection('mixer'), false);
    const unregister = registerConsoleNavigator((path) => paths.push(path));
    assert.equal(navigateToSection('mixer'), true);
    assert.equal(navigateToSection('home'), true);
    unregister();
    assert.equal(navigateToSection('library'), false);
    assert.deepEqual(paths, ['/mixer', '/dashboard']);
  });
});

describe('Home — deck de destino de «Añadidas recientemente»', () => {
  it('usa el deck elegido en Recomendaciones; sin elección, el que tiene pista (A primero)', () => {
    assert.equal(resolveReferenceDeck('B', true, false), 'B');
    assert.equal(resolveReferenceDeck('A', false, true), 'A');
    assert.equal(resolveReferenceDeck(null, false, true), 'B');
    assert.equal(resolveReferenceDeck(null, true, true), 'A');
    assert.equal(resolveReferenceDeck(null, false, false), 'A');
  });

  it('Home comparte el mismo estado con la tarjeta y carga en ese deck; Play reproduce en ese deck', () => {
    const source = fs.readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
    assert.match(source, /<SmartRecommendationCard selectedDeck=\{selectedDeck\} onSelectedDeckChange=\{setSelectedDeck\} \/>/);
    assert.match(source, /loadTrackToDeck\(deck, track\)/);
    assert.match(source, /togglePlayDeck\(deck\)/);
    assert.doesNotMatch(source, /recentPreview/);
    assert.match(source, /targetDeckState\.track\?\.id === track\.id && targetDeckState\.playbackState === 'playing'/);
    assert.match(source, /icon=\{<Icon icon=\{isPreviewing \? Pause : Play\}/);
  });
});

describe('Biblioteca — filtros', () => {
  const rows = (['analyzed', 'pending', 'analyzing', 'failed', 'unsupported'] as AnalysisStatus[]).map((status, i) => ({
    title: `Song ${i}`, artist: i === 0 ? 'Daft' : 'Other', album: '-', status,
    rawLocalTrack: track(String(i), status),
  }));

  it('agrupa los estados reales del análisis sin dar por analizado lo parcial', () => {
    assert.equal(matchesAnalysisFilter('analyzed', 'analyzed'), true);
    assert.equal(matchesAnalysisFilter('unsupported', 'analyzed'), false);
    assert.equal(matchesAnalysisFilter('analyzing', 'pending'), true);
    assert.equal(matchesAnalysisFilter(undefined, 'pending'), true);
    assert.equal(matchesAnalysisFilter('failed', 'failed'), true);
    assert.equal(matchesAnalysisFilter('unsupported', 'failed'), true);
  });

  it('cada filtro devuelve un conjunto distinto y se combina con la búsqueda', () => {
    const count = (analysis: Parameters<typeof filterLibraryRows>[2], q = '') => filterLibraryRows(rows, 'all', analysis, q).length;
    assert.equal(count('all'), 5);
    assert.equal(count('analyzed'), 1);
    assert.equal(count('pending'), 2);
    assert.equal(count('failed'), 2);
    assert.equal(count('analyzed', 'daft'), 1);
    assert.equal(count('pending', 'daft'), 0);
  });

  it('«Mis archivos locales» excluye fuentes remotas (url) y hoy coincide con la biblioteca guardada', () => {
    assert.equal(isLocalTrack(track('x')), true);
    assert.equal(isLocalTrack({ source: { type: 'url', url: 'https://example.com/a.mp3' } }), false);
    const withRemote = [...rows, { ...rows[0], title: 'Remote', rawLocalTrack: { source: { type: 'url' as const } } }];
    assert.equal(filterLibraryRows(withRemote, 'local', 'all', '').length, 5);
    assert.equal(filterLibraryRows(withRemote, 'all', 'all', '').length, 6);
  });

  it('separa archivos del equipo e importaciones por enlace con el mismo criterio que la etiqueta', () => {
    const linkTrack = { ...track('y'), origin: 'link' as const };
    assert.equal(isLinkTrack(linkTrack), true);
    assert.equal(isLocalTrack(linkTrack), false);
    // Pistas históricas sin `origin` siguen siendo archivos locales
    assert.equal(isLinkTrack(track('x')), false);
    const mixed = [...rows, { ...rows[0], title: 'From YouTube', rawLocalTrack: linkTrack }];
    assert.equal(filterLibraryRows(mixed, 'all', 'all', '').length, 6);
    assert.equal(filterLibraryRows(mixed, 'local', 'all', '').length, 5);
    assert.deepEqual(filterLibraryRows(mixed, 'link', 'all', '').map((r) => r.title), ['From YouTube']);
    assert.equal(filterLibraryRows(mixed, 'link', 'all', 'song').length, 0);
  });
});

describe('Favoritos', () => {
  it('marca, desmarca y persiste por id', () => {
    const data: Record<string, string> = {};
    const storage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
    const store = new FavoritesStore(storage);
    assert.equal(store.toggle('t1'), true);
    assert.equal(store.isFavorite('t1'), true);
    assert.deepEqual(JSON.parse(data[FAVORITES_STORAGE_KEY]), ['t1']);
    assert.equal(new FavoritesStore(storage).isFavorite('t1'), true, 'sobrevive a una recarga');
    assert.equal(store.toggle('t1'), false);
    assert.equal(new FavoritesStore(storage).isFavorite('t1'), false);
  });

  it('ignora datos guardados corruptos', () => {
    const store = new FavoritesStore({ getItem: () => '{bad', setItem: () => {} });
    assert.equal(store.getSnapshot().size, 0);
  });
});

describe('Visualizador — datos reales y preferencia de animación', () => {
  const ranges = bandRanges(128);

  it('reparte las 128 bandas del analizador en bandas logarítmicas válidas', () => {
    assert.equal(ranges.length, VISUALIZER_BANDS);
    for (const [start, end] of ranges) {
      assert.ok(start >= 0 && end <= 128 && end > start);
    }
  });

  it('el audio intenso produce más amplitud que el suave; sin señal cae a cero', () => {
    const loud = new Float32Array(VISUALIZER_BANDS);
    const soft = new Float32Array(VISUALIZER_BANDS);
    const loudPeak = updateLevels(loud, new Uint8Array(128).fill(230), ranges);
    const softPeak = updateLevels(soft, new Uint8Array(128).fill(60), ranges);
    assert.ok(loudPeak > softPeak * 3, `${loudPeak} vs ${softPeak}`);
    let peak = loudPeak;
    for (let i = 0; i < 200 && peak > 0; i++) peak = updateLevels(loud, null, ranges);
    assert.equal(peak, 0);
    assert.ok(REST_LEVEL > 0);
  });

  it('sin espectro no se inventa señal', () => {
    const levels = new Float32Array(VISUALIZER_BANDS);
    assert.equal(updateLevels(levels, null, ranges), 0);
    assert.equal(levelAt(levels, 0.5), 0);
  });

  it('el bucle solo corre con animaciones permitidas y con audio o una caída pendiente', () => {
    assert.equal(shouldKeepAnimating({ enabled: false, playing: true, peak: 1 }), false);
    assert.equal(shouldKeepAnimating({ enabled: true, playing: true, peak: 0 }), true);
    assert.equal(shouldKeepAnimating({ enabled: true, playing: false, peak: 0.2 }), true);
    assert.equal(shouldKeepAnimating({ enabled: true, playing: false, peak: 0 }), false);
  });

  it('la barra ya no muestra la onda; el visualizador se oculta con data-animations=off', () => {
    const bar = fs.readFileSync(new URL('../src/layouts/PlayerBar.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(bar, /PlayerVisualizer|sd-player__wave/);
    const css = fs.readFileSync(new URL('../src/components/player/PlayerVisualizer.css', import.meta.url), 'utf8');
    assert.match(css, /:root\[data-animations='off'\] \.sd-player-visualizer/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /pointer-events: none/);
  });
});

describe('Densidad y preferencias nuevas', () => {
  it('la densidad compacta reduce tokens v2 compartidos solo dentro del shell', () => {
    const tokens = fs.readFileSync(new URL('../src/design-system/tokens.css', import.meta.url), 'utf8');
    const block = /\[data-density='compact'\] \.desktop-layout \{([^}]*)\}/.exec(tokens)?.[1] ?? '';
    for (const token of ['--sd-gap-3', '--sd-panel-padding', '--sd-row-min-height', '--sd-row-pad-y', '--sd-control-height', '--sd-control-height-sm']) {
      assert.match(block, new RegExp(`${token}:`), token);
    }
    assert.match(tokens, /@media \(pointer: coarse\)\s*\{\s*\[data-density='compact'\] \.desktop-layout/);
    const table = fs.readFileSync(new URL('../src/components/templates/ConsoleTemplate.css', import.meta.url), 'utf8');
    assert.match(table, /padding: var\(--sd-row-pad-y\) var\(--sd-cell-pad-x\)/);
    assert.match(table, /border-spacing: 0 var\(--sd-row-gap\)/);
  });

  it('densidad, intensidad del visualizador y atajos de sección sobreviven a una recarga', () => {
    const data: Record<string, string> = {};
    const storage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
    const store = new SettingsStore(storage);
    store.update({ density: 'compact', visualizerIntensity: 'vivid', navigationBindings: { ...DEFAULT_NAVIGATION_BINDINGS, mixer: 'KeyX' } });
    assert.ok(data[SETTINGS_STORAGE_KEY]);
    const reloaded = new SettingsStore(storage).getSnapshot();
    assert.equal(reloaded.density, 'compact');
    assert.equal(reloaded.visualizerIntensity, 'vivid');
    assert.equal(reloaded.navigationBindings.mixer, 'KeyX');
  });

  it('valores desconocidos vuelven a los predeterminados', () => {
    const result = sanitizeSettings({ visualizerIntensity: 'max', navigationBindings: { home: 'Digit2' } });
    assert.equal(result.visualizerIntensity, DEFAULT_SETTINGS.visualizerIntensity);
    assert.deepEqual(result.navigationBindings, DEFAULT_NAVIGATION_BINDINGS);
  });
});

describe('Traducciones', () => {
  it('las claves nuevas existen en español e inglés', () => {
    const es = JSON.parse(fs.readFileSync(new URL('../src/i18n/locales/es/translation.json', import.meta.url), 'utf8'));
    const en = JSON.parse(fs.readFileSync(new URL('../src/i18n/locales/en/translation.json', import.meta.url), 'utf8'));
    const paths = [
      'player.queue_empty_title', 'player.repeat_mode.one', 'player.status_pending', 'player.favorite',
      'playlists.shuffle_play', 'library.analysis_filter.pending', 'settings.shortcuts_nav_title',
      'settings.visualizer_intensity.vivid', 'settings.animations_list.player_visualizer', 'dashboard.recent_target',
    ];
    const get = (obj: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
    for (const path of paths) {
      assert.equal(typeof get(es, path), 'string', `es:${path}`);
      assert.equal(typeof get(en, path), 'string', `en:${path}`);
    }
  });
});
