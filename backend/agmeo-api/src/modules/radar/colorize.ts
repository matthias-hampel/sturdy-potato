/**
 * DWD-style precipitation colours (reference src/lib/dwd/colorize.ts). The classes live in the
 * contracts so the web app's legend shows exactly these.
 */
import { RADAR_PRECIPITATION_CLASSES } from '@agmeo/contracts';

/**
 * mm in 5 minutes → RGBA. Values are compared as mm/h (× 12); NaN and values below the lowest
 * class stay fully transparent.
 */
export function colorize(values: Float32Array): Uint8Array {
  const rgba = new Uint8Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const mmPerHour = v * 12;
    for (let s = RADAR_PRECIPITATION_CLASSES.length - 1; s >= 0; s--) {
      if (mmPerHour >= RADAR_PRECIPITATION_CLASSES[s].mmPerHour) {
        rgba.set(RADAR_PRECIPITATION_CLASSES[s].rgba, i * 4);
        break;
      }
    }
  }
  return rgba;
}
