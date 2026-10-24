// Geometry helpers for the map pipeline. Coordinates are [lon, lat] in degrees unless noted.

export type Position = [number, number];
export type Ring = Position[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

export function toMultiPolygon(geometry: { type: string; coordinates: unknown }): MultiPolygon {
  if (geometry.type === 'Polygon') return [geometry.coordinates as Polygon];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as MultiPolygon;
  throw new Error(`Unsupported geometry type ${geometry.type}`);
}

/**
 * Miller cylindrical projection onto a raster of the given width. It keeps shapes close to
 * Mercator in the middle latitudes but tames the poles, which suits a world strategy map.
 */
export class MillerProjection {
  readonly width: number;
  readonly height: number;
  readonly latNorth: number;
  readonly latSouth: number;
  private readonly scale: number;
  private readonly yNorth: number;

  constructor(width: number, latNorth: number, latSouth: number) {
    this.width = width;
    this.latNorth = latNorth;
    this.latSouth = latSouth;
    this.scale = width / (2 * Math.PI);
    this.yNorth = MillerProjection.millerY(latNorth);
    this.height = Math.ceil((this.yNorth - MillerProjection.millerY(latSouth)) * this.scale);
  }

  static millerY(lat: number): number {
    return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD));
  }

  /** Projects [lon, lat] to raster pixel coordinates (x right, y down). */
  project(lon: number, lat: number): Position {
    return [
      ((lon + 180) / 360) * this.width,
      (this.yNorth - MillerProjection.millerY(lat)) * this.scale,
    ];
  }

  /** Inverse of project(). */
  unproject(x: number, y: number): Position {
    const my = this.yNorth - y / this.scale;
    const lat = (Math.atan(Math.exp(0.8 * my)) - Math.PI / 4) / (0.4 * RAD);
    return [(x / this.width) * 360 - 180, lat];
  }

  /** Approximate real-world size of one pixel side in km at a raster row. */
  pixelKm(y: number): number {
    const [, lat] = this.unproject(0, y);
    return ((2 * Math.PI * EARTH_RADIUS_KM) / this.width) * Math.cos(lat * RAD);
  }

  describe(): Record<string, unknown> {
    return {
      name: 'Miller cylindrical',
      formula:
        'x = (lon + 180) / 360 * width; y = (yNorth - 1.25 * ln(tan(pi/4 + 0.4 * lat))) * width / (2 * pi)',
      latNorth: this.latNorth,
      latSouth: this.latSouth,
      lonWest: -180,
      lonEast: 180,
    };
  }
}

/** Spherical area of a ring in km² (unsigned). */
export function ringAreaKm2(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i]!;
    const [lon2, lat2] = ring[i + 1]!;
    sum += (lon2 - lon1) * RAD * (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD));
  }
  return Math.abs((sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

export function multiPolygonAreaKm2(mp: MultiPolygon): number {
  let total = 0;
  for (const polygon of mp) {
    polygon.forEach((ring, i) => {
      total += i === 0 ? ringAreaKm2(ring) : -ringAreaKm2(ring);
    });
  }
  return total;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(mp: MultiPolygon): BBox {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const polygon of mp) {
    for (const [x, y] of polygon[0]!) {
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  }
  return box;
}

/** Even-odd point-in-polygon test over all rings of a multipolygon. */
export function containsPoint(mp: MultiPolygon, x: number, y: number): boolean {
  let inside = false;
  for (const polygon of mp) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

/** Great-circle distance in km. */
export function distanceKm(a: Position, b: Position): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
