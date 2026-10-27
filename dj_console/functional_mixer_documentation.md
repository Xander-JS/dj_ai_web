# Documentación funcional de la sección Mixer — SYSTEM DJ

> **Alcance.** Inventario verificado de los controles, indicadores y comportamientos de la página **Mixer** (`/mixer`): Deck A, consola central de mezcla y Deck B. Cada afirmación se ha trazado en el código fuente hasta la acción del store (`useDJStore`) y, cuando aplica, hasta el motor de audio (`AudioEngineService`).
>
> **Estado del código inspeccionado.** Rama `refactor/ui-mixer` con cambios sin confirmar (incluye los archivos nuevos `ConsoleRecPanel`, `ConsoleTrackPicker`, `services/console/`, `services/session/`). La documentación describe el árbol de trabajo tal como estaba al inspeccionarlo.
>
> **Convenciones.** Los textos de interfaz se citan como `ES` / `EN`. «Store» = `src/store/useDJStore.ts`; «motor» = `src/audio/AudioEngineService.ts`. Escalas internas de controles: 0–100 salvo que se indique otra cosa.

---

## 1. Visión general de la sección Mixer

`src/pages/Mixer.tsx` compone tres columnas:

| Columna | Componente | Contenido |
|---|---|---|
| Izquierda | `<Deck deckName="A" />` | Cabecera con pista e indicadores, métricas musicales, forma de onda, 8 Hot Cues, editor de Downbeat, transporte (SYNC, ALIGN, BAR SYNC, CUE, PLAY), jog wheel, fader de pitch y Pitch Bend. |
| Centro | `<MixerConsole />` | Cabecera de estado, selectores de pista de la biblioteca (A/B) y panel REC, tiras de canal CH 1 / MASTER / CH 2, crossfader y selector de curva. |
| Derecha | `<Deck deckName="B" />` | Idéntico al Deck A (mismo componente). |

**Estado y persistencia (resumen).**

- Todo el estado de decks y mezcla vive en un *singleton* en memoria (`DJStore`). Se conserva al navegar entre secciones, pero **no se persiste**: al recargar la aplicación los decks quedan vacíos y la consola vuelve a los valores iniciales (canal 80 %, master 80 %, crossfader centrado, EQ plana). No se encontró ningún mecanismo de restauración de decks.
- Sí se persisten en IndexedDB, **por pista**: Hot Cues, CUE principal, downbeat confirmado y unidad de nota confirmada, y el análisis musical.
- Valores que vienen de **Ajustes** y se aplican al Mixer (`settingsEffects.ts`): rango del fader de pitch (`pitchRange`, ±8 % por defecto), tolerancia de SYNC (`syncRange`, ±8 % por defecto), modo del botón CUE (`cueMode`: `cdj` por defecto o `standard`), curva predeterminada del crossfader, disco del jog wheel y activación de atajos de teclado.

---

## 2. Inventario de todos los botones y controles

### 2.1 Deck A / Deck B (cada deck)

| # | Nombre visible | Tipo | Ubicación | Acción | Visible / habilitado cuando |
|---|---|---|---|---|---|
| D1 | `⏏` | Botón | Cabecera, junto al título | Descarga la pista del deck | Solo con pista cargada |
| D2 | Icono de diana | Botón conmutador | Cabecera | Marca/desmarca la pista como «referencia» (semilla) | Solo con pista cargada |
| D3 | Insignia de análisis (`Pendiente`, `Analizando...`, `Analizado`, `Error`, `No compatible`) | Indicador; **botón** en dos estados | Cabecera, 2.ª fila | Lanza el análisis musical si está en `Pendiente` o `Error` | Con pista cargada |
| D4 | `TEMPO`, `KEY`, `CAMELOT`, `ENERGÍA`, `TIME` | Indicadores | Bloque de métricas | Solo lectura | Siempre (muestran `—` sin datos) |
| D5 | Forma de onda | Superficie táctil (clic) | Bajo las métricas | Seek a la posición pulsada | Interactiva con duración > 0 |
| D6 | `BORRAR` / `CLEAR` | Botón conmutador | Cabecera de Hot Cues | Activa/desactiva el modo eliminación | Habilitado si hay pista y al menos 1 Hot Cue |
| D7 | Pads `1`…`8` | 8 botones | Banco de Hot Cues | Fijar / saltar / eliminar Hot Cue | Habilitados con pista |
| D8 | Campo `Posición (s):` | Entrada numérica | Editor `DOWNBEAT & COMPÁS` | Edita la posición candidata del downbeat | Editor visible solo con pista |
| D9 | `Cabezal` / `Playhead` | Botón | Editor de downbeat | Copia la posición actual al campo | Con pista |
| D10 | `Sugerido` / `Suggested` | Botón | Editor de downbeat | Copia la posición sugerida al campo | Con pista y posición sugerida disponible |
| D11 | `Métrica:` (`4/4`, `3/4`, `2/4`, `6/8`) | Selector | Editor de downbeat | Elige pulsos por compás / unidad de nota | Con pista |
| D12 | `Confirmar` / `Confirm` | Botón | Editor de downbeat | Persiste downbeat + compás como confirmación manual | Con pista y huella SHA-256 válida |
| D13 | `Limpiar` / `Clear` | Botón | Editor de downbeat | Borra la confirmación manual | Con downbeat confirmado |
| D14 | `SYNC` / `SYNC ✓` / `MASTER` | Botón conmutador | Fila de transporte | Iguala el BPM de un deck al del Master | Con pista |
| D15 | `ALIGN` / `NN%` | Botón | Fila de transporte | Alineación progresiva de fase de pulsos (micro-slew) | Con pista **y el deck sonando** |
| D16 | `BAR SYNC` y estados | Botón | Fila de transporte | Prepara el deck esclavo en la fase de compás del Master | Con pista |
| D17 | `CUE` | Botón momentáneo | Fila de transporte | Volver al CUE / previsualizar (CUP) / fijar CUE | Con pista |
| D18 | `PLAY` / `PAUSE` | Botón conmutador | Fila de transporte | Reproduce o pausa | Con pista |
| D19 | Jog wheel (disco con letra A/B) | **Elemento decorativo** | Centro del deck | Ninguna acción (gira al reproducir) | Siempre |
| D20 | Fader de pitch (`-8%` arriba, `+8%` abajo) | Fader vertical | Lateral del jog | Cambia la velocidad/tempo del deck | Con pista |
| D21 | `−` / `+` | Botones momentáneos | Bajo el fader de pitch | Pitch Bend −3,5 % / +3,5 % mientras se mantienen | Con pista |

### 2.2 Consola central (`MixerConsole`)

| # | Nombre visible | Tipo | Ubicación | Acción |
|---|---|---|---|---|
| C1 | `Consola de mezcla` + LED `En vivo` / `En espera` | Indicador | Cabecera de la consola | Muestra si algún deck reproduce |
| C2 | `Deck A` + `Cargar pista…` | Selector desplegable con buscador | Barra superior, izquierda | Carga una pista de la biblioteca en el Deck A |
| C3 | Panel REC: `ON`/`OFF`, tiempo `mm:ss`, botón `REC` | Indicadores + botón conmutador | Barra superior, centro | Inicia/detiene la grabación de la sesión |
| C4 | `Deck B` + `Cargar pista…` | Selector desplegable con buscador | Barra superior, derecha | Carga una pista en el Deck B |
| C5 | Cabecera de canal: insignia `A`/`B`, `CH 1`/`CH 2`, LED de señal | Indicadores | Parte superior de cada tira | Estado del canal |
| C6 | `GAIN` | Perilla bipolar | Tira CH 1 / CH 2 | Ganancia de entrada (trim) |
| C7 | `HI`, `MID`, `LOW` | Perillas bipolares compactas | Tira CH 1 / CH 2 | Ecualizador de 3 bandas |
| C8 | `FILTER` (leyenda `LPF` · `HPF`) | Perilla bipolar | Tira CH 1 / CH 2 | Filtro paso bajo / paso alto |
| C9 | `CUE` (con LED) | Botón conmutador | Tira CH 1 / CH 2 | Pre-escucha (PFL) — **solo visual, sin efecto de audio** |
| C10 | Fader de canal | Fader vertical | Tira CH 1 / CH 2 | Volumen del canal |
| C11 | Vúmetro de canal | Indicador | Junto al fader de canal | Nivel real del canal |
| C12 | `MASTER` | Perilla unipolar | Tira MASTER | Volumen de salida |
| C13 | Pantalla de espectro (16 barras) / `Sin señal` / `Silenciado` | Indicador | Tira MASTER | Espectro real de la mezcla |
| C14 | `MUTE` | Interruptor | Tira MASTER | Silencia la salida Master |
| C15 | Vúmetro Master | Indicador | Tira MASTER | Nivel real de la mezcla |
| C16 | `Crossfader` + letras `A` / `B` luminosas | Fader horizontal + indicadores | Parte inferior | Mezcla entre Deck A y Deck B |
| C17 | `Curva`: `CP`, `LIN`, `CUT` | Grupo de 3 botones (selección única) | Cabecera del crossfader | Curva de atenuación del crossfader |

### 2.3 Modelo de interacción común de perillas y faders

`ConsoleKnob` y `ConsoleFader` contienen un `<input type="range">` nativo oculto (paso 1, escala 0–100) que guarda el valor; el gráfico se deriva siempre del valor del store, por lo que también refleja cambios hechos por atajos.

| Componente | Ratón / táctil | Teclado (con foco) | Restablecer |
|---|---|---|---|
| Perilla (`ConsoleKnob`) | Arrastre vertical: 160 px recorren todo el rango; con **Shift**, ajuste fino ×4 (640 px) | Flechas / Inicio / Fin del range nativo | **Doble clic** vuelve al valor por defecto (50) en GAIN, HI, MID, LOW y FILTER. La perilla MASTER **no** tiene doble clic (no define valor por defecto). |
| Fader (`ConsoleFader`) | Arrastrar el pomo lo mueve sin salto; pulsar en la ranura lleva el pomo a ese punto | Flechas del range nativo | No tiene doble clic |

Arco luminoso de la perilla: en controles bipolares nace en el centro (50); en MASTER nace en el mínimo. El relleno de los faders de pitch y crossfader nace en el centro (`fillFrom = 50`).

---

## 3. Deck A: controles y funcionamiento

El Deck A y el Deck B son el **mismo componente** (`Deck.tsx`); este apartado describe su funcionamiento completo. El apartado 4 recoge solo las diferencias.

### 3.1 Cabecera

#### Título y artista
- Título: `track.title` o `Sin pista` / `No Track Loaded`.
- Segunda línea: el artista (`Desconocido` / `Unknown` si falta). Esta misma línea **se sustituye** por un mensaje de error en rojo (`role="alert"`) en dos casos:
  1. Un intento de SYNC fallido en este deck (`errorCode === 'sync_failed'`): muestra el texto `dj.sync_reject_*` correspondiente (ver §10.2).
  2. Error de reproducción (`playbackState === 'error'`): muestra el mensaje técnico de la excepción.

#### `⏏` Expulsar (D1)
- Tooltip: `Descargar pista de este deck` / `Unload track from this deck`. Etiqueta accesible: `Expulsar pista` / `Eject track`.
- Acción (`unloadDeck`): cancela una previsualización CUP, cancela ALIGN en **ambos** decks, detiene y libera el audio del deck, y devuelve el deck a su estado inicial **conservando la posición del fader de pitch**. Rompe la relación SYNC/MASTER en ambos decks; si el otro deck tenía BAR SYNC `ARMADO`/`ALINEADO`, lo devuelve a reposo. Registra el evento en la grabación de sesión.
- Interfaz: título `Sin pista`, métricas a `—`, pads y editor de downbeat desaparecen o se deshabilitan.

#### Diana — pista de referencia (D2)
- Tooltip: `Marcar como pista de referencia` / `Quitar pista de referencia`; `aria-pressed` refleja el estado; icono relleno cuando está marcada.
- Acción: `useSeedStore.toggleSeed(trackId)`. Al marcarla aparece la insignia `Referencia N` / `Reference N` (tooltip `Pista de referencia (semilla) usada para construir la mezcla`).
- Sin efecto de audio. Alimenta la generación de mezclas por referencia, que pertenece a otra sección y no se documenta aquí.

#### Insignia de rol SYNC
| Estado | Texto | Tooltip |
|---|---|---|
| Este deck es Master | `MASTER` | `Deck Master: marca el tempo de referencia. El otro deck lo sigue al activar SYNC.` |
| Este deck es esclavo con SYNC | `SLAVE ← B` (o `← A`) | `Deck esclavo: su BPM está igualado al del Deck {M} ({bpm} BPM) con un pitch de {pitch}, dentro del límite de ±{limit}%. La fase de los pulsos no se modifica.` |
| Sin SYNC | (oculta) | — |

#### Insignia de estado del análisis (D3)
| Estado | Texto | Tooltip | ¿Interactiva? |
|---|---|---|---|
| `pending` | 🕒 `Pendiente` / `Pending` | `Pendiente de análisis musical` | **Sí**: clic o Enter/Espacio lanza el análisis |
| `analyzing` | ⏳ `Analizando...` | `Análisis en curso...` | No |
| `analyzed` | ✓ `Analizado` / `Analyzed` | `Análisis musical completado` | No |
| `failed` | ⚠️ `Error` / `Failed` | Mensaje de error del análisis o `Error durante el análisis` | **Sí**: relanza el análisis forzado |
| `unsupported` | ℹ️ `No compatible` / `Unsupported` | Mensaje del analizador o `Audio no compatible o sin ritmo concluyente` | No |

- Cargar una pista en el deck **no** lanza el análisis automáticamente; si la pista no estaba analizada, el deck la muestra como `Pendiente` y el análisis se lanza con esta insignia (o desde la Biblioteca).
- Al terminar, el resultado se aplica al deck y actualiza TEMPO, KEY, CAMELOT, ENERGÍA, la forma de onda y la insignia `PROVISIONAL`.

#### Otras insignias de la cabecera
Se documentan en §7.2 (PROVISIONAL), §9 (DOWNBEAT ✓, COMPÁS SIN CONFIRMAR) y §3.6 (ALIGN y BAR SYNC).

### 3.2 Métricas musicales
Ver §7 para el detalle de cada indicador (`TEMPO`, `KEY`, `CAMELOT`, `ENERGÍA`, `TIME`).

### 3.3 Forma de onda
Ver §6.

### 3.4 Hot Cues
Ver §8.

### 3.5 Editor de downbeat y compás
Ver §9.

### 3.6 Fila de transporte

#### `SYNC` (D14)

| Estado | Texto | Estilo | Tooltip |
|---|---|---|---|
| Inactivo | `SYNC` | Normal | `SYNC: iguala el BPM de este deck al del deck Master ajustando el pitch (máximo ±{limit}%). No altera la fase de los pulsos.` |
| Esclavo activo | `SYNC ✓` | Relleno de color primario con brillo | `SYNC activo: BPM igualado al Deck {M} ({bpm} BPM), pitch {pitch} (límite ±{limit}%). La fase no se modifica; usa ALIGN o BAR SYNC para alinearla. Clic para desactivar.` |
| Este deck es Master | `MASTER` | Relleno ámbar | `Este deck es el Master: marca el tempo de referencia que sigue el deck esclavo.` |

`{limit}` es la tolerancia de SYNC configurada en Ajustes.

**Comportamiento al pulsar** (`syncDeck`):

1. **Elección de roles.** Si exactamente uno de los dos decks está reproduciendo, ese deck es el **Master** y el otro el esclavo, **con independencia de qué botón SYNC se pulse**. Si ambos suenan o ambos están parados, el deck pulsado es el esclavo y el opuesto el Master.
   - Consecuencia: pulsar SYNC en el deck que suena convierte al otro deck en esclavo.
2. **Desactivar.** Si el deck pulsado ya es esclavo con SYNC activo, SYNC se desactiva **conservando la velocidad actual** (el fader de pitch no salta) y ambos decks pierden el rol.
3. **Validaciones** (si alguna falla, no cambia nada y el mensaje aparece en la línea del artista del esclavo, ver §10.2):
   - Ambos decks con pista y con BPM analizado válido.
   - Compatibilidad de tempo: rechaza si los datos del análisis sugieren relación de mitad/doble tempo o si faltan evidencias (confianza, ambigüedad, BPM alternativo).
   - La velocidad requerida `(BPM_master × velocidad_master) / BPM_esclavo` debe quedar dentro de ±tolerancia de SYNC. No recorta: rechaza.
4. **Aplicar.** Fija la velocidad del esclavo en el motor, recoloca su fader de pitch en la posición equivalente, actualiza su TEMPO y asigna `MASTER` / `SLAVE ← X`.

- Solo afecta al **tempo**, nunca a la fase (no mueve la posición de reproducción).
- No usa el Pitch Bend momentáneo del Master.

**Cómo se rompe SYNC:**
- Mover el fader de pitch del esclavo: SYNC se desactiva en ese momento.
- Mover el fader del Master: el nuevo tempo se propaga al esclavo si cabe en la tolerancia. Si no cabe, el vínculo se rompe de forma silenciosa: se guarda un mensaje interno, pero la interfaz no lo muestra (ver §12).
- Cargar otra pista en cualquiera de los dos decks, expulsar una pista, o reducir en Ajustes la tolerancia de SYNC por debajo de la velocidad actual del esclavo (en ese caso el esclavo vuelve al rango del fader).

#### `ALIGN` (D15)

| Estado (`phaseAlignment.status`) | Texto del botón | Estilo | Tooltip |
|---|---|---|---|
| `idle` | `ALIGN` | Normal | `ALIGN: micro-ajuste progresivo de la fase de los pulsos según la retícula estimada (beatgrid provisional). Ambos decks deben estar sonando.` |
| `active` | `NN%` (progreso) | Color secundario, pulsante | (tooltip por defecto) |
| `completed` | `ALIGN` | Verde | `Maniobra de micro-slew finalizada (alineación acústica no certificada)` |
| `already_aligned` | `ALIGN` | Normal | `En tolerancia (<1ms)` |
| `cancelled` | `ALIGN` | Normal | `Cancelado` |
| `rejected_limits` | `ALIGN` | Borde rojo | `Límite ±8% excedido` |
| `rejected_confidence` | `ALIGN` | Borde rojo | `Beatgrid no fiable` |
| `rejected_state` | `ALIGN` | Borde rojo | `No se puede alinear con el estado actual de los decks` |

- **Habilitado** solo si el deck tiene pista **y está reproduciendo**.
- **Pulsar durante `active`** cancela la maniobra (`Cancelado`).
- **Pulsar en otro estado** (`alignPhase`):
  - El deck pulsado es siempre el esclavo y el opuesto la referencia. Se rechaza (`rejected_state`) si el deck pulsado es el Master de SYNC o si el otro deck no está sonando.
  - Exige BPM analizado y `firstBeatTime` válido en ambas pistas y que ninguna sea ambigua; si no, `rejected_confidence`.
  - Calcula un plan de *micro-slew*: una rampa temporal de la velocidad del esclavo que desplaza su fase hasta coincidir con el siguiente pulso estimado del Master.
  - Límites fijos del código: velocidad 0,92–1,08 (independiente de los Ajustes), duración máxima 10 s y tolerancia de 1 ms (`already_aligned`).
  - Durante la maniobra, el porcentaje se actualiza cada ~100 ms. Al terminar, el estado pasa a `completed`.
- Se cancela automáticamente con cualquier intervención de transporte o velocidad en **cualquiera** de los dos decks: pausa, stop, seek, salto a Hot Cue, fader de pitch, Pitch Bend, SYNC válido, carga o expulsión de pista.
- **Base de datos:** usa la retícula **provisional** (`firstBeatTime` + BPM del análisis), no el downbeat confirmado. El texto del propio sistema lo declara como alineación «no certificada».
- **Insignia de fase en la cabecera** (visible si el estado no es `idle`): `Modulando... (NN%)`, `Maniobra finalizada`, `Cancelado`, `Límite ±8% excedido`, `Beatgrid no fiable`, `En tolerancia (<1ms)`, `No se puede alinear con el estado actual de los decks`.

#### `BAR SYNC` (D16)
Ver §9.4 para la lógica completa. Resumen de estados del botón:

| Estado | Texto | Estilo |
|---|---|---|
| `idle` | `BAR SYNC` | Normal |
| `armed` | `ARMADO` / `ARMED` | Ámbar con brillo |
| `already_aligned` | `ALINEADO` / `ALIGNED` | Color primario |
| `completed` | `LISTO` / `DONE` | Verde |
| `cancelled` | `BAR SYNC` | Gris atenuado |
| `rejected_*` | `RECHAZADO` / `REJECT` | Rojo |

#### `CUE` (D17)
Tooltip: `CUE (Pulsar para volver a CUE, mantener en pausa para CUP)`.

Comportamiento (`handleCueDown` / `handleCueUp`) según el **modo CUE** de Ajustes:

| Situación | Modo `cdj` (por defecto) | Modo `standard` |
|---|---|---|
| Pulsar con el deck **reproduciendo** | Pausa y vuelve al punto CUE (o a 0:00 si no hay CUE) | Salta al punto CUE y **sigue sonando** |
| Pulsar con el deck **en pausa o parado** | Si no hay CUE, o el cabezal está a más de 50 ms del CUE, **fija el CUE en la posición actual** (persistido). Después reproduce desde el CUE mientras se mantiene pulsado (CUP). | Igual que `cdj` |
| **Soltar** tras una previsualización CUP | Pausa y vuelve al punto CUE | Igual |

- La previsualización también se libera al salir del botón con el puntero, al perder el foco, al cancelar el gesto táctil o al perder el foco la ventana.
- Teclado con foco en el botón: Espacio, Enter o `C` actúan como pulsar/soltar.
- Si durante la previsualización se pulsa PLAY (por ejemplo, con el atajo `F + Espacio`), la reproducción queda **enclavada** y al soltar CUE ya no se detiene.
- El punto CUE se muestra en la forma de onda como una línea ámbar con la etiqueta `C` (§6).
- Visual: brillo ámbar mientras está pulsado (`:active`).

#### `PLAY` / `PAUSE` (D18)
- Texto: `PLAY` en reposo y `PAUSE` mientras suena; estilo relleno al sonar y contorno en pausa. (El código prevé `...` durante la carga, pero ese estado no llega a producirse; ver §12.)
- PLAY (`playDeck`) reanuda desde la posición actual. Si el deck tiene BAR SYNC `ARMADO` o `ALINEADO`, arranca **sincronizado en fase con el Master** y el estado pasa a `LISTO` (§9.4).
- PAUSE (`pauseDeck`) conserva la posición exacta y cancela ALIGN en ambos decks.
- Si la reproducción falla, el deck pasa al estado `error`: se muestra el mensaje en la línea del artista y PLAY queda inoperante hasta cargar otra pista.
- Al llegar al final de la pista, el deck pasa a parado y vuelve a 0:00.

#### Jog wheel (D19)
- Muestra la imagen del disco elegido en Ajustes (`settings.jogDisc`), la letra del deck y un marcador.
- **No es interactivo**: está marcado como `aria-hidden` y no tiene manejadores. No hace scratch, nudge ni búsqueda.
- Gira solo mientras el deck reproduce, a 33⅓ rpm (1,8 s por vuelta) escalados por la velocidad real (`1,8 / max(0,5, playbackRate)` s por vuelta).

#### Fader de pitch (D20)
- Fader vertical **invertido**, como en un CDJ: el extremo superior es `-{rango}%` y el inferior `+{rango}%`. El rango (6, 8 o 16 %) viene de Ajustes. Centro = 0 %.
- Escala interna 0–100, paso 1, de modo que cada paso vale `rango/50` (0,16 % con ±8 %). Texto accesible: `+1.25%`, etc.
- Acción (`setPitchDeck`): `velocidad = 1 + ((valor − 50)/50) × rango`. Se aplica al motor como `playbackRate` del `AudioBufferSourceNode`, de modo que **cambia a la vez el tempo y la altura tonal** (no hay Key Lock / Master Tempo; ver §12). TEMPO se recalcula al instante.
- Efectos colaterales: cancela ALIGN en ambos decks; si este deck era esclavo con SYNC, desactiva SYNC; si este deck es Master, propaga el tempo al esclavo (§3.6 SYNC); borra los mensajes de rechazo de SYNC de ambos decks.
- No tiene doble clic para recentrar.
- Deshabilitado sin pista.

#### Pitch Bend `−` / `+` (D21)
- Tooltips: `Pitch Bend - (Frena temporalmente la velocidad -3.5%)` y `Pitch Bend + (Acelera temporalmente la velocidad +3.5%)`.
- Funcionamiento momentáneo: al pulsar aplica ±3,5 % sobre la velocidad nominal y al soltar (o al salir con el puntero o cancelar el gesto) vuelve a la velocidad nominal con una rampa de 40 ms. Espacio/Enter con foco funcionan igual.
- La velocidad efectiva se limita en el motor a `max(rango de pitch, tolerancia de SYNC)`.
- El botón activo se resalta (`btn-pitch-bend-active`).
- **TEMPO no refleja el bend**: muestra el BPM nominal del fader.
- Cancela ALIGN en ambos decks. No rompe SYNC ni mueve el fader.

### 3.7 Mensaje de BAR SYNC bajo el deck
Bajo los controles aparece una línea que empieza por `BAR SYNC:` en dos casos:
- **Rechazo efectivo:** el último intento de BAR SYNC fue rechazado. Muestra el motivo (`dj.bar_sync_reason_*`, §10.4) en estilo de alerta (`role="alert"`).
- **Bloqueo previsto:** la comprobación previa de la interfaz (`getBarSyncReadiness`) detecta un requisito sin cumplir. Muestra una indicación de guía (`dj.bar_sync_block_*`) que también se añade al tooltip del botón.

Por indicación del alcance, los textos de guía `dj.bar_sync_block_*` (del tipo «Carga una pista en el Deck B para usarlo como referencia») no se transcriben. Las condiciones que evalúan se describen en §9.4.

---

## 4. Deck B: controles y funcionamiento

El Deck B usa exactamente el mismo componente y la misma lógica que el Deck A (§3). Diferencias verificadas:

| Aspecto | Deck A | Deck B |
|---|---|---|
| Color de acento (forma de onda, progreso, título, KEY, CAMELOT, SYNC, fader de pitch) | Tono A | Tono B (`.dj-deck.deck-b …` en `Deck.css`; `tone="b"` en el fader) |
| Letra del jog wheel | `A` | `B` |
| Deck opuesto en textos (`SLAVE ← …`, tooltips de SYNC) | `B` | `A` |
| Atajos de transporte | CUE `Q`, SYNC `E`, PLAY `F + Espacio`, volumen `F + ↑/↓`, Pitch Bend `Shift + F + ↑/↓` | CUE `I`, SYNC `P`, PLAY `J + Espacio`, volumen `J + ↑/↓`, Pitch Bend `Shift + J + ↑/↓` |
| Atajos de Hot Cues | `1`–`4` → slots 1–4 | `7`, `8`, `9`, `0` → slots 1–4 |
| Canal de la consola | CH 1 | CH 2 |
| Atajo del selector de pista | `V` | `N` |

No hay diferencias funcionales en Hot Cues, downbeat, SYNC, ALIGN ni BAR SYNC. Los roles Master/esclavo los determina el estado (§3.6), no la posición del deck.

---

## 5. Controles centrales de mezcla y audio

### 5.1 Cadena de audio por canal (motor)

```
Fuente (AudioBufferSourceNode, playbackRate = pitch × bend)
  → GAIN → FILTER → EQ HI → EQ MID → EQ LOW → Fader de canal ─┬→ Analizador del canal (vúmetro, pre-crossfader)
                                                              └→ Ganancia del crossfader → MASTER ─┬→ Analizador Master (vúmetro + espectro)
                                                                                                    └→ Compresor/limitador (−1 dBFS, 20:1) → salida
```

### 5.2 Cabecera de la consola (C1)
- Título `Consola de mezcla` / `Mixing console`.
- LED con texto `En vivo` / `Live` (LED encendido) cuando algún deck reproduce, o `En espera` / `Standby` en caso contrario. Solo lectura.

### 5.3 Selectores de pista (C2, C4)
- Leyenda `Deck A` / `Deck B`; marcador de posición `Cargar pista…` / `Load track…`; muestra el título de la pista cargada en ese deck.
- Al abrirse **relee la biblioteca** de IndexedDB. Cada opción muestra el título y, como descripción, `artista · NNN BPM` (BPM redondeado, solo si está analizado). Incluye un buscador (`Buscar en la biblioteca`) que filtra por título y descripción; sin coincidencias muestra `Ninguna pista coincide`; con la biblioteca vacía muestra la opción deshabilitada `La biblioteca está vacía`.
- Elegir una pista llama a `loadTrackToDeck`, el mismo proceso que la Biblioteca:
  - Recupera el análisis, los CUE/Hot Cues y el downbeat persistidos y decodifica el audio.
  - **Solo después de decodificar** reemplaza la pista: si el deck sonaba, se detiene. La nueva pista queda parada en 0:00, conservando el pitch del fader.
  - Rompe SYNC, cancela ALIGN en ambos decks e invalida un BAR SYNC armado en el otro deck.
- Avisos (toast): éxito `Agregado a Deck X`; fallo `No se pudo cargar en Deck X`; excepción `Error al cargar en Deck X: {error}`; fallo de lectura de la biblioteca `No se pudo leer la biblioteca.`
- Atajo: `V` (Deck A) / `N` (Deck B) muestran u ocultan el desplegable. Con la lista abierta, la tecla del otro deck cierra esta y abre la otra.

### 5.4 Panel REC (C3)
- Lectura `ON` / `OFF` y tiempo `mm:ss`: en vivo mientras graba (refresco cada 500 ms), la duración final al detener, y `00:00` si no hay grabaciones. Al grabar, el panel cambia de estilo y el LED parpadea (salvo con animaciones desactivadas).
- Botón `REC` (`aria-pressed`). Tooltip/etiqueta: `Iniciar la grabación de la sesión` o `Detener y guardar la grabación`.
- Acción: `toggleSessionCaptureWithFeedback` → `sessionCaptureControl.toggle()`. **No graba audio aquí**: inicia o finaliza la captura de **eventos** de la sesión del DJ store (transporte, pitch, mezcla, cargas…). La sesión finalizada queda disponible en la sección Sesiones para exportarla.
- Requisitos para iniciar: algún deck reproduciendo y ninguna exportación en curso.
- Avisos: `Sesión guardada` (éxito) · `La grabación terminó sin eventos: no hay sesión que guardar.` · `Reproduce un deck para empezar a grabar la sesión.` · `Espera a que termine la exportación en curso para grabar.` · `No se pudo cambiar el estado de la grabación.`
- Atajo: `5` (reasignable).

### 5.5 Tira de canal CH 1 / CH 2

| Control | Escala UI | Valor inicial | Efecto en el motor | Texto accesible / tooltip |
|---|---|---|---|---|
| Insignia `A`/`B` + `CH 1`/`CH 2` | — | — | — | Se ilumina cuando el deck reproduce |
| LED de señal | — | Apagado | — | Tooltip: `{estado} · {señal}` con estado `Sin pista` / `Cargando` / `Reproduciendo` / `En pausa` y señal `con señal` / `sin señal`. Se enciende con el vúmetro del canal ≥ 2/100. |
| `GAIN` (bipolar) | 0–100, centro 50 | 50 | Ganancia lineal `valor/50` → 0,0×…2,0× (50 = 1,0×, máx. +6 dB) | `GAIN 1` |
| `HI` | 0–100, centro 50 | 50 | Shelving agudo a 2,5 kHz, `±12 dB` (`(valor−50)/50 × 12`) | `HI 1` |
| `MID` | 0–100, centro 50 | 50 | Campana a 1 kHz (Q = 1), ±12 dB | `MID 1` |
| `LOW` | 0–100, centro 50 | 50 | Shelving grave a 300 Hz, ±12 dB | `LOW 1` |
| `FILTER` (`LPF` · `HPF`) | 0–100, centro 50 | 50 | <50: paso bajo de 20 kHz a 200 Hz (exponencial); 50: neutro (*allpass*); >50: paso alto de 20 Hz a 8 kHz | Texto de valor: `Paso bajo NN %`, `Filtro neutro`, `Paso alto NN %` |
| `CUE` (PFL) | Conmutador | Apagado | **Ninguno** (ver abajo) | Tooltip `Pre-escucha del canal (PFL)`; `aria-pressed` |
| Fader de canal | 0–100 | 80 | Ganancia lineal `valor/100` | `CH 1 Volumen`, valor `NN%` |
| Vúmetro de canal | 0–100 | 0 | Solo lectura | `Nivel del canal 1` |

- **CUE (PFL) — implementación simulada.** Pulsarlo cambia `mixer.channelX.cuePfl`, enciende su LED y el botón queda marcado como pulsado. `setCuePfl` no llama al motor, y el motor no tiene salida de auriculares ni bus de pre-escucha. **No tiene ningún efecto sonoro.**
- **Sin estado deshabilitado:** las perillas y faders de canal funcionan aunque el deck esté vacío. El valor se aplica igualmente a los nodos del motor y se mantiene para la siguiente pista.
- **Vúmetro de canal:** RMS del analizador posterior al fader y anterior al crossfader, convertido a `min(100, round(RMS × 140))` y muestreado a ~30 Hz solo mientras ese deck reproduce (0 en caso contrario). Escala de LED fija con recorte; el LED de *clip* superior se enciende con nivel ≥ 95. Refleja GAIN, EQ, FILTER y el fader de canal, pero **no** el crossfader ni el Master.

### 5.6 Tira MASTER

| Control | Escala | Inicial | Efecto | Notas |
|---|---|---|---|---|
| `MASTER` (perilla unipolar) | 0–100 | 80 | Ganancia Master lineal `valor/100` | Si está silenciado, el valor nominal cambia pero la salida sigue en 0. Texto de valor `NN%` o `NN% · Silenciado`. Con MUTE el arco se atenúa. |
| Pantalla de espectro | 16 bandas | Vacía | Solo lectura | Lee el espectro FFT (fftSize 256) del analizador Master, posterior al volumen Master. Se actualiza a ~30 Hz mientras algún deck suena y no hay mute. En reposo muestra `Sin señal` / `No signal`; con MUTE, `Silenciado` / `Muted`. |
| `MUTE` | Interruptor | Desactivado | Pone la ganancia Master a 0 conservando el nivel nominal; al desactivarlo restaura el nivel | Tooltip: `Silenciar la salida Master` o `Master silenciado: pulsa para reactivar la salida`. Imagen de interruptor on/off y LED. Atajo `B`. |
| Vúmetro Master | 0–100 | 0 | Solo lectura | `Nivel Master`. RMS del analizador Master (posterior al volumen Master, anterior al limitador). Se fuerza a 0 con MUTE o si nada suena. LED de *clip* ≥ 95. |

### 5.7 Crossfader y curva (C16, C17)
- Fader horizontal 0–100 (0 = solo A, 100 = solo B, 50 = centro); marcas en 0, 25, 50, 75 y 100; relleno desde el centro. Texto accesible: `Crossfader entre Deck A y Deck B`, con valor `Deck A NN %, Deck B NN %` (ganancias reales).
- Letras `A` y `B` a los lados: su brillo, opacidad y borde se calculan con la **ganancia real** que aplica el motor a ese lado con la curva activa.
- Curvas (`calculateCrossfaderGains`, posición `p` ∈ [0,1]):

| Botón | Tooltip | Ley |
|---|---|---|
| `CP` | `Potencia constante` | `A = cos(p·π/2)`, `B = sin(p·π/2)` (−3 dB en el centro) |
| `LIN` | `Lineal` | `A = 1 − p`, `B = p` |
| `CUT` | `Corte rápido (Scratch)` | Ambos a 1 salvo en los extremos: A cae a 0 entre p = 0,95 y 1, y B sube desde 0 entre p = 0 y 0,05 |

- El botón activo se resalta (`aria-pressed`). Cambiar la curva recalcula las ganancias con la posición actual.
- La curva inicial sale de Ajustes; los botones la cambian solo para la sesión en curso (no se guarda). Atajo `Shift + ← / →` recorre las curvas.
- Atajos del crossfader: `←` / `→` en pasos de 5, con autorrepetición.

---

## 6. Formas de onda y sus elementos visuales

### 6.1 Qué representa
- Es una **forma de onda de amplitud de picos** (no un espectrograma ni una representación de pulsos). Cada barra es el **máximo valor absoluto de la muestra**, considerando todos los canales originales, dentro de un bloque de tiempo, normalizado a 0–1 respecto al pico más alto de la pista (`extractWaveformPeaks`).
- Barras simétricas respecto a una línea base discontinua central. Altura `max(2, pico × 54)` sobre un lienzo SVG de 100 × 60 estirado (`preserveAspectRatio="none"`).
- **Origen de los datos:** se calculan durante el **análisis musical** (`analysis.waveformPeaks`) y se guardan con él. Resolución: 2 picos por segundo, entre 100 y 1200 barras. Si la pista no está analizada, solo se ve la línea base (no hay forma de onda). Las pistas `No compatible` por silencio tienen picos a 0, que se dibujan como barras mínimas de 2 unidades.
- El eje X corresponde a toda la duración de la pista (vista general). Si el audio analizado y el cargado difieren en duración, la escala se ajusta (`waveformDurationSec / duración`) para que los picos coincidan en tiempo con el cabezal y los marcadores.

### 6.2 Comportamiento durante la reproducción
- **La forma de onda permanece fija**: no se desplaza ni hace zoom.
- El progreso se representa con:
  - **Relleno de progreso** semitransparente del color del deck, desde el inicio hasta la posición actual, con borde derecho.
  - **Cabezal (playhead):** línea vertical roja de 2 px.
  - Ambos se actualizan cada ~100 ms con una transición lineal de 100 ms.
- Mientras el análisis está en curso, las barras laten (animación de opacidad).

### 6.3 Marcadores superpuestos
| Marcador | Aspecto | Fuente | Tooltip |
|---|---|---|---|
| Hot Cue N | Línea vertical de 1 px del color del slot, con una etiqueta cuadrada `N` arriba | `deck.hotCues` | `Hot Cue N (m:ss)` |
| CUE principal | Línea ámbar de 2 px con etiqueta `C` abajo | `deck.mainCue` | `CUE (m:ss)` |
| Playhead | Línea roja de 2 px | `currentTime / duración` | — |

**No existen** marcadores de beatgrid, downbeat ni compases sobre la forma de onda. Ni el downbeat confirmado ni el `firstBeatTime` se dibujan en ella.

### 6.4 Interacción
- **Clic** en cualquier punto (con duración > 0): seek proporcional (`seekDeck`) que conserva el estado de reproducción. Tooltip: `Haz clic para buscar posición (Seek)`. El seek se limita a `[0, duración − 0,05 s]`.
- El seek cancela ALIGN en ambos decks y devuelve a reposo un BAR SYNC `ARMADO`/`ALINEADO` de este deck.
- **No admite arrastre**: solo el clic. Aunque declara `role="slider"`, no es enfocable ni responde al teclado.

### 6.5 Diferencias entre decks
Solo el color (tono A / tono B) de las barras y del relleno de progreso. El mecanismo es idéntico.

---

## 7. Indicadores de tiempo y análisis musical

### 7.1 Bloque de métricas

| Etiqueta | Valor mostrado | Origen | ¿Cambia en reproducción? | Sin datos |
|---|---|---|---|---|
| `TEMPO` | BPM **efectivo** con 1 decimal | `calculatedBpm = BPM analizado × playbackRate`. Usa cualquier análisis que no esté en `failed`/`unsupported` y tenga BPM > 0. | Sí: al mover el fader de pitch o activar SYNC. **No** refleja el Pitch Bend ni el micro-slew de ALIGN. | `—` |
| `KEY` | Tonalidad detectada (nombre de nota, p. ej. `C#`, con modo) | `analysis.key`, solo si el estado es `analyzed` | No (es estática). **No** se recalcula con el pitch aunque la altura tonal cambie. | `—` |
| `CAMELOT` | Código Camelot en insignia (p. ej. `8A`) | `analysis.camelot`, solo si el estado es `analyzed` | No | `—` |
| `ENERGÍA` / `ENERGY` | `N.0/10` | `analysis.energy`: índice **entero** 0–10 de una fórmula heurística (50 % sonoridad RMS, 30 % proporción de agudos > 2 kHz, 20 % densidad dinámica). Se muestra con un decimal, que siempre es `.0`. | No | `—` |
| `TIME` | Tiempo **restante** `-m:ss` (`-h:mm:ss` si pasa de una hora) | `duración − currentTime` | Sí, cada ~100 ms | `-0:00` |

- **Tiempo transcurrido:** no se muestra como valor visible. Solo aparece en el tooltip de `TIME`: `Posición actual: {s.sss}s / Duración: {s.sss}s`.
- Fiabilidad: KEY y CAMELOT solo se muestran si el detector no marcó la tonalidad como ambigua. El BPM puede ser `undefined` aunque el estado sea `analyzed` (si el BPM era ambiguo pero la tonalidad no), y entonces TEMPO muestra `—`. La interfaz **no muestra la confianza** del BPM ni de la tonalidad.
- La etiqueta `KEY` usa la clave de traducción `dj.key_lock`, pero **no es un control de Key Lock**: es solo un indicador.

### 7.2 Insignia `PROVISIONAL` (beatgrid estimado)
- Visible cuando la pista está `analyzed`, con `firstBeatTime` y BPM numéricos.
- Tooltip: `Beatgrid provisional basado en el primer transitorio detectado; no garantiza la identificación correcta del primer pulso del compás.`
- `firstBeatTime` es el **primer transitorio de percusión/bombo** detectado en los primeros 12 s (paso bajo a 220 Hz más curva de novedad). Es una **estimación**: ALIGN lo usa como referencia de pulso y el editor de downbeat lo ofrece como posición «sugerida» si no hay otra.

---

## 8. Hot Cues del 1 al 8

### 8.1 Representación
- Cabecera `HOT CUES` y botón `BORRAR` / `CLEAR`.
- Rejilla de 8 pads con el número del slot. Cada slot tiene un **color fijo**: 1 rojo, 2 naranja, 3 amarillo, 4 verde, 5 turquesa, 6 azul claro, 7 púrpura, 8 magenta.

| Estado del pad | Aspecto | Tooltip |
|---|---|---|
| Vacío | Fondo base, número gris; se eleva al pasar el puntero | `Fijar Hot Cue N` / `Set Hot Cue N` |
| Guardado | Fondo y borde del color del slot con brillo interior; muestra el número y la posición `m:ss` | `Saltar a Hot Cue N (m:ss)` |
| Guardado en modo eliminación | Borde y texto rojos, animación de vaivén | `Eliminar Hot Cue N` |
| Deshabilitado (sin pista) | Opacidad 35 % | — |

No existe un estado visual de Hot Cue «activo» o «en reproducción»: el pad no cambia al saltar a él.

### 8.2 Acciones

| Gesto | Pad vacío | Pad guardado |
|---|---|---|
| Clic | **Guarda** el Hot Cue en la posición actual del cabezal | **Salta** a su posición |
| Clic con modo `BORRAR` activo | Nada | **Elimina** |
| Shift + clic | Nada | **Elimina** |
| Clic derecho | Nada (se suprime el menú contextual) | **Elimina** |
| Atajo (Deck A `1`–`4`, Deck B `7`/`8`/`9`/`0`) | Guarda (slots 1–4) | Salta (slots 1–4) |

- **Guardar** (`setHotCue`): toma `currentTime` del store, que se refresca cada ~100 ms mientras suena. Al guardar durante la reproducción la posición puede ir hasta ~100 ms por detrás del audio. No se cuantiza a pulsos. Se redondea a milisegundos y se guarda primero en IndexedDB; **solo si se guarda** se actualiza la interfaz. Si falla, no hay cambio ni mensaje.
- **Saltar** (`jumpToHotCue` → `seekDeck`): coloca el cabezal en la posición **conservando el estado** (si sonaba sigue sonando; si estaba en pausa sigue en pausa). Cancela ALIGN en ambos decks e invalida un BAR SYNC armado de este deck.
- **Eliminar** (`deleteHotCue`): borra el slot en IndexedDB y en la interfaz.
- **Botón `BORRAR`** (tooltip `Modo eliminación de Hot Cues (o Shift+clic para borrar)`): alterna un modo local del deck y queda resaltado mientras está activo. El modo **no se desactiva solo** después de borrar. Si se borran todos los Hot Cues, el botón se deshabilita mientras el modo sigue activo internamente: los pads vacíos muestran el tooltip «Eliminar…» y el clic no hace nada hasta que el modo vuelve a desactivarse (cuando existe algún Hot Cue y se pulsa `BORRAR`).
- **Slots 5–8:** solo con el ratón; no tienen atajo de teclado.

### 8.3 Restricciones y persistencia
- Requieren una pista cargada (pads deshabilitados sin ella) y duración > 0. La posición debe estar dentro de la duración.
- **Persistencia por pista** (`indexedDBStorage.updateTrackCues`): se conservan al cambiar de pista, al recargar la aplicación y en sesiones posteriores. Al cargar la pista se restauran, descartando los que tengan un slot fuera de 1–8, pertenezcan a otra pista o queden fuera de la duración.
- Si la misma pista está cargada en ambos decks, guardar o eliminar un Hot Cue en uno actualiza también el otro.
- Si la base de datos no está disponible, se guardan solo en memoria.
- El restablecimiento de controles de Ajustes → Biblioteca (`resetMixerControls`) vacía los Hot Cues **en memoria** de los decks, sin borrarlos de IndexedDB: vuelven al recargar la pista.
- Los Hot Cues son iguales en ambos decks (mismo componente y la misma lógica).

---

## 9. Downbeat, pulsos y compases

### 9.1 Modelo de estados del downbeat (por pista)

| Estado | Significado | Cómo se llega |
|---|---|---|
| `none` (`SIN CONFIRMAR` / `UNCONFIRMED`) | No hay posición sugerida ni confirmada | Pista sin sugerencia ni `firstBeatTime` |
| `suggested` (`SUGERIDO (NO CONFIRMADO)`) | Hay una posición **calculada**, nunca válida para BAR SYNC | `track.downbeat.suggestedPosition` o, si no existe, `analysis.firstBeatTime` |
| `confirmed` (`CONFIRMADO (MANUAL)`) | Posición y pulsos por compás confirmados manualmente y **vinculados a la huella SHA-256** del archivo | Botón `Confirmar` |

La confirmación solo es válida si su huella coincide con la del contenido cargado. Si el archivo cambia, la confirmación se degrada a «sugerida».

**Compás completo** = downbeat confirmado + pulsos por compás + **unidad de nota** confirmada manualmente (`analysis.beatUnit`, estado `confirmed`). La unidad se guarda aparte; un downbeat confirmado sin unidad todavía bloquea BAR SYNC.

### 9.2 Editor `DOWNBEAT & COMPÁS` / `DOWNBEAT & BAR` (visible con pista)

| Elemento | Tipo | Comportamiento |
|---|---|---|
| Insignia de estado | Indicador | `CONFIRMADO (MANUAL)` (color primario), `SUGERIDO (NO CONFIRMADO)` (ámbar) o `SIN CONFIRMAR` (gris) |
| Detalle | Indicador | Confirmado: `{pos}s ({beats}/{unit})` (`?` si falta la unidad). Sugerido: `{pos}s`. |
| `Posición (s):` | Entrada numérica, paso 0,001, mín. 0, máx. duración | Valor inicial: la posición confirmada, si no la sugerida, si no `0.000`. Se reinicia al cambiar de pista o al confirmar/limpiar. Editarla deselecciona el botón de origen. |
| `Cabezal` (tooltip `Capturar posición actual del cabezal`) | Botón | Copia `currentTime` (3 decimales) al campo y queda marcado con un punto indicador |
| `Sugerido` (tooltip `Usar posición sugerida por el análisis como punto de partida`) | Botón | Copia la posición sugerida y queda marcado. Deshabilitado si no hay sugerencia. |
| `Métrica:` (tooltip `Compás de la pista: pulsos por compás / unidad de nota. BAR SYNC exige el mismo compás en ambos decks.`) | Selector | `4/4`, `3/4`, `2/4`, `6/8`. Inicial: la métrica confirmada (unidad 4 si falta) o `4/4`. |
| `Confirmar` (tooltip `Confirmar downbeat y métrica de compás manualmente`) | Botón | Valida que la posición esté entre 0 y la duración. Persiste el downbeat (posición redondeada a ms, pulsos por compás, huella, fecha, origen `manual`) y después la unidad de nota confirmada. Actualiza ambos decks si tienen la misma pista e invalida preparaciones de BAR SYNC obsoletas. |
| `Limpiar` (tooltip `Limpiar confirmación manual existente`) | Botón | Solo con confirmación. Vuelve a `suggested` (si había sugerencia) o `none` y elimina la unidad confirmada. |

- Mientras guarda, los controles del editor se deshabilitan.
- Sin huella SHA-256 válida: `Confirmar` queda deshabilitado (tooltip `No se puede confirmar: la pista no dispone de huella SHA-256 válida`) y aparece el aviso `Confirmación no disponible: la pista carece de una huella SHA-256 válida.`
- Con downbeat confirmado pero sin unidad, aparece el aviso `El downbeat está confirmado, pero falta la unidad de nota del compás. Elige el compás (p. ej. 4/4) y pulsa Confirmar de nuevo para habilitar BAR SYNC.`
- Errores: `La posición debe ser un número válido entre 0 y la duración de la pista.` · `Error al persistir downbeat en almacenamiento local.`

### 9.3 Indicadores de compás en la cabecera
| Insignia | Condición | Texto | Tooltip |
|---|---|---|---|
| Downbeat confirmado | Confirmación válida para la huella actual | `DOWNBEAT ✓ 4/4` (`4/?` sin unidad) | `Downbeat confirmado manualmente: {pos}s ({métrica})` |
| Compás pendiente | Con pista y sin downbeat confirmado | `COMPÁS SIN CONFIRMAR` / `METER NOT CONFIRMED` | `Confirma el downbeat y el compás (p. ej. 4/4) en el editor de downbeat para poder usar BAR SYNC con esta pista.` |
| Unidad pendiente | Downbeat confirmado sin unidad | `UNIDAD SIN CONFIRMAR` / `NOTE VALUE NOT CONFIRMED` | Texto de §9.2 |

**No existe** en la interfaz un contador de pulso o compás en curso (p. ej. «compás 12 · pulso 3»), ni marcas de pulsos o compases sobre la forma de onda. Los únicos números relacionados son la posición del downbeat en segundos y la métrica `N/M`.

### 9.4 BAR SYNC — lógica completa
**Propósito:** colocar el deck **esclavo, parado o en pausa,** en la misma fase de compás que el Master que suena, usando los downbeats **confirmados**. Al pulsar PLAY, el esclavo arranca en fase.

**Comprobación previa (solo informativa, `getBarSyncReadiness`).** No deshabilita el botón; solo genera el mensaje de guía. Comprueba, en este orden:
1. El deck no es el Master.
2. Hay pista en este deck y en el opuesto.
3. Compás completo confirmado en este deck y en el opuesto.
4. Mismos pulsos por compás y misma unidad.
5. BPM efectivos iguales (diferencia relativa ≤ 0,02 %).
6. El opuesto está sonando.
7. Este deck no está sonando.

**Al pulsar** (habilitado con pista):
- Si el estado es `ARMADO` o `ALINEADO`: **cancela** la preparación (estado `cancelled`, tooltip `La preparación de compás se canceló manualmente.`).
- En otro caso, `prepareBarSync`:
  1. Rechazos de estado (`rejected_state`): el deck es Master, el Master no suena, el esclavo suena, o la pista o el transporte cambiaron durante el cálculo.
  2. Pistas y BPM válidos; si no, `rejected_limits`.
  3. Planificador puro (`calculateBarSyncPlan`): exige confirmación manual vinculada a la huella en ambas pistas (`rejected_unconfirmed` / `rejected_no_downbeat`) y unidad confirmada manual en ambas (`rejected_unconfirmed`). Rechaza análisis ambiguo o con hipótesis de mitad/doble tempo (`rejected_confidence`) y métricas distintas (`rejected_metric_mismatch`). La posición objetivo debe caer dentro de la pista (`rejected_limits`).
  4. Fórmula: `posición_esclavo = D_esclavo + (k + φ_Master) × T_compás_esclavo`, con `φ_Master = ((t_Master − D_Master) mod T_compás_Master) / T_compás_Master` y `T_compás = pulsos × 60 / BPM_efectivo`. `k` es el compás del esclavo más cercano a su posición actual.
  5. Exige el **mismo BPM efectivo** (tolerancia 2·10⁻⁴); si no, `rejected_tempo_mismatch` («Activa SYNC antes…»). En la práctica hay que activar SYNC primero.
  6. Si el esclavo ya está a ≤ 5 ms de la posición objetivo: `ALINEADO`, sin mover el cabezal.
  7. Si no: mueve el cabezal a la posición objetivo, verifica que el motor lo aceptó (±10 ms) y marca `ARMADO`. El deck **no empieza a sonar** y **no se cambia** el tempo, el pitch ni SYNC.

**Lanzamiento.** Con `ARMADO`/`ALINEADO`, PLAY recalcula la fase del Master en el instante real de arranque (con 30 ms de antelación programada) y arranca el esclavo en la posición proyectada del compás preparado (`playDeckPhaseLocked`). El estado pasa a `LISTO`. Si el lanzamiento en fase no es posible, se hace un PLAY normal y el estado también pasa a `LISTO`.

**Invalidan la preparación** (vuelve a reposo): seek/clic en la forma de onda, salto a Hot Cue, CUE durante la reproducción, STOP, fin de pista, cargar pista en el otro deck, expulsar cualquiera de los dos y confirmar/limpiar un downbeat.

**Insignia de cabecera BAR SYNC** (visible si el estado no es `idle`):

| Estado | Texto | Tooltip |
|---|---|---|
| `armed` | `BAR SYNC ARMADO ({pos}s, Δ {±d.dd}s)` | `Preparado en fase de compás coincidente: {pos}s (Previa: {prev}s, Δ {disp}s, downbeat confirmado de referencia: {target}s, {beats} pulsos/compás). PLAY arranca en fase con el Master.` |
| `already_aligned` | `BAR SYNC ALINEADO ({pos}s, Δ …)` | `Ya situado en la fase de compás coincidente: …` |
| `completed` | `BAR SYNC LISTO` | `Slave lanzado en fase con el Master a partir de los downbeats confirmados.` |
| `cancelled` | `BAR SYNC CANCELADO` | `La preparación de compás se canceló manualmente.` |
| `rejected_*` | `BAR SYNC RECHAZADO` | Motivo `dj.bar_sync_reason_*` (§10.4) |

Tooltips del botón en `ARMADO`/`ALINEADO`: `BAR SYNC ARMED: compás preparado en {pos}s (Previa…, Δ…, {beats} pulsos/compás). PLAY arranca en fase con el Master (clic para cancelar).` y su equivalente `ALIGNED … (clic para limpiar)`.

### 9.5 Calculado, sugerido y confirmado: resumen
| Dato | Naturaleza | Lo usa |
|---|---|---|
| `firstBeatTime` | **Calculado** (primer transitorio) | ALIGN; posición sugerida de reserva; insignia PROVISIONAL |
| `downbeat.suggestedPosition` | **Sugerido** (no confirmado) | Botón `Sugerido`; estado `SUGERIDO` |
| `downbeat.confirmation` + `beatUnit` confirmado | **Confirmado** manualmente y vinculado a la huella | BAR SYNC (único consumidor) |

---

## 10. Mensajes funcionales asociados a controles e interacciones

> Se excluyen los textos de guía general (`dj.bar_sync_block_*`) según el alcance pedido (ver §3.7).

### 10.1 Textos de estado de los botones
| Control | ES | EN |
|---|---|---|
| PLAY | `PLAY` / `PAUSE` | igual |
| CUE (deck) | `CUE` | igual |
| SYNC | `SYNC` · `SYNC ✓` · `MASTER` | igual |
| ALIGN | `ALIGN` · `NN%` | igual |
| BAR SYNC | `BAR SYNC` · `PREPARANDO...` · `ARMADO` · `ALINEADO` · `LISTO` · `RECHAZADO` | `BAR SYNC` · `PREPARING...` · `ARMED` · `ALIGNED` · `DONE` · `REJECT` |
| Hot Cues | `HOT CUES`, `BORRAR` | `HOT CUES`, `CLEAR` |
| Editor de downbeat | `Cabezal`, `Sugerido`, `Confirmar`, `Limpiar` | `Playhead`, `Suggested`, `Confirm`, `Clear` |
| Consola | `GAIN`, `HI`, `MID`, `LOW`, `FILTER`, `LPF`, `HPF`, `CUE`, `MASTER`, `MUTE`, `REC`, `ON`/`OFF`, `CP`/`LIN`/`CUT`, `Curva` | `Curve` en lugar de `Curva`; el resto igual |
| Estado de la consola | `En vivo` / `En espera` | `Live` / `Standby` |

`PREPARANDO...` existe en el código, pero el cálculo es síncrono y el estado se activa y desactiva en el mismo evento, así que en la práctica no llega a verse (ver §12).

**Textos que se repiten con significados distintos:**
- `CUE` aparece en el **transporte del deck** (volver/previsualizar el punto CUE, con efecto de audio) y en la **tira de canal** de la consola (pre-escucha PFL, solo visual).
- `MASTER` aparece en el botón SYNC del deck (rol de referencia de tempo), en la insignia de rol y en la tira y perilla MASTER de la consola (volumen de salida).
- `ALINEADO` / `ALIGNED` corresponde a un estado de BAR SYNC. «En tolerancia (<1ms)» es el equivalente en ALIGN.

### 10.2 Rechazos de SYNC (sustituyen al artista del deck esclavo)
| Clave | ES |
|---|---|
| `sync_reject_slave_track` | `SYNC rechazado: este deck no tiene una pista cargada.` |
| `sync_reject_slave_bpm` | `SYNC rechazado: la pista de este deck no tiene un BPM analizado válido.` |
| `sync_reject_master_track` | `SYNC rechazado: el deck opuesto no tiene una pista cargada para actuar como Master.` |
| `sync_reject_master_bpm` | `SYNC rechazado: la pista del deck Master no tiene un BPM analizado válido.` |
| `sync_reject_insufficient_evidence` | `SYNC rechazado: ambos decks requieren BPM, confianza suficiente, análisis no ambiguo y candidatos alternativos.` |
| `sync_reject_half_time` | `SYNC rechazado: el BPM alternativo del Slave coincide con el BPM principal del Master ({m} frente a {s} BPM). Confirma el nivel del pulso antes de usar SYNC.` |
| `sync_reject_double_time` | `SYNC rechazado: el BPM alternativo del Master coincide con el BPM principal del Slave (…). Confirma el nivel del pulso antes de usar SYNC.` |
| `sync_reject_pitch_limit` | `SYNC rechazado: el tempo objetivo ({t} BPM) excede la tolerancia de SYNC configurada para esta pista ({b} BPM).` |

El mensaje se borra con un SYNC correcto, al mover cualquier fader de pitch, al cargar una pista en el otro deck o al expulsar.

### 10.3 Estados de ALIGN
Ver la tabla de §3.6: `Modulando...`, `Maniobra finalizada`, `Cancelado`, `Límite ±8% excedido`, `Beatgrid no fiable`, `En tolerancia (<1ms)`, `No se puede alinear con el estado actual de los decks`.

### 10.4 Motivos de rechazo de BAR SYNC (`dj.bar_sync_reason_*`)
| Estado | ES |
|---|---|
| `rejected_state` | `No se puede preparar BAR SYNC con el estado actual: el Master debe reproducirse y el Slave debe estar detenido o pausado.` |
| `rejected_unconfirmed` | `BAR SYNC requiere el downbeat y el compás (pulsos y unidad de nota) confirmados manualmente en ambas pistas. Confírmalos en el editor de downbeat.` |
| `rejected_no_downbeat` | `No hay un downbeat confirmado disponible para ambas pistas.` |
| `rejected_metric_mismatch` | `Los pulsos por compás y la unidad de nota confirmados deben coincidir en ambas pistas.` |
| `rejected_limits` | `Comprueba que ambas pistas tengan posiciones, duración y BPM válidos.` |
| `rejected_confidence` | `BAR SYNC requiere BPM fiable y no ambiguo, sin hipótesis de mitad o doble tempo sin resolver.` |
| `rejected_tempo_mismatch` | `BAR SYNC requiere el mismo BPM efectivo en ambos decks. Activa SYNC antes de preparar el compás.` |
| (otro) | `No se pudo preparar BAR SYNC por las condiciones actuales.` |

### 10.5 Avisos (toasts) de la consola
| Acción | Tipo | ES |
|---|---|---|
| Carga desde el selector correcta | éxito | `Agregado a Deck X` |
| Carga fallida | error | `No se pudo cargar en Deck X` |
| Excepción al cargar | error | `Error al cargar en Deck X: {error}` |
| Lectura de la biblioteca fallida | error | `No se pudo leer la biblioteca.` |
| REC detenido con sesión | éxito | `Sesión guardada` |
| REC detenido sin eventos | aviso | `La grabación terminó sin eventos: no hay sesión que guardar.` |
| REC sin audio sonando | aviso | `Reproduce un deck para empezar a grabar la sesión.` |
| REC con exportación en curso | aviso | `Espera a que termine la exportación en curso para grabar.` |
| REC con error | error | `No se pudo cambiar el estado de la grabación.` |

### 10.6 Tooltips de acción (resumen)
Expulsar, diana, insignia de análisis, seek, Hot Cues (`Fijar` / `Saltar a` / `Eliminar Hot Cue N`), `BORRAR`, CUE, SYNC, ALIGN, BAR SYNC, Pitch Bend, botones del editor de downbeat, CUE (PFL), MUTE, curvas `Potencia constante` / `Lineal` / `Corte rápido (Scratch)` y REC: textos citados en las secciones correspondientes.

---

## 11. Relaciones entre controles y comportamiento interno

| Relación | Comportamiento verificado |
|---|---|
| **Play/Pause ↔ posición** | Pausa guarda la posición exacta del motor y Play reanuda desde ella. El store refresca `currentTime` cada ~100 ms (playhead, TIME, Hot Cues y el botón `Cabezal` se basan en ese valor). Al terminar la pista: parado en 0:00. |
| **Volumen de canal ↔ crossfader ↔ Master** | Ganancia final de cada deck = GAIN × EQ/FILTER × fader de canal × ganancia del crossfader (según la curva) × Master (0 con MUTE), y después el limitador. El vúmetro de canal mide **antes** del crossfader; el Master mide después del volumen Master. |
| **SYNC ↔ BPM ↔ pitch** | SYNC iguala el **tempo** moviendo la velocidad y el fader de pitch del esclavo dentro de la tolerancia de SYNC (que puede superar el rango del fader). Mover el pitch del Master arrastra al esclavo; mover el pitch del esclavo rompe SYNC. Pitch Bend no afecta a SYNC ni a TEMPO. |
| **SYNC vs ALIGN vs BAR SYNC** | **SYNC:** solo tempo, nunca fase. **ALIGN:** fase de **pulsos** sobre la retícula **provisional**, con ambos decks sonando y rampa temporal de velocidad (≤10 s, 0,92–1,08), sin seek. **BAR SYNC:** fase de **compás** sobre downbeats **confirmados**, con el esclavo parado y el Master sonando; reposiciona el cabezal (seek) y lanza en fase con PLAY. Requiere tempos iguales (en la práctica, SYNC antes). Ninguno inicia la reproducción por sí mismo. |
| **Hot Cues ↔ posición** | Guardar toma `currentTime`. Saltar es un seek que conserva play/pausa, cancela ALIGN e invalida BAR SYNC armado. |
| **CUE ↔ posición** | En pausa, CUE fija el punto CUE si el cabezal se movió más de 50 ms. Sonando, vuelve al CUE (pausando en modo `cdj`). El punto CUE se persiste por pista. |
| **Downbeat/compás ↔ sincronización** | Solo BAR SYNC consume el downbeat confirmado y la unidad de nota. Cambiar la confirmación invalida preparaciones obsoletas. ALIGN usa el `firstBeatTime` estimado. |
| **Análisis ↔ indicadores** | El análisis aporta BPM, KEY, CAMELOT, ENERGÍA, la forma de onda, `firstBeatTime` (PROVISIONAL / sugerido) y la confianza y ambigüedad usadas en los rechazos de SYNC, ALIGN y BAR SYNC. Sin análisis, SYNC, ALIGN y BAR SYNC se rechazan y la forma de onda queda vacía. |
| **Selector de pista / expulsar ↔ sincronización** | Cargar o expulsar rompe SYNC, cancela ALIGN en ambos decks e invalida BAR SYNC armado en el otro deck. |
| **REC ↔ resto de controles** | Mientras graba, registra los eventos de transporte, pitch, Pitch Bend, SYNC, micro-slew, ganancia, EQ, filtro, volumen, crossfader y Master. No registra CUE (PFL) ni los Hot Cues como eventos propios (sus saltos quedan como seek). |

### 11.1 Atajos de teclado que actúan sobre controles del Mixer
Son globales: se instalan en `window` si están activados en Ajustes. Se ignoran si el foco está en un campo editable, en un control nativo (incluidos los range de perillas y faders) o si hay Ctrl/Alt/Meta pulsado.

| Atajo | Acción | Equivale a |
|---|---|---|
| `F + Espacio` / `J + Espacio` | Play/Pause A / B | D18 |
| `Q` / `I` (mantener) | CUE A / B | D17 |
| `E` / `P` | SYNC A / B | D14 |
| `1`–`4` / `7`,`8`,`9`,`0` | Hot Cues 1–4 de A / B | D7 |
| `F + ↑/↓` / `J + ↑/↓` | Fader de canal ±2 | C10 |
| `Shift + F/J + ↑/↓` (mantener) | Pitch Bend | D21 |
| `↑ / ↓` | MASTER ±2 | C12 |
| `← / →` | Crossfader ±5 | C16 |
| `Shift + ← / →` | Curva anterior/siguiente | C17 |
| Mantener selectora + `← / →` (por defecto A: `G` gain, `W` hi, `D` mid, `A` low, `S` filter; B: `H`, `O`, `Ñ`, `K`, `L`) | Parámetro ±2 | C6–C8 |
| `B` | MUTE | C14 |
| `5` | REC | C3 |
| `V` / `N` | Selector de pista A / B | C2 / C4 |

No hay atajos para ALIGN, BAR SYNC, el fader de pitch, CUE (PFL), los Hot Cues 5–8 ni el editor de downbeat.

---

## 12. Funcionalidades implementadas, parciales, simuladas y pendientes

### 12.1 Implementadas y verificadas hasta el motor de audio
Play/Pause, CUE (modos `cdj`/`standard` con CUP), seek por clic en la forma de onda, Hot Cues 1–8 con persistencia, fader de pitch, Pitch Bend, SYNC de tempo Master/esclavo, ALIGN (micro-slew), BAR SYNC con lanzamiento en fase, editor de downbeat con persistencia vinculada a la huella, GAIN, EQ de 3 bandas, FILTER bipolar, faders de canal, crossfader con 3 curvas, volumen Master, MUTE, vúmetros reales de canal y Master, espectro real del Master, selector de pista desde la biblioteca y REC (captura de eventos de sesión).

### 12.2 Simuladas o solo visuales
| Elemento | Situación |
|---|---|
| **CUE (PFL) de canal** | Solo cambia el estado y el LED. El motor no tiene bus ni salida de auriculares. **Sin efecto de audio.** |
| **Jog wheel** | Decorativo: gira con la reproducción, pero no admite interacción (ni scratch, ni nudge, ni búsqueda). |

### 12.3 Parciales o con limitaciones observadas
| Elemento | Observación |
|---|---|
| Estado `loading` del deck | Está declarado y la interfaz lo contempla (`...` en PLAY, deshabilitar controles, LED «Cargando», selector deshabilitado), pero `loadTrackToDeck` **nunca asigna** `playbackState = 'loading'`. Durante la carga el deck muestra la pista anterior (o vacía) y sus controles siguen operativos. |
| `PREPARANDO...` de BAR SYNC | Se activa y desactiva en el mismo manejador síncrono, por lo que no llega a renderizarse. |
| Rotura de SYNC por el Master | Si el Master supera la tolerancia del esclavo, SYNC se desacopla y se guarda un `errorMessage` («SYNC desactivado: …»), pero sin `errorCode`. Como el deck no está en estado `error`, **el mensaje no se muestra**: el usuario solo ve que desaparecen `SLAVE`/`MASTER`. |
| Límite de ALIGN | El texto `Límite ±8% excedido` y el límite 0,92–1,08 son fijos en el código; no siguen el rango de pitch ni la tolerancia de SYNC de Ajustes. |
| CUP con BAR SYNC armado | Mantener CUE en pausa con BAR SYNC `ARMADO` reproduce desde el punto CUE con un arranque normal (**no** en fase) y aun así marca BAR SYNC como `LISTO`. |
| Precisión de Hot Cues / `Cabezal` durante la reproducción | Usan `currentTime` del store (refresco de ~100 ms), no la posición instantánea del motor. |
| Modo `BORRAR` | No se desactiva solo; puede quedar activo con el botón deshabilitado (§8.2). |
| Forma de onda | Solo admite clic (sin arrastre), no es accesible por teclado pese a `role="slider"`, no hace zoom ni desplazamiento y no dibuja beatgrid ni downbeat. |
| Insignias de BAR SYNC | Los estados `rejected_no_downbeat` y `rejected_tempo_mismatch` no tienen regla de color específica en `Deck.css` (el resto de rechazos sí). |
| Faders de pitch y Master | Sin doble clic para volver al centro o a un valor por defecto. |
| Atajos de Hot Cues | Solo slots 1–4 por deck. |

### 12.4 Pendientes o no implementadas
| Elemento | Evidencia |
|---|---|
| **Key Lock / Master Tempo** | `DeckState.isKeyLocked` y `DeckActions.toggleKeyLock` existen en `types/deck.ts`, pero no hay implementación en el store ni control en la interfaz. El pitch cambia la altura tonal. La etiqueta `KEY` (`dj.key_lock`) es solo un indicador. |
| Códigos de error `file_missing` / `decode_failed` | Declarados en `DeckErrorCode`, pero ningún código los asigna. Un fallo de carga solo produce el toast `No se pudo cargar en Deck X`. |
| `CUE / STOP` (`dj.cue_stop`) y `dj.analyze_deck` / `dj.reanalyze_deck` | Hay traducciones, pero ningún componente del Mixer las usa. |
| Contador de pulso o compás y beatgrid visible | No existen en la interfaz. |
| Persistencia del estado de la consola y de los decks entre recargas | No implementada (solo en memoria). |

### 12.5 No verificable con el código
- La calidad acústica real de ALIGN y BAR SYNC (el código la declara «no certificada»), la precisión de los detectores de BPM, tonalidad y primer pulso, y la latencia efectiva: requieren pruebas de escucha o medición en ejecución, no inspección.
- El formato exacto del nombre de tonalidad que muestra `KEY` (nota más modo) depende de `camelotMapper.ts`. Se verificó la lista de notas (`C`, `C#`, …, `B`), no todas las salidas posibles.

---

## 13. Archivos fuente revisados

**Página y componentes**
- `src/pages/Mixer.tsx`, `src/pages/Mixer.css`
- `src/components/dj/Deck.tsx`, `Deck.css`
- `src/components/dj/Waveform.tsx`
- `src/components/dj/MixerConsole.tsx`, `MixerConsole.css`, `consoleTheme.css`
- `src/components/dj/ConsoleKnob.tsx`, `ConsoleFader.tsx`
- `src/components/dj/ConsoleTrackPicker.tsx`, `ConsoleRecPanel.tsx`, `ConsoleRecPanel.css`
- `src/components/molecules/SelectMenu.tsx` (comportamiento del desplegable)

**Estado y motor**
- `src/store/useDJStore.ts` (carga, transporte, CUE/CUP, Hot Cues, pitch, Pitch Bend, SYNC, ALIGN, BAR SYNC, downbeat, mezcla, bucle de tiempo)
- `src/audio/AudioEngineService.ts` (grafo de audio, EQ/filtro/crossfader/Master, vúmetros, espectro, micro-slew, lanzamiento en fase)
- `src/audio/djAudioMath.ts` (curvas del crossfader, ley del filtro)
- `src/store/useSettingsStore.ts`, `src/services/settings/settingsEffects.ts`

**Análisis y ritmo**
- `src/audio/analysis/audioAnalyzer.ts` (picos de la forma de onda, resultado del análisis)
- `src/audio/analysis/bpmDetector.ts` (`detectFirstBeatTime`), `energyCalculator.ts`, `camelotMapper.ts`, `keyDetector.ts` (formato), `phaseAlignment.ts` (límites de ALIGN), `barSync.ts`, `tempoCompatibility.ts`
- `src/utils/downbeat.ts`, `src/utils/barSyncReadiness.ts`, `src/utils/formatters.ts`
- `src/services/storage/IndexedDBStorage.ts` (persistencia de cues y downbeat)

**Servicios de la consola**
- `src/services/console/trackPickerBridge.ts`
- `src/services/session/sessionCaptureControl.ts`, `sessionCaptureFeedback.ts`
- `src/services/keyboard/keyboardShortcuts.ts`, `djShortcutTarget.ts`

**Tipos y traducciones**
- `src/types/deck.ts`, `src/types/mixer.ts`, `src/types/track.ts`
- `src/i18n/locales/es/translation.json`, `src/i18n/locales/en/translation.json` (espacios `dj.*`, `mixer.*` y claves `library.*` y `seed.*` usadas por el deck)
