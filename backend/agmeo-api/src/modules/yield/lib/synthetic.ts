import type { Geometry } from 'geojson';
import { type GridDefinition, GridError, projector, rasterizeGeometryMask, unprojector } from './grid.js';

/** An index layer of a field raster from the satellite pipeline, on its own grid. */
export type IndexRaster = GridDefinition & { values: Float64Array };

export type SyntheticYieldOptions = {
  /**
   * Distribution strength: how strongly relative NDVI deviations map to yield. 1 =
   * proportional (a pixel 20 % above the field mean gets 20 % more yield), 0.5 = halved. The
   * field mean stays exact for any value.
   */
  spread?: number;
};

/**
 * Estimate a yield map where no harvest-monitor data exists (the soil-map principle): a
 * cloud-free NDVI scene acts as the spatial distributor — each pixel's NDVI relative to the
 * field mean, multiplied by the documented average yield.
 */
export function syntheticYieldEstimate(grid: GridDefinition, boundary: Geometry, ndvi: IndexRaster, meanYieldTHa: number, options: SyntheticYieldOptions = {}): Float64Array {
  const mask = rasterizeGeometryMask(boundary, grid);
  const sampled = new Float64Array(grid.width * grid.height).fill(NaN);
  const sameCrs = ndvi.epsg === grid.epsg;
  const back = unprojector(grid.epsg);
  const into = sameCrs ? null : projector(ndvi.epsg);
  let sum = 0;
  let count = 0;
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const idx = row * grid.width + col;
      if (!mask[idx]) continue;
      let x = grid.originX + (col + 0.5) * grid.resolution;
      let y = grid.originY - (row + 0.5) * grid.resolution;
      if (into) [x, y] = into(...back(x, y));
      const c = Math.floor((x - ndvi.originX) / ndvi.resolution);
      const r = Math.floor((ndvi.originY - y) / ndvi.resolution);
      if (c < 0 || r < 0 || c >= ndvi.width || r >= ndvi.height) continue;
      const value = ndvi.values[r * ndvi.width + c];
      if (!Number.isFinite(value) || value <= 0) continue;
      sampled[idx] = value;
      sum += value;
      count++;
    }
  }
  if (count === 0) throw new GridError('The NDVI scene does not cover the field', 404);
  const sceneMean = sum / count;
  const spread = options.spread ?? 1;
  const estimate = new Float64Array(sampled.length).fill(NaN);
  for (let i = 0; i < sampled.length; i++) {
    if (Number.isFinite(sampled[i])) estimate[i] = Math.max(0, (1 + spread * (sampled[i] / sceneMean - 1)) * meanYieldTHa);
  }
  return estimate;
}
