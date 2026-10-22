/**
 * Compatibilidad de `lamejs@1.2.1` con bundlers ESM/Workers.
 *
 * La publicación 1.2.1 de npm contiene referencias globales implícitas entre sus
 * módulos (`MPEGMode`, `Lame`, `BitStream`) que fallan con `ReferenceError` al
 * importar el paquete en Node ESM o al empaquetarlo con Vite. La solución oficial
 * descrita en zhuker/lamejs#86 es exponer esos módulos antes de instanciar el
 * encoder. Este módulo concentra ese shim para no contaminar el resto del código.
 */

import MPEGMode from 'lamejs/src/js/MPEGMode.js';
import Lame from 'lamejs/src/js/Lame.js';
import BitStream from 'lamejs/src/js/BitStream.js';
import lamejs from 'lamejs';

const scope = globalThis as unknown as Record<string, unknown>;
scope.MPEGMode ??= MPEGMode;
scope.Lame ??= Lame;
scope.BitStream ??= BitStream;

export { lamejs };
