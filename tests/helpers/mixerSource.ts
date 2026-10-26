/**
 * Fuente completa del mixer central (sección 4) para las pruebas que inspeccionan el código: el
 * organismo, sus moléculas y el modelo puro que decide LEDs, niveles y curvas.
 */

import fs from 'node:fs';
import path from 'node:path';

export const MIXER_SOURCE_FILES = [
  'src/components/dj/organisms/MixerConsole.tsx',
  'src/components/dj/molecules/MixerChannelStrip.tsx',
  'src/components/dj/molecules/MixerMasterStrip.tsx',
  'src/components/dj/molecules/MixerCrossfader.tsx',
  'src/services/console/mixerPanelModel.ts',
];

export const readMixerSource = (): string =>
  MIXER_SOURCE_FILES.map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8')).join('\n');
