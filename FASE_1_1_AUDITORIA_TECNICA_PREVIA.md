# Fase 1.1 — Auditoría técnica previa a pruebas acústicas

**Alcance:** revisión de código y pruebas de SYNC, ALIGN y BAR SYNC. No se modificó la implementación ni se ejecutaron pruebas.  
**Repositorio observado:** rama `feat/marlon`; `git status --short --branch` mostró únicamente `## feat/marlon`, sin cambios locales reportados antes de crear este informe.

## 1. Resumen ejecutivo

**Conclusión — confirmado:** el proyecto contiene lógica funcional de transporte para los tres controles, pero todavía no dispone de evidencia ni instrumentación suficiente para declarar que alguno alinea acústicamente dos pistas reales.

- **SYNC** iguala los BPM efectivos ajustando el `playbackRate` del esclavo. No consulta la fase de beat ni reposiciona el audio. BPM igualado no demuestra beats coincidentes.
- **ALIGN** estima los beats a partir de BPM y `firstBeatTime`, elige pulsos futuros y aplica una rampa de velocidad al `AudioParam`. Su retícula se declara expresamente provisional y el primer transitorio no se considera downbeat.
- **BAR SYNC** usa downbeats y métrica que una persona confirma, calcula una posición de compás y hace seek al deck esclavo detenido o pausado. El resultado `armed` significa preparado/posicionado, no que una reproducción posterior haya sido medida y comprobada acústicamente.
- Las pruebas específicas de sincronía son unitarias o de integración de software con `MockAudioContext`, parámetros de análisis fijados en datos de prueba y/o fórmulas puras. No son capturas de salida acústica.
- Hay un generador/lector de WAV y pruebas del analizador con audio sintético; no encontré una pareja de pistas reales conocida, ni un comparador de fase de dos salidas, grabador o reporte de error acústico reproducible.

**Dictamen de preparación:** listo para diseñar una sesión manual exploratoria con dos archivos reales y confirmar downbeats para BAR SYNC; **no listo para una validación acústica objetiva y reproducible** de SYNC/ALIGN/BAR SYNC tal como está automatizada la evidencia actual. Hace falta definir el protocolo y registrar mediciones externas o añadir instrumentación de captura/comparación antes de emitir un veredicto acústico.

## 2. Estado verificado de los controles

| Control | Estado observado en código | Qué se puede afirmar | Estado acústico |
|---|---|---|---|
| SYNC | **Confirmado:** `DJStore.syncDeck()` elige master/slave, calcula `masterBaseBpm * masterPlaybackRate / slaveBaseBpm`, valida rango ±8% y llama `audioEngine.setDeckPlaybackRate()`. | Ajusta tempo nominal del esclavo y mantiene roles asimétricos. No alinea su posición temporal. | **Pendiente de validación.** La igualdad de tempo no es alineación de fase. |
| ALIGN | **Confirmado:** `DJStore.alignPhase()` exige ambos decks reproduciéndose, BPM y `firstBeatTime`; `calculatePhaseAlignmentPlan()` proyecta retículas y selecciona pulsos futuros; `applyDeckSlew()` automatiza velocidad. | Intenta corregir la llegada estimada de beats proyectados, dentro de cotas matemáticas. No usa downbeat confirmado para identificar tiempo 1. | **Pendiente de validación.** La planificación/completado lógico no comprueba el onset real en la salida. |
| BAR SYNC | **Confirmado:** `DJStore.prepareBarSync()` requiere master en reproducción, slave detenido/pausado y confirmación manual válida/hash coincidente en ambas pistas. Calcula y hace seek en el slave. | Prepara la fase del compás en una instantánea; no inicia reproducción. El estado `armed` no equivale a sincronía audible después de PLAY. | **Pendiente de validación.** No hay medición de la coincidencia de downbeats tras el arranque manual. |

## 3. Archivos y funciones relevantes

- [`src/store/useDJStore.ts`](src/store/useDJStore.ts): coordinación de estado/transporte.
  - `analyzeTrack()` delega en `analysisSyncManager`.
  - `loadTrackToDeck()` recupera blob/análisis/downbeat persistidos, decodifica con `audioEngine` y carga el buffer.
  - `setPitchDeck()` actualiza velocidad de transporte; `pitchBend()` aplica desviación momentánea.
  - `syncDeck()` implementa SYNC de tempo nominal.
  - `alignPhase()` obtiene `getDeckCurrentTime()` para ambos decks, planea y aplica micro-slew al esclavo.
  - `prepareBarSync()` calcula la posición objetivo y ejecuta `seekDeck()`; `confirmDownbeat()`/`clearDownbeat()` administran confirmaciones manuales.
  - El bucle de actualización consulta la posición de `audioEngine` y copia `currentTime` al store.
- [`src/audio/AudioEngineService.ts`](src/audio/AudioEngineService.ts): motor Web Audio real.
  - `playDeck()` crea un `AudioBufferSourceNode`, fija `playbackRate` y arranca con un offset de buffer.
  - `getDeckCurrentTime()` calcula la posición de buffer desde tiempo del `AudioContext`, offset y tasa efectiva.
  - `setDeckPlaybackRate()` y `applyDeckSlew()` escriben automatizaciones en `AudioParam`; `seekDeck()` cambia el offset de transporte.
  - También crea un `AnalyserNode` para RMS/medidor de volumen. En lo inspeccionado no extrae de él onsets por deck ni fase/beat para comparar decks.
- [`src/audio/analysis/audioAnalyzer.ts`](src/audio/analysis/audioAnalyzer.ts): orquesta análisis PCM, BPM, primer transitorio, tonalidad, energía y picos visuales.
- [`src/audio/analysis/bpmDetector.ts`](src/audio/analysis/bpmDetector.ts): `detectBpm()` estima tempo por novedad/autocorrelación; `detectFirstBeatTime()` devuelve el primer transitorio percusivo significativo detectado en los primeros 12 s.
- [`src/audio/analysis/beatgrid.ts`](src/audio/analysis/beatgrid.ts): `computeProvisionalBeatgrid()` proyecta beats cada `60 / bpm`; marca `isProvisional: true`, `isMusicallyVerified: false`. `getBeatPhase()` calcula fase matemática contra esa proyección.
- [`src/audio/analysis/phaseAlignment.ts`](src/audio/analysis/phaseAlignment.ts): `calculatePhaseAlignmentPlan()` estima beats futuros y desplazamiento requerido para el micro-slew; `integrateSlewTrajectory()`/`evaluateSlewRateAt()` modelan la rampa.
- [`src/audio/analysis/barSync.ts`](src/audio/analysis/barSync.ts): `calculateBarSyncPlan()` calcula fase de compás y destino a partir de downbeat, BPM efectivo y métrica confirmada. Es una función pura, no maneja audio.
- [`src/utils/downbeat.ts`](src/utils/downbeat.ts) y `src/types/track.ts`: separan sugerencia tentativa de confirmación manual ligada a `contentHash`.
- [`src/components/dj/Deck.tsx`](src/components/dj/Deck.tsx): presenta acciones/estado y el editor de downbeat. El badge de ALIGN etiqueta la naturaleza provisional de la retícula; BAR SYNC distingue `armed`, `already_aligned` y `completed`.

## 4. BPM, beatgrid, primer beat y fase

- **BPM — confirmado:** el analizador calcula BPM desde PCM (`detectBpm`). `TrackAnalysis` también permite almacenar BPM como dato, y la UI/store consume el valor persistido en la pista. En pruebas aparecen BPM asignados directamente en objetos (`createAnalyzedTrack()` en `TempoSyncAndMasterSlave.test.ts` y `MicroSlewPhaseAlignmentIntegration.test.ts`), por lo que esos casos no validan detección.
- **Confianza/ambigüedad — confirmado:** `audioAnalyzer.ts` conserva `bpmConfidence`/`isAmbiguous`; ALIGN exige confianza suficiente (retícula suitable: confianza ≥0.5 y no ambigua). SYNC de tempo no exige confianza mínima ni ausencia de ambigüedad: requiere un BPM válido.
- **Primer beat — confirmado:** `detectFirstBeatTime()` busca el primer pico ODF sobre umbral en la intro. El comentario del detector dice que no fuerza compás ni downbeat. No es una estimación del tiempo 1.
- **Beatgrid — confirmado:** es proyección uniforme desde `firstBeatTime` y BPM; no hay corrección beat a beat, detección de tempo variable ni validación musical del compás en esa retícula. Su contrato explícito es provisional/no verificado.
- **Fase rítmica para ALIGN — confirmado:** relativa a cada retícula de primer transitorio. El algoritmo compara tiempos de beats proyectados de master/slave, sujetos a margen de planificación, tolerancia y compatibilidad de tempo efectivo. Esto no es evidencia de que los ataques acústicos estén donde predice la retícula.
- **Downbeat/compás para BAR SYNC — confirmado:** no se infiere automáticamente como verdad. `createSuggestedDownbeat()` guarda sugerencias no vinculantes; `createManualDownbeatConfirmation()` registra posición/métrica y hash con procedencia `manual`. El editor permite elegir sugerido, capturar posición del cabezal, seleccionar métrica y confirmar explícitamente.
- **Valores manuales/simulados — confirmado:** las pruebas de store introducen BPM, confianza, `firstBeatTime`, posición de downbeat, beats por compás y hashes sintéticos directamente. Eso verifica contratos y cálculos, no que un análisis real recupere esos valores.

## 5. Pruebas existentes y alcance real

No se ejecutaron pruebas en esta auditoría. Clasificación basada en inspección del código de pruebas:

| Grupo | Archivos inspeccionados | Qué demuestra | Qué no demuestra |
|---|---|---|---|
| Matemática de ALIGN | `tests/PhaseAlignmentMath.test.ts` | Signos, selección de pulsos, márgenes, límites e integral de slew sobre valores de entrada determinados. | Que el BPM/primer beat sean correctos o que el sonido se alinee. Unit tests puros. |
| Integración ALIGN/motor/store | `tests/MicroSlewPhaseAlignmentIntegration.test.ts` | Estado, automatización y ciclo de vida con `MockAudioContext` y `MockAudioParam`. El mock permite inspeccionar eventos programados. | Audio renderizado/acústico o fase medida. Integración simulada. |
| SYNC/master-slave | `tests/TempoSyncAndMasterSlave.test.ts`, además de `tests/PitchBendAndFirstBeatIntegration.test.ts` | Roles, rango de pitch, cálculo de tempo y algunas condiciones del primer beat usando transporte/mocks. En `TempoSyncAndMasterSlave.test.ts` los BPM se asignan a mano y la fuente de archivo se sintetiza como bytes dummy. | Detección objetiva de tempo/fase o dos decks audibles. Integración simulada. |
| BAR SYNC puro | `tests/BarSyncPureCalculation.test.ts` | Fórmulas de fase de compás, hash/confirmación, métrica, posición y rechazos con inputs construidos explícitamente. | Exactitud de anclas contra audio real o salida acústica. Unit tests puros. |
| BAR SYNC store/UI | `tests/BarSyncStoreIntegration.test.ts`, `tests/BarSyncUIIntegration.test.ts` | Aplicación de seek, estados, roles, cancelación, etiquetas y reglas de UI/Store bajo dobles Web Audio. | Coincidencia de downbeats al reproducir dos pistas reales. Integración de software. |
| Modelo/editor downbeat | `tests/BarSyncDataModelAndPersistence.test.ts`, `tests/DownbeatManualEditor.test.ts` | Separación sugerido/confirmado, procedencia manual, hash, persistencia y controles del editor. | Veracidad humana/acústica de la posición seleccionada. Unit/UI con mocks. |
| Análisis PCM con WAV | `tests/audioAnalysis.test.ts`, `tests/fixtures/wavHelper.ts` | Genera WAV temporales sintéticos (pulsos y tonos con BPM/clave conocidos) y comprueba análisis estimado. Es prueba del analizador sobre PCM; no sincroniza decks. | Pistas comerciales/reales ni validación de SYNC/ALIGN/BAR SYNC. Los nombres `reference_*.wav` describen fixtures sintéticos creados en `before()`, no archivos versionados de referencia. |
| Transporte | `tests/AudioEngineService.test.ts`, `tests/DJStoreIntegration.test.ts`, `tests/FunctionalRegressionFull.test.ts` y relacionadas | Acciones, offsets, playbackRate, CUE/seek y estados en mocks. | Tiempos reales de salida entre dos fuentes de audio. |

No se identificó suite de hardware/navegador que compare muestras renderizadas de dos decks ni una aserción acústica reproducible. El script de `package.json` ejecuta Node tests, lo cual es consistente con la presencia de mocks, no con reproducción real.

## 6. Capacidades disponibles para pruebas acústicas

- **Confirmado:** el producto acepta/importa archivos locales, almacena blobs y puede decodificarlos en el motor (`loadTrackToDeck()`). La UI deja reproducir ambas pistas, ajustar pitch, disparar SYNC/ALIGN y editar/confirmar downbeats.
- **Confirmado:** los valores de transporte consultables son `getDeckCurrentTime()` y `getDeckPlaybackRate()`. El motor mide RMS del master para el medidor; eso no identifica beats ni estima diferencia de fase.
- **Confirmado:** existen utilidades de lectura/escritura WAV para fixtures; `audioAnalysis.test.ts` produce archivos sintéticos durante la prueba. En disco, `rg --files tests/fixtures` solo encontró `wavHelper.ts` (sin WAV persistidos).
- **No encontrado en rutas inspeccionadas:** cargador de un par de pistas de referencia con metadatos esperados, grabador de la salida mezclada, captura loopback, detección de onsets durante reproducción, correlación cruzada de los decks, cálculo de error de fase posterior a SYNC/ALIGN, o exportación de reporte de sesión.
- **Riesgo potencial:** `currentTime` del deck y el `AudioContext.currentTime` participan de distintas magnitudes/roles. ALIGN planifica en tiempo de buffer y convierte el margen usando tasa; para verificar su ejecución real debe medirse el sonido de salida y el retardo de render, no inferirse solo de los estados visuales.
- **Riesgo potencial:** `setDeck()` y el loop de UI publican una instantánea periódica de `currentTime`; su resolución visual/latencia no acredita simultaneidad acústica. La comparación debe usar timestamps PCM comunes o una captura estéreo, con latencia documentada.

## 7. Bloqueadores técnicos confirmados

1. **No existe criterio de aceptación acústico instrumentado.** Los estados `completed`/`armed` derivan del callback/resultado lógico del algoritmo y no de observar transitorios de salida.
2. **SYNC solo iguala el tempo calculado.** `syncDeck()` no modifica la posición del esclavo ni compara sus beats actuales; por sí mismo no puede resolver el desfase inicial.
3. **ALIGN usa anchors no verificados.** `firstBeatTime` es el primer transitorio significativo y la retícula resultante se declara provisional, de modo que puede no representar pulsos regulares o downbeats de música real.
4. **BAR SYNC depende de confirmación humana.** El dato queda atado al archivo y la métrica se explicita, pero la corrección/precisión de la marca depende del operador y no tiene verificación acústica posterior.
5. **No hay fixture de pareja real ni capturador/comparador.** Las fixtures actuales de análisis son audio sintético y no prueban rutas de transporte de dos pistas reales.
6. **Pruebas de transporte sustituyen Web Audio.** Sirven para verificar programación e invariantes de software; no validan compatibilidad de navegador/dispositivo, salida renderizada, latencia ni percepción.

## 8. Información pendiente de verificación

- Comportamiento en navegador objetivo y dispositivo de audio real, incluyendo frecuencia de muestreo, latencia de salida y posible jitter.
- Precisión de BPM y `firstBeatTime` con los dos archivos finales elegidos, incluidas intros, silencios, swing, tempo variable y beats débiles.
- Precisión de downbeat introducido por operador y persistencia/recuperación con hashes de esos archivos concretos.
- Fase acústica y deriva a lo largo del tiempo después de SYNC y ALIGN, y downbeat real después de BAR SYNC + PLAY manual.
- Cualquier modificación local preexistente no reflejada por Git (estado informado limpio en esta inspección); no se inspeccionaron datos externos del usuario ni audio no versionado.

## 9. Procedimiento propuesto para pruebas reproducibles con dos pistas reales

1. **Elegir y documentar los archivos exactos.** Guardar identificación, versión, duración, frecuencia/formato, SHA-256, BPM/downbeat/métrica de referencia y procedencia de la anotación. Elegir dos pistas estables de tempo y con ataques discernibles; anotar tolerancias y posibles silencios/intro.
2. **Obtener referencia independiente.** Determinar BPM, tiempos de beat y downbeats de cada archivo mediante edición/anotación de alta resolución o una herramienta independiente; no tomar la salida del sistema bajo prueba como verdad de referencia.
3. **Reproducir en condiciones fijas.** Usar el navegador/dispositivo objetivo, una sola frecuencia de salida, ganancia sin clipping y ambos decks encaminados a una captura estéreo común. Registrar versión de aplicación, navegador, hardware, configuración y latencia. Hacer varias repeticiones por control y sentido de master/slave.
4. **SYNC aislado.** Empezar desde dos posiciones intencionalmente desfasadas; activar SYNC y registrar ambos BPM efectivos y diferencia temporal entre onsets a varios puntos de la reproducción. Informar por separado error inicial y deriva (ms/compás/minuto). No contar BPM igual como éxito de fase.
5. **ALIGN aislado y combinado.** Con velocidades efectivas previamente igualadas, registrar fase antes, accionar ALIGN y medir onsets en la captura después del slew y en varios compases posteriores. Comparar contra las referencias independientes; informar error residual, deriva, falsos triggers y artefactos audibles.
6. **BAR SYNC.** Confirmar manualmente hash, downbeat y métrica de ambos archivos; ejecutar con master en play y slave pausado/detenido. Registrar seek objetivo/estado; luego iniciar el slave manualmente y medir el error entre downbeats reales en la captura común. Repetir con posiciones iniciales distintas.
7. **Reporte.** Conservar archivos fuente/fixture de medición, anotaciones, captura sin procesar, parámetros, repeticiones, errores en milisegundos y limitaciones. Definir un umbral de aceptación antes de observar resultados. Separar estado de UI, posición informada por software y coincidencia acústica.

## 10. Recomendación del siguiente paso

Antes de cambiar algoritmos, acordar dos pistas reales con referencias verificables y un criterio cuantitativo de error/deriva, y definir cómo se capturará una salida común de los decks en el navegador/dispositivo objetivo. Luego ejecutar una ronda manual documentada que distinga SYNC (tempo), ALIGN (beats estimados) y BAR SYNC (downbeat tras PLAY). Si se requiere automatización reproducible en CI, el siguiente trabajo técnico sería preparar un mecanismo de render/captura PCM de dos fuentes y un comparador de onsets/fase; no se implementó como parte de esta auditoría.

**Clasificación general:** afirmaciones de implementación anteriores = **confirmadas por inspección de código**; riesgos descritos = **riesgos potenciales a medir**; resultados con audio real = **pendientes de validación**.
