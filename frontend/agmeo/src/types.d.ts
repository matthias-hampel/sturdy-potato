declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'
  /** Parses a zipped Shapefile (reprojected to WGS 84 using its .prj). */
  export default function shp(input: ArrayBuffer | string): Promise<FeatureCollection | FeatureCollection[]>
}
