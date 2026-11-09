import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { formatKeyCode, type ShortcutId } from '../../../services/keyboard/keyboardShortcuts';
import '../../../design-system/keycaps.css';
import './MixerGuide.css';

type Step = { ids: string[]; es: string; en: string; desc: [string, string]; keys?: string; bindings?: ShortcutId[]; suffix?: string };
const pair = (part: string) => [`deck-a-${part}`, `deck-b-${part}`];
const steps: Step[] = [
 {ids:['screen-key-load-a','screen-key-load-b'],es:'Cargar pistas',en:'Load tracks',desc:['Abre la biblioteca para cargar una pista en cada deck.','Open the library to load a track into each deck.'],bindings:['libraryA','libraryB']},
 {ids:['screen-key-menu','screen-key-grid'],es:'Menú y cuadrícula',en:'Menu and grid',desc:['MENU abre el navegador de pistas; GRID muestra u oculta la cuadrícula.','MENU opens the track browser; GRID shows or hides the grid.']},
 {ids:['screen-key-menu'],es:'Navegador de pistas',en:'Track browser',desc:['Busca por título; usa las flechas para moverte, Enter para cargar y Esc para cerrar. Si el deck está sonando, confirma el reemplazo.','Search by title; use the arrows to navigate, Enter to load, and Esc to close. Confirm replacement if the deck is playing.'],keys:'↑ / ↓ · Enter · Esc'},
 {ids:['screen-key-rec'],es:'Grabación',en:'Recording',desc:['Inicia o detiene la grabación de la sesión.','Start or stop recording the session.'],bindings:['record']},
 {ids:['screen-waveform-a','screen-waveform-b'],es:'Forma de onda',en:'Waveform',desc:['Arrastra para buscar en la pista. Con foco, usa las flechas para avanzar o retroceder.','Drag to seek in the track. When focused, use the arrows to move through it.'],keys:'← / → · Shift + ← / →'},
 {ids:pair('eject'),es:'Expulsar',en:'Eject',desc:['Descarga la pista de este deck.','Unload the track from this deck.']},
 {ids:pair('reference'),es:'Referencia',en:'Reference',desc:['Marca o desmarca la pista como referencia.','Mark or unmark the track as a reference.']},
 {ids:pair('mode'),es:'Modo del display',en:'Display mode',desc:['Alterna el display LED entre mensajes y mapa de la pista.','Switch the LED display between messages and the track map.'],bindings:['displayA','displayB'],suffix:'tap'},
 {ids:pair('notices'),es:'Avisos y análisis',en:'Notices and analysis',desc:['Los avisos muestran el estado de la pista; pulsa el aviso de análisis pendiente o fallido para iniciarlo.','Notices show the track status; press a pending or failed analysis notice to start it.']},
 {ids:pair('loop'),es:'Auto Loop',en:'Auto Loop',desc:['Activa o desactiva un bucle. Usa − y + para cambiar su longitud.','Turn a loop on or off. Use − and + to change its length.'],bindings:['loopA','loopB'],suffix:'loop'},
 {ids:pair('backspin'),es:'Backspin',en:'Backspin',desc:['Pulsa el centro del disco mientras reproduce para hacer un backspin.','Press the center of a playing deck to trigger a backspin.']},
 {ids:pair('cue'),es:'CUE',en:'CUE',desc:['Vuelve al punto CUE y mantenlo pulsado para escuchar desde allí.','Return to the CUE point and hold to preview from there.'],keys:'A: Q · B: I'},
 {ids:pair('play'),es:'Play / Pause',en:'Play / Pause',desc:['Reproduce o pausa la pista.','Play or pause the track.'],keys:'A: F + Space · B: J + Space'},
 {ids:pair('barsync'),es:'BAR SYNC',en:'BAR SYNC',desc:['Prepara el inicio de compás en fase con el master. Confirma antes el downbeat y compás de ambas pistas.','Prepare the bar start in phase with the master. First confirm the downbeat and meter of both tracks.']},
 {ids:pair('align'),es:'ALIGN',en:'ALIGN',desc:['Alinea la fase de los pulsos con el deck master.','Align the beat phase with the master deck.']},
 {ids:pair('sync'),es:'SYNC',en:'SYNC',desc:['Iguala el tempo al master; usa ALIGN para ajustar la fase.','Match the master tempo; use ALIGN to adjust phase.'],keys:'A: E · B: P'},
 {ids:pair('keylock'),es:'KEY LOCK',en:'KEY LOCK',desc:['Mantiene la tonalidad al cambiar el tempo.','Keep the original key when changing tempo.']},
 {ids:pair('hotcues-section'),es:'Hot Cues',en:'Hot Cues',desc:['Un pad vacío guarda la posición; uno ocupado salta a ella. BORRAR activa el modo de eliminación; también puedes usar Shift + clic.','An empty pad saves the position; a filled pad jumps to it. DELETE enables removal; Shift + click also deletes.'],keys:'A 1–4: 1–4 · B 1–4: 7–0'},
 {ids:pair('pitch'),es:'Tempo',en:'Tempo',desc:['El fader cambia la velocidad de forma continua.','The fader changes playback speed continuously.']},
 {ids:pair('pitchbend-down'),es:'Pitch Bend − / +',en:'Pitch Bend − / +',desc:['Frena o acelera temporalmente mientras mantienes pulsado.','Slow down or speed up temporarily while held.'],keys:'A: Shift + F + ↑ / ↓ · B: Shift + J + ↑ / ↓'},
 {ids:pair('downbeat-source'),es:'Fuente del downbeat',en:'Downbeat source',desc:['Elige el cabezal, OFF o la posición sugerida como fuente del primer pulso.','Choose the playhead, OFF, or suggested position as the first beat source.']},
 {ids:pair('downbeat-meter-fader'),es:'Compás',en:'Meter',desc:['Selecciona los pulsos por compás.','Select the beats per bar.']},
 {ids:pair('downbeat-confirm'),es:'Confirmar y limpiar',en:'Confirm and clear',desc:['CONFIRMAR guarda el downbeat y compás; LIMPIAR elimina la confirmación.','CONFIRM saves the downbeat and meter; CLEAR removes the confirmation.']},
 ...([['gain','GAIN','Ajusta la ganancia de entrada.','Adjust input gain.'],['hi','HI','Ajusta los agudos.','Adjust high frequencies.'],['mid','MID','Ajusta los medios.','Adjust mid frequencies.'],['low','LOW','Ajusta los graves.','Adjust low frequencies.'],['filter','FILTER','Aplica un filtro paso bajo o paso alto; el centro es neutro.','Apply a low-pass or high-pass filter; the center is neutral.']] as const).map(([id,name,es,en]) => ({ids:[`${id}-slider-A`,`${id}-slider-B`],es:name,en:name,desc:[es,en] as [string,string],bindings:[`A.${id === 'hi' ? 'high' : id}`,`B.${id === 'hi' ? 'high' : id}`] as ShortcutId[],suffix:'arrows'})),
 {ids:['cue-btn-A','cue-btn-B'],es:'CUE de canal',en:'Channel CUE',desc:['Activa la preescucha PFL del canal.','Enable channel PFL monitoring.']},
 {ids:['volume-fader-A','volume-fader-B'],es:'Volumen de canal',en:'Channel volume',desc:['Ajusta el volumen del canal antes del crossfader.','Adjust channel volume before the crossfader.'],keys:'A: F + ↑ / ↓ · B: J + ↑ / ↓'},
 {ids:['master-volume-slider'],es:'MASTER',en:'MASTER',desc:['Ajusta el volumen de salida de la mezcla.','Adjust the mix output volume.'],keys:'↑ / ↓'},
 {ids:['master-mute-btn'],es:'MUTE',en:'MUTE',desc:['Silencia o reactiva la salida master.','Mute or restore the master output.'],bindings:['mute']},
 {ids:['crossfader-slider'],es:'Crossfader',en:'Crossfader',desc:['Mezcla la salida entre los decks A y B.','Blend the output between decks A and B.'],keys:'← / →'},
 {ids:['curve-btn-constant-power','curve-btn-linear','curve-btn-cut'],es:'Curva del crossfader',en:'Crossfader curve',desc:['CP, LIN y CUT cambian la respuesta del crossfader.','CP, LIN and CUT change the crossfader response.'],keys:'Shift + ← / →'},
];
const storageKey = 'system-dj-mixer-guide-seen';
function seen() { try { return localStorage.getItem(storageKey) === '1'; } catch { return false; } }
function markSeen() { try { localStorage.setItem(storageKey, '1'); } catch { /* Storage may be unavailable. */ } }

type Rect = { x:number; y:number; width:number; height:number };
export const MixerGuide: React.FC<{ ready: boolean }> = ({ ready }) => {
 const { i18n } = useTranslation();
 const es = i18n.language.toLowerCase().startsWith('es');
 const { settings } = useSettingsStore();
 const [step, setStep] = useState<number | null>(null);
 const [offered, setOffered] = useState(false);
 const [rects, setRects] = useState<Rect[]>([]);
 const dialog = useRef<HTMLDivElement>(null);
 const help = useRef<HTMLButtonElement>(null);
 useEffect(() => { if (ready && !offered) { setOffered(true); if (!seen()) setStep(-1); } }, [ready, offered]);
 const close = () => { markSeen(); setStep(null); requestAnimationFrame(() => help.current?.focus()); };
 useLayoutEffect(() => {
  if (step === null || step < 0) { setRects([]); return; }
  const update = () => setRects(steps[step].ids.flatMap(id => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return []; const r = el.getBoundingClientRect(); return [{x:r.left-5,y:r.top-5,width:r.width+10,height:r.height+10}]; }));
  update(); window.addEventListener('resize', update); const observer = new ResizeObserver(update); const consoleEl = document.querySelector('[data-testid="dj-console"]'); if (consoleEl) observer.observe(consoleEl);
  return () => { window.removeEventListener('resize', update); observer.disconnect(); };
 }, [step]);
 useEffect(() => { if (step === null) return; dialog.current?.focus(); const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } else if (e.key === 'Tab' && dialog.current) { const buttons = Array.from(dialog.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); if (!buttons.length) return; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (e.shiftKey && index <= 0) { e.preventDefault(); buttons[buttons.length-1].focus(); } else if (!e.shiftKey && index === buttons.length-1) { e.preventDefault(); buttons[0].focus(); } } else { e.stopImmediatePropagation(); } }; const onKeyUp = (e: KeyboardEvent) => e.stopImmediatePropagation(); window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKeyUp, true); return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); }; }, [step]);
 const current = step !== null && step >= 0 ? steps[step] : null;
 const mixerSection = step !== null && step >= steps.findIndex(item => item.ids[0] === 'gain-slider-A');
 const shortcuts: { label?: string; keys: string; note?: string }[] = [];
 if (current?.bindings) {
  current.bindings.forEach((id, index) => {
   const key = formatKeyCode(settings.shortcutBindings[id]);
   const deck = current.bindings!.length > 1 ? `Deck ${index === 0 ? 'A' : 'B'}` : undefined;
   if (current.suffix === 'loop') {
    shortcuts.push({ label: deck, keys: key, note: es ? 'Activar / desactivar · toque breve' : 'Toggle · tap' });
    shortcuts.push({ label: deck, keys: `${key} + ← / →`, note: es ? 'Cambiar longitud' : 'Change length' });
   } else {
    shortcuts.push({ label: deck, keys: `${key}${current.suffix === 'arrows' ? ' + ← / →' : ''}`, note: current.suffix === 'tap' ? (es ? 'Toque breve' : 'Tap') : undefined });
   }
  });
 } else if (current?.keys) {
  current.keys.split(' · ').forEach(command => {
   const match = /^(A|B)( 1–4)?:\s*(.+)$/.exec(command);
   shortcuts.push(match ? { label: `Deck ${match[1]}${match[2] ? ' · Hot Cues 1–4' : ''}`, keys: match[3] } : { keys: command });
  });
 }
 return <>
  <button ref={help} className="mixer-guide-help" type="button" aria-label={es ? 'Guía del mixer' : 'Mixer guide'} onClick={() => setStep(-1)}><span>{es ? 'Guía' : 'Guide'}</span><span className="mixer-guide-help__more" aria-hidden="true">{es ? ' del mixer' : ' to the mixer'}</span></button>
  {step !== null && ready && <div className="mixer-guide" data-testid="mixer-guide">
   <svg className="mixer-guide__mask" aria-hidden="true"><defs><mask id="mixer-guide-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><rect width="100%" height="100%" fill="white"/>{rects.map((r,i) => <rect key={i} {...r} rx="8" fill="black" />)}</mask></defs></svg>
   <div className="mixer-guide__shade" style={{ mask: 'url(#mixer-guide-mask)' }} />
   {rects.map((r,i) => <div key={i} className="mixer-guide__outline" style={{left:r.x,top:r.y,width:r.width,height:r.height}} />)}
   <div className={`mixer-guide__card ${mixerSection ? 'mixer-guide__card--top' : ''}`} role="dialog" aria-modal="true" aria-labelledby="mixer-guide-title" tabIndex={-1} ref={dialog}>
    <button type="button" className="mixer-guide__skip" onClick={close}>{es ? 'Omitir guía' : 'Skip guide'}</button>
    <span className="mixer-guide__progress">{current ? `${step! + 1} / ${steps.length}` : (es ? 'BIENVENIDA' : 'WELCOME')}</span>
    <h2 id="mixer-guide-title" key={step}>{current ? (es ? current.es : current.en) : (es ? 'Conoce tu mixer' : 'Meet your mixer')}</h2>
    <p>{current ? current.desc[es ? 0 : 1] : (es ? 'Descubre los controles y sus atajos. Puedes omitir la guía y volver a abrirla cuando quieras.' : 'Explore the controls and their shortcuts. You can skip this guide and open it again whenever you like.')}</p>
    {current && <div className="mixer-guide__shortcut">
     <strong>{es ? 'Atajos' : 'Shortcuts'}</strong>
     {shortcuts.length ? shortcuts.map((shortcut, row) => <div className="mixer-guide__shortcut-row" key={row}>
      {shortcut.label && <span className="mixer-guide__shortcut-label">{shortcut.label}</span>}
      <span className="mixer-guide__keys">{shortcut.keys.split(/(\s*[+/]\s*)/).filter(Boolean).map((part, index) => /^[\s+/]+$/.test(part) ? <span key={index}>{part}</span> : <kbd key={index} className="sd-keycap">{part.trim()}</kbd>)}</span>
      {shortcut.note && <span className="mixer-guide__shortcut-note">{shortcut.note}</span>}
     </div>) : <div>{es ? 'Sin atajo' : 'No shortcut'}</div>}
     {!settings.shortcutsEnabled && shortcuts.length > 0 && <div>{es ? 'Atajos desactivados en Ajustes' : 'Shortcuts disabled in Settings'}</div>}
    </div>}
    <div className="mixer-guide__actions">{current && <button type="button" onClick={() => setStep(step! - 1)}>{es ? 'Anterior' : 'Back'}</button>}<button type="button" className="mixer-guide__next" onClick={() => step === steps.length - 1 ? close() : setStep(step! + 1)}>{step === -1 ? (es ? 'Empezar' : 'Start') : step === steps.length - 1 ? (es ? 'Cerrar guía' : 'Close guide') : (es ? 'Siguiente' : 'Next')}</button></div>
   </div>
  </div>}
 </>;
};
