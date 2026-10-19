declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'
  type Bytes = ArrayBuffer | Uint8Array
  /** Parses one layer from its parts; `prj` is a WKT or proj4 definition used to reproject to WGS 84. */
  export default function shp(input: { shp: Bytes; dbf?: Bytes; cpg?: Bytes | string; prj?: Bytes | string }): Promise<FeatureCollection>
  /** Parses a zipped Shapefile (reprojected to WGS 84 using its .prj). */
  export default function shp(input: Bytes | string): Promise<FeatureCollection | FeatureCollection[]>
}
