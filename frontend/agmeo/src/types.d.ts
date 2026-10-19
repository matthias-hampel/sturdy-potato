declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'
  /** Parses a zipped Shapefile (reprojected to WGS 84 using its .prj). */
  export default function shp(input: ArrayBuffer | string): Promise<FeatureCollection | FeatureCollection[]>
  /** Parses one layer from its parts; `prj` is a WKT or proj4 definition used to reproject to WGS 84. */
  export default function shp(input: { shp: ArrayBuffer; dbf?: ArrayBuffer; cpg?: string; prj?: string }): Promise<FeatureCollection>
}
