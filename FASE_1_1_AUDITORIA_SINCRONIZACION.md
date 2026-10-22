# SYSTEM DJ — Auditoría acústica y funcional de sincronización (Fase 1.1)

**Fecha:** 2026-10-22  
**Alcance inicial:** auditoría de SYNC, ALIGN, BAR SYNC, BPM, beatgrid, first beat/downbeat, pitch y transporte. El estado descrito antes del seguimiento de implementación es la línea base auditada el 2026-10-22.

## Resumen

- SYNC implementa una igualación nominal directa de BPM mediante `playbackRate`, con límite estricto de ±8% y asignación asimétrica Master/Slave. No cambia la posición de reproducción: no alinea beats ni compases por sí solo.
- El motor no distingue de forma fiable una coincidencia de BPM de una hipótesis de medio tiempo o doble tiempo. El detector genera `alternateBpm`, pero la ruta de análisis no lo conserva en `TrackAnalysis` y SYNC no examina ni `isAmbiguous` ni candidatos alternativos. La prueba actual de 140/70 solo verifica el rechazo del ratio directo 2:1 fuera del rango de pitch.
- ALIGN calcula y ejecuta un perfil temporal de micro-slew sobre un beatgrid periódico provisional. La precisión integral se verifica matemáticamente; la fase musical real y la calidad acústica no quedan demostradas por estos datos.
- BAR SYNC calcula una posición estática de fase de compás usando downbeats y métrica confirmados manualmente, vinculados al hash del audio. No inicia reproducción ni promete sincronía audible.
- Pausar o detener el Master deja activa la relación SYNC y el Slave sigue reproduciendo. Descargarlo cancela la relación y conserva al otro deck reproduciendo con su pitch actual.
- SYNC con ambos decks detenidos funciona si ambos tienen pista y BPM válidos. El deck opuesto al botón pulsado se escoge como Master.

## Material de referencia

No se encontraron en los archivos del repositorio ni en los nombres de archivos de su historial Git:

- `plan_de_implementaci_n_hacia_el_mvp_100.md`
- `condiciones_adicionales_fase_4.md`
- una auditoría previa de Fase 23

El único Markdown de la raíz es `README.md`. Por ello, esta auditoría contrasta el comportamiento actual con los requisitos explícitos del encargo y los contratos que documentan el propio código y las pruebas. No fue posible contrastar criterios de aceptación que estuvieran únicamente en los documentos ausentes.

## Estado Git

- Rama: `refactor/ui`.
- `git status --short`: sin cambios pendientes antes de esta auditoría.
- `git diff --stat`: vacío.
- Este reporte es el único archivo nuevo de la tarea; no se alteró código existente.

## Implementación verificada

### SYNC de tempo

En `src/store/useDJStore.ts`, `syncDeck()` elige el Master según el estado de reproducción: si solo uno está reproduciéndose, ese queda como Master; si ambos están detenidos, pausados o ambos reproduciéndose, el opuesto al deck pulsado es el Master (líneas 1410–1437). Requiere BPM positivo en ambos decks y calcula `requiredRate = masterBaseBpm * master.playbackRate / slaveBaseBpm`. Rechaza un resultado fuera de `[0.92, 1.08]`, aplica el rate y publica los roles como una sola relación asimétrica (líneas 1450–1533).

Garantías comprobables en código:

- no aplica automáticamente un ratio 2:1 o 1:2;
- no cambia el BPM analizado original ni hace seek;
- no recorta silenciosamente un pitch fuera de ±8%;
- el Pitch Bend momentáneo del Master no entra en el BPM nominal de SYNC;
- cambios de pitch del Master actualizan el pitch del Slave mientras exista relación SYNC.

Límite central: el algoritmo compara solamente los números BPM que recibió. No prueba que ambos números representen la misma subdivisión musical. El detector calcula candidatos armónicos y `alternateBpm` (`src/audio/analysis/bpmDetector.ts`, aproximadamente líneas 288–332), pero `TrackAnalysis` no dispone de `alternateBpm` (`src/types/track.ts`) y `audioAnalyzer` guarda BPM/confianza/ambigüedad sin guardar esos candidatos (`src/audio/analysis/audioAnalyzer.ts`, líneas 97–133). Además, `syncDeck()` no consulta la confianza o ambigüedad.

**Reproducción de la limitación a nivel de código:** si un análisis equivocado guarda 140 BPM para una pista cuyo pulso musical era 70 BPM, y el otro deck también presenta 140 BPM, SYNC calcula rate 1.0 y activa los roles. No hay entrada disponible en SYNC para inferir que uno de esos 140 era alias de 70. Esto demuestra una falta de discriminación en el contrato de datos y la lógica, no un resultado acústico medido.

La prueba `TempoSyncAndMasterSlave.test.ts` 3.5 (`analysis.bpm` 140 contra 70) solo muestra que el ratio directo 2.0 se rechaza por superar 1.08. No verifica señales de audio, alternates, hipótesis ambiguas ni un alias ya guardado como BPM principal. Por tanto, no sustenta la garantía general de “distingue tempo real de medio/doble tempo”.

### Beatgrid, BPM y first beat

`detectBpm()` usa una curva de novedad y autocorrelación; puntúa picos con apoyo armónico y devuelve candidatos alternativos. `isAmbiguous` se determina por el valor y prominencia del pico principal, no por una resolución explícita de qué nivel métrico es el beat (`bpmDetector.ts`, líneas 255–363). El análisis asigna `firstBeatTime` a partir del primer transitorio rítmico detectable (`audioAnalyzer.ts`, línea 97), no de un downbeat musical confirmado.

`computeProvisionalBeatgrid()` proyecta `firstBeatTime + k * 60/BPM`. Expresamente tipa la retícula como provisional y no musicalmente verificada (`src/audio/analysis/beatgrid.ts`, líneas 1–23); solo marca elegibilidad técnica si BPM confidence es al menos 0.5, no es ambiguo y hay al menos dos pulsos (líneas 105–126). Esto es una extrapolación periódica, no una detección de beats compás a compás.

### ALIGN / fase

`alignPhase()` exige ambos decks reproduciéndose, beats base válidos, `firstBeatTime`, ausencia de bandera ambigua y compatibilidad de tempo efectivo ≤0.20 BPM (`useDJStore.ts`, líneas 1558–1668). `calculatePhaseAlignmentPlan()` selecciona eventos futuros de retículas periódicas, calcula el error de llegada y diseña un micro-slew limitado (`src/audio/analysis/phaseAlignment.ts`, líneas 199–255 en validación; 257 en adelante en selección de pulsos). `AudioEngineService.applyDeckSlew()` programa rampas en `AudioParam` y un timer de cierre (`src/audio/AudioEngineService.ts`, líneas 713–813).

Con los datos existentes se puede demostrar matemáticamente que dos **pulsos proyectados** se planificaron con cierta diferencia y que el área del perfil ideal equivale al desplazamiento calculado. No se puede demostrar que los eventos proyectados correspondan a beats musicales reales, que el compás o downbeat coincidan, ni que la mezcla suene alineada. El estado `completed` proviene del ciclo programado/timer y no de una medición de audio de la llegada. La documentación del propio módulo advierte que la igualdad matemática no garantiza transparencia acústica (`phaseAlignment.ts`, líneas iniciales).

ALIGN tampoco requiere que SYNC esté activo; permite su ejecución si las velocidades efectivas ya coinciden dentro de tolerancia. Sí impide que el deck marcado como Master actúe como esclavo.

### BAR SYNC / downbeat

`src/utils/downbeat.ts` separa sugerencia de confirmación manual y valida una huella SHA-256. `calculateBarSyncPlan()` exige Master reproduciéndose, Slave detenido o pausado, downbeat manual ligado al hash y misma cantidad confirmada de beats por compás (`src/audio/analysis/barSync.ts`). Calcula fase de compás y posición objetivo; `DJStore` aplica preparación al Slave sin arrancarlo. El contrato deja claro que esto prepara equivalencia matemática de fase y no garantiza alineación audible posterior. Es una garantía más explícita y protegida que la retícula provisional de ALIGN, aunque sigue dependiendo de que la confirmación manual sea correcta.

### Transporte, pausa, descarga y pitch

`pauseDeck()` y `stopDeck()` cancelan micro-slew y cambian el transporte, pero no eliminan `syncMasterDeck` ni limpian los roles SYNC (`useDJStore.ts`, líneas 842–923). La suite confirma que pausar o detener el Master no detiene al Slave ni modifica su velocidad; la relación permanece activa (`TempoSyncAndMasterSlave.test.ts`, prueba 7.3). Esto permite que el Slave continúe sin un Master audible/avanzando. Las variaciones de pitch del Master siguen pudiendo propagarse a su Slave mientras los roles estén activos.

Al descargar un deck, `unloadDeck()` cancela slews de ambos decks, vacía el buffer y pone `syncMasterDeck` en `null`, limpiando `isMaster`/`isSyncActive` en ambos. No detiene el otro deck ni modifica su rate guardado (`useDJStore.ts`, líneas 2330–2365; prueba 7.1).

Al activar SYNC con ambos decks detenidos, el código sí calcula/aplica rate y declara roles sin iniciar reproducción ni reposicionar (`syncDeck()`; prueba 1.3). Esto confirma el comportamiento funcional de activación; no es validación acústica.

## Pruebas ejecutadas y resultados

Se ejecutaron ocho suites existentes con `node --test --experimental-strip-types`:

| Suite | Cobertura relevante |
|---|---|
| `tests/TempoSyncAndMasterSlave.test.ts` | Selección de Master/Slave, rate, medio/doble tempo, pitch, pausa, stop, descarga |
| `tests/PhaseAlignmentMath.test.ts` | Selección de pulsos proyectados, confianza, tolerancias, límites e integral del perfil |
| `tests/MicroSlewPhaseAlignmentIntegration.test.ts` | Automatización simulada, cancelación, continuidad matemática y store/engine |
| `tests/BeatgridProvisional.test.ts` | Proyección provisional, offsets y cálculo de fase |
| `tests/PitchBendAndFirstBeatIntegration.test.ts` | Pitch bend, first beat sintético y análisis PCM sintético |
| `tests/BarSyncPureCalculation.test.ts` | Downbeat, métrica y cálculo puro de fase de compás |
| `tests/BarSyncStoreIntegration.test.ts` | Integración de BAR SYNC con store y transporte |
| `tests/DownbeatManualEditor.test.ts` | Flujo/UI de confirmación manual y persistencia simulada |

**Resultado:** 177 tests, 43 suites, 177 pasaron, 0 fallaron, 0 omitidos (4.28 s). Una prueba de ruta de error de decodificación imprimió un error esperado en consola y pasó.

Los tests usan objetos, relojes y Web Audio mocks, matemáticas puras o PCM sintético. Verifican contratos funcionales y resultados del modelo simulado. No miden la salida acústica real de un navegador, una interfaz de audio, dos pistas reales o la percepción del oyente.

## Diferencias, defectos reproducibles y riesgos

| Tema | Comportamiento esperado que puede inferirse del encargo | Estado comprobado | Riesgo / diferencia |
|---|---|---|---|
| SYNC vs half/double-time | Evitar declarar una coincidencia real solo por comparar BPM | SYNC acepta el rate directo dentro de ±8%; no recibe candidatos alternativos ni valida ambigüedad | Un alias armónico ya elegido como `analysis.bpm` puede aceptarse como coincidencia. La prueba 140/70 no cubre esto. |
| ALIGN phase | Alinear beats de audio de forma demostrable | Alinea tiempos de una retícula periódica provisional, derivados de BPM y primer transitorio | No hay detección de beat en vivo ni medida posterior de fase en muestras de audio; “completed” no acredita beat audible. |
| Pausar/detener Master | Comportamiento explícito ante pérdida de referencia | Master queda pausado/detenido, Slave continúa y roles SYNC quedan activos | No es un fallo de ejecución frente a la prueba existente; es una política que debe decidirse. El control de pitch del Master aún puede afectar al Slave. |
| Descargar Master | Sin estado SYNC huérfano ni corte inesperado del otro deck | La relación se limpia; el deck restante continúa al rate actual | Verificado en prueba simulada. No se midió salida física. |
| SYNC detenido | Permitir preparar velocidad antes de Play | Activa roles/rate sin iniciar ni reposicionar transporte | Verificado funcionalmente; asignación de Master depende del deck pulsado, no de una fuente en reproducción. |
| BAR SYNC | Alinear una fase de compás con downbeat/métrica conocidos | Requiere confirmación manual, hash y métrica iguales; reposiciona estáticamente | El cálculo no valida si la confirmación manual fue escuchada correctamente ni la salida acústica tras lanzar. |

No se encontró una prueba que compare fase de salida real entre dos señales musicales. No se reporta ningún hallazgo de “mix acústicamente validado”.

## Propuesta mínima para implementar únicamente Fase 1.1

1. **Cerrar el contrato de tempo ambiguo antes de sincronizar.** Mantener los candidatos armónicos del detector junto al análisis persistido y hacer que SYNC rechace el análisis ambiguo o solicite elección explícita del usuario cuando haya hipótesis de medio/doble tiempo plausibles. No inferir automáticamente un multiplicador 2:1.
2. **Mantener separado el estado de garantía.** Etiquetar ALIGN como alineación de fase de beatgrid estimado; reservar afirmaciones de fase confirmada para medidas de señal o confirmación manual. No derivar “alineado acústicamente” del timer o de la integral de micro-slew.
3. **Definir la política de pérdida de Master.** Acordar si pause/stop conserva la relación solo como enlace de pitch nominal o si la desacopla; agregar cobertura explícita de ambos estados y del efecto de cambiar el pitch del Master pausado. La descarga ya desacopla correctamente.
4. **Añadir casos de regresión enfocados antes de cambiar el algoritmo:** BPM alias con análisis no ambiguo, candidatos alternativos presentes, confianza baja/ambigüedad en SYNC, pausa/stop del Master seguido de pitch change, y ALIGN con dos retículas matemáticamente válidas pero firstBeat que no corresponde al beat real.
5. **Validación auditiva manual en material de prueba etiquetado:** pares de tempos cercanos; pares reales 2:1 y 1:2; patrones con kick ausente/sincopado, pickup o silencio inicial; y comparación antes/después de ALIGN y BAR SYNC. Registrar los puntos de downbeat/beat esperados, configuración de pitch, posiciones iniciales y juicio de escucha. Hasta hacer estas pruebas no afirmar calidad acústica o inaudibilidad del micro-slew.

La propuesta se limita a cerrar criterios de aceptación, trazabilidad de ambigüedad y pruebas de sincronización de esta fase. No incluye trabajo de Fases 2–4 ni refactor general.

## Validación acústica manual pendiente

- Confirmar con escucha y/o capturas de forma de onda el beat real de los segmentos usados, incluidos inicio con pickup, kick sincopado, doble golpe y silencios.
- Escuchar ALIGN en auriculares/monitores con beatgrid correcto y con offsets conocidos; evaluar si la corrección realmente aproxima transitorios y si el micro-slew introduce cambio perceptible de tono o artefactos.
- Probar candidatos BPM en ratios 2:1 y 1:2 con selección explícita de nivel métrico; confirmar que el sistema no anuncia una coincidencia que suena a medio/doble tiempo.
- Probar BAR SYNC con downbeats confirmados independientemente en dos pistas, realizar el lanzamiento manual del Slave y escuchar la fase de compás; anotar que diferentes frases o síncopas pueden seguir sin coincidir.
- Repetir pausa/stop/descarga del Master durante reproducción real del Slave y verificar la continuidad audible, el pitch y el comportamiento que finalmente se defina para el enlace SYNC.

## Archivos principales revisados

- `src/store/useDJStore.ts`: `syncDeck`, `alignPhase`, `pauseDeck`, `stopDeck`, `unloadDeck`, `setSyncRoles`, cambio de pitch.
- `src/audio/AudioEngineService.ts`: reproducción, pausa, stop, rate, tiempo de transporte, programación/cancelación de micro-slew.
- `src/audio/analysis/bpmDetector.ts`, `audioAnalyzer.ts`: BPM, candidatos armónicos, confianza/ambigüedad, first beat.
- `src/audio/analysis/beatgrid.ts`, `phaseAlignment.ts`: retícula provisional, cálculo de fase y perfil de corrección.
- `src/audio/analysis/barSync.ts`, `src/utils/downbeat.ts`: downbeat, métrica y preparación BAR SYNC.
- `src/types/track.ts`, `src/types/deck.ts`: datos y estados disponibles.
- Suites enumeradas en “Pruebas ejecutadas y resultados”.

## Seguimiento de implementación — Corrección de hipótesis de tempo (Fase 1.1)

### Causa raíz confirmada

El detector ya calculaba `alternateBpm`, pero `audioAnalyzer` descartaba el campo al formar `TrackAnalysis`. La estructura persistida de la pista tampoco tenía el campo, y `syncDeck()` usaba solo el BPM principal para calcular el pitch. Por eso una relación armónica entre candidatos no podía influir en SYNC. Además, los BPM, confidence e `isAmbiguous` por sí solos no prueban la fase o el nivel métrico real del beat.

### Archivos y funciones modificados

- `src/audio/analysis/tempoCompatibility.ts` (nuevo): `assessTempoCompatibility()` comprueba que ambos análisis tengan status `analyzed`, BPM positivo, confidence ≥0.5, `isAmbiguous === false` y candidatos alternativos válidos. Si el BPM principal de un deck coincide con un candidato alternativo del otro y la relación base está cerca de 2:1, retorna `half_time_hypothesis` o `double_time_hypothesis`. Si falta evidencia, retorna `insufficient_data`. La ausencia de conflicto devuelve `no_harmonic_conflict`; deliberadamente no se llama `rhythmically_aligned` ni equivalente.
- `src/audio/analysis/audioAnalyzer.ts`: conserva `bpmResult.alternateBpm` en análisis `analyzed`.
- `src/types/track.ts`: agrega `TrackAnalysis.alternateBpm` para transportar y persistir candidatos con el registro existente.
- `src/store/useDJStore.ts`, `syncDeck()`: consulta el control de hipótesis antes del cálculo de `requiredRate`. Solo después aplica el límite existente de pitch `[0.92, 1.08]`; no hay ajuste automático de medio/doble tempo.
- `tests/TempoSyncAndMasterSlave.test.ts`: casos de BPM cercano normal, hipótesis half-time, hipótesis double-time, confidence/candidatos insuficientes y bloqueo de SYNC antes del error de pitch.
- `tests/audioAnalysis.test.ts`: verifica que el resultado de `analyzeAudioPcm()` expone los candidatos.
- `tests/DJStoreIntegration.test.ts`, `tests/MicroSlewPhaseAlignmentIntegration.test.ts`, `tests/PitchBendAndFirstBeatIntegration.test.ts`: completan fixtures existentes con los metadatos de análisis que ahora requiere SYNC.

No se cambió el cálculo detector de BPM, la selección/recomendación de pistas, el pitch máximo, ALIGN, BAR SYNC ni el transporte.

### Comportamiento antes y después

**Antes:** una coincidencia del BPM principal bastaba para seguir a cálculo de rate. La alternativa medio/doble solo provocaba rechazo indirecto si el rate caía fuera del rango ±8%; un caso de candidatos armónicos no podía producir un rechazo específico.

**Ahora:** análisis incompleto, ambiguo o de confianza menor a 0.5 se rechaza como insuficiente. Un candidato alternativo que corrobora relación 2:1 produce rechazo explícito de hipótesis antes de revisar el pitch. Los casos no conflictivos siguen pasando al cálculo de rate actual y preservan el límite ±8%.

`no_harmonic_conflict` solo significa que el análisis disponible no disparó esta regla. No demuestra que el BPM principal sea correcto, que dos beats coincidan en fase, ni que la mezcla suene alineada. En particular, si ambas pistas guardaron el mismo BPM incorrecto como candidato principal, los datos actuales no bastan para descubrirlo; se necesitaría confirmar explícitamente el nivel BPM de cada pista o añadir evidencia por candidato con revisión/validación independiente.

Las pistas históricas sin `alternateBpm` ahora fallan de forma segura en SYNC hasta ser reanalizadas. Los candidatos alternativos actuales no guardan puntaje individual: son hipótesis, no una decisión métrica automática.

### Pruebas y verificaciones de implementación

- Pruebas añadidas de Fase 1.1: incluidas en `tests/TempoSyncAndMasterSlave.test.ts` y `tests/audioAnalysis.test.ts`.
- Suites dirigidas de tempo, ALIGN/micro-slew, first beat, audio analysis, persistencia de análisis, integración del store y regresión funcional: **160 pasaron, 0 fallaron** en la última ejecución dirigida.
- `npm test`: **608 pasaron, 0 fallaron** (106 suites).
- `npm run build`: pasó (`tsc -b` y Vite). Vite mostró una advertencia de que el bundle principal supera 500 kB minificado.
- `npm run lint`: pasó.
- `git diff --check`: pasó sin errores.
- No quedó ninguna verificación solicitada sin ejecutar.

Estas pruebas son deterministas y automatizadas. Aunque algunas analizan PCM sintético o WAVs incluidos como fixtures, no prueban SYNC escuchando dos tracks en una salida de audio real. No se declara validación acústica.

### Validación acústica pendiente

Con tracks reales etiquetados, escuchar pares de BPM cercanos y pares con relaciones 2:1/1:2 en ambos órdenes; marcar independientemente el beat esperado; comparar el BPM principal y sus candidatos con el nivel de beat percibido; verificar que SYNC rechaza candidatos armónicos antes de modificar pitch; confirmar que relaciones no armónicas dentro de ±8% aún igualan tempo nominal; y registrar salidas/posiciones y audiciones. Repetir con kick sincopado, pickups y silencios iniciales. También probar una pareja donde ambas pistas tienen el mismo BPM principal equivocado para confirmar el límite conocido del algoritmo. Hasta entonces no afirmar alineación de beat o compás, ni calidad/inocuidad acústica.

## Seguimiento — Auditoría de casos límite del transporte (Fase 1.3)

### Escenarios y estado verificado

Se revisaron `DJStore.pauseDeck()`, `stopDeck()`, `unloadDeck()`, `syncDeck()` y `setSyncRoles()` en `src/store/useDJStore.ts`; las operaciones de transporte y pitch bend en `src/audio/AudioEngineService.ts`; los estados de deck en `src/types/deck.ts`; y los casos 1.3, 7.1 y 7.3 de `tests/TempoSyncAndMasterSlave.test.ts`.

| Escenario | Comportamiento esperado según el contrato actual | Comportamiento observado en pruebas deterministas |
|---|---|---|
| Pausa abrupta del Master | La pausa detiene solo ese deck y conserva su posición. El Slave sigue al rate actual; la relación de SYNC permanece activa según la política existente. | Store y motor indican Master pausado, Slave reproduciendo y rate del Slave sin cambios. Los roles siguen asimétricos y coherentes. |
| Stop del Master | Stop rebobina el deck a cero y no detiene al Slave. La relación de SYNC se conserva, igual que en la prueba 7.3 existente. | Playback, roles y rate del Slave son coherentes. Se reprodujo un defecto separado en pitch bend: el motor limpiaba el bend, pero el store conservaba el valor anterior. |
| Descargar el Master | El deck descargado queda detenido; se eliminan el enlace y las marcas Master/Slave. El Slave continúa al rate que ya tenía. | Roles y `syncMasterDeck` quedan limpios; el Slave sigue reproduciendo. Una prueba reforzada con tempos 124/126 confirma que el rate no unitario se conserva tanto en store como en motor. |
| SYNC mientras ambos decks están detenidos | Se establece Master/Slave y se prepara el rate sin iniciar reproducción ni cambiar posición. | La prueba reforzada verifica ambos estados `stopped`, posición cero, Master A y rate de B igual a `124/126` (redondeado a cuatro decimales) en store y motor. |
| Master deja de estar disponible | Tras unload no debe quedar un Master huérfano ni un Slave marcado con SYNC. | `syncMasterDeck` queda `null`, los cuatro flags de rol quedan falsos, y el deck restante continúa de forma independiente. |

### Defecto confirmado y corrección mínima

`AudioEngineService.stopDeck()` pone `transport.bendAmount` a cero. Antes de este seguimiento, `DJStore.stopDeck()` actualizaba playback/posición/CUP pero no `DeckStoreState.pitchBend`. La prueba 7.3 ampliada lo reprodujo: después de un bend de +3.5%, el motor reportaba `0`, mientras el store aún reportaba `3.5`. Esto podía mostrar un bend activo que ya no aplicaba al rate de transporte.

La corrección añade `pitchBend: 0` al mismo update de estado que refleja Stop. Pausa sigue reteniendo el bend; Unload ya inicializa el deck y limpia ese estado. No se modificaron la detección BPM de Fase 1.1, ALIGN, BAR SYNC ni la política de roles.

### Pruebas ejecutadas y resultados

- Antes de la corrección, la prueba enfocada reprodujo el mismatch de pitch bend; los escenarios de ambos-decks-detenidos y descarga no presentaron defectos después de ajustar los casos de cobertura.
- `node --test --experimental-strip-types tests/TempoSyncAndMasterSlave.test.ts`: **41 pasaron, 0 fallaron** después de la corrección.
- `npm test`: **608 pasaron, 0 fallaron** (106 suites).
- `npm run build`: pasó (`tsc -b` y Vite); Vite mostró la advertencia existente de bundle JavaScript principal superior a 500 kB minificado.
- `npm run lint`: pasó.
- `git diff --check`: pasó sin errores.

Los tests usan mocks deterministas de Web Audio y no validan salida sonora. El registro de error de decodificación corrupta que aparece en la suite es el caso esperado de una prueba y la prueba pasa.

### Limitaciones y validación acústica pendiente

La arquitectura conserva explícitamente los roles SYNC tras pausar o detener el Master; el Slave sigue reproduciendo y puede seguir recibiendo cambios de pitch del Master mientras el enlace permanezca activo. Descargar el Master sí desactiva el enlace. Esta auditoría confirmó consistencia de estado y rates en el modelo, pero no determina si esta política es la preferida durante una actuación ni mide continuidad, clicks o pitch audible.

Para validar acústicamente, cargar tracks reales con beats conocidos en dos decks y salida de audio real; registrar BPM, faders, posiciones y rate; activar SYNC; y escuchar/capturar ambos canales antes y después de pausar, detener y descargar el Master. Confirmar continuidad del Slave, velocidad y transitorios; repetir después de un pitch bend y Stop. Incluir una prueba de SYNC con decks detenidos y lanzamiento posterior de ambos. No se declara que SYNC o la mezcla hayan sido validados acústicamente.
