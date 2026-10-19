declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'
  type Bytes = ArrayBuffer | Uint8Array
  /**
   * Parses a zipped Shapefile, or its parts (.shp with optional .dbf, .prj, .cpg), reprojected
   * to WGS 84 using the .prj.
   */
  export default function shp(input: Bytes | string | { shp: Bytes; dbf?: Bytes; prj?: Bytes | string; cpg?: Bytes | string }): Promise<FeatureCollection | FeatureCollection[]>
}
