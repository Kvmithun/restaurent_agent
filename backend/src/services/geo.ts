import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { redis } from '../infra/connections.js';

export type GeoPoint = { type: 'Point'; coordinates: [number, number] };
export type RouteDistance = { distanceMeters: number; durationSeconds: number };
type GeocodeResult = { point: GeoPoint; displayName: string };

let lastNominatimCall = 0;
let requestQueue = Promise.resolve();

function cacheKey(prefix: string, value: string) { return `restaurant:geo:${prefix}:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex')}`; }
function validPoint(value: any): value is GeoPoint {
  return value?.type === 'Point' && Array.isArray(value.coordinates) && value.coordinates.length === 2 && value.coordinates.every(Number.isFinite) && Math.abs(value.coordinates[0]) <= 180 && Math.abs(value.coordinates[1]) <= 90;
}

async function cached<T>(key: string): Promise<T | null> {
  try { const value = await redis.get(key); return value ? JSON.parse(value) as T : null; } catch { return null; }
}
async function saveCache(key: string, value: unknown, ttl = 60 * 60 * 24 * 30) {
  try { await redis.set(key, JSON.stringify(value), 'EX', ttl); } catch { /* Redis cache is optional; continue with provider results. */ }
}

async function nominatimSearch(query: string): Promise<GeocodeResult | null> {
  const key = cacheKey('address', query);
  const previous = await cached<GeocodeResult | { notFound: true }>(key);
  if (previous) return 'notFound' in previous ? null : previous;

  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const prior = requestQueue;
  requestQueue = prior.then(() => turn);
  await prior;
  try {
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatimCall));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatimCall = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, { headers: { 'user-agent': env.NOMINATIM_USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`OpenStreetMap geocoder returned HTTP ${response.status}`);
    const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
    const match = results[0];
    if (!match || !Number.isFinite(Number(match.lat)) || !Number.isFinite(Number(match.lon))) {
      await saveCache(key, { notFound: true }, 60 * 60 * 6);
      return null;
    }
    const result: GeocodeResult = { point: { type: 'Point', coordinates: [Number(match.lon), Number(match.lat)] }, displayName: match.display_name };
    await saveCache(key, result);
    return result;
  } finally { release(); }
}

async function tavilyAddressHint(query: string, placeName?: string): Promise<string | null> {
  if (!env.TAVILY_API_KEY || !placeName) return null;
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { authorization: `Bearer ${env.TAVILY_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: `${placeName} ${query} street address location`, topic: 'general', search_depth: 'basic', max_results: 3, include_answer: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { answer?: string; results?: Array<{ title?: string; content?: string }> };
    const text = [data.answer, data.results?.[0]?.title, data.results?.[0]?.content].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 400) || null;
  } catch { return null; }
}

/** Geocode a manually entered address with OSM. Tavily can provide public place context for a second OSM lookup. */
export async function geocodeAddress(address: string, placeName?: string): Promise<GeocodeResult | null> {
  const normalized = address.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  let direct: GeocodeResult | null = null;
  try { direct = await nominatimSearch(normalized); } catch { /* Geocoding is best-effort; ordering remains available without a route. */ }
  if (direct) return direct;
  const hint = await tavilyAddressHint(normalized, placeName);
  if (!hint) return null;
  try { return await nominatimSearch(`${placeName} ${normalized} ${hint}`); } catch { return null; }
}

export function pointFromCoordinates(value: unknown): GeoPoint | null {
  return validPoint(value) ? value : null;
}

export function straightLineMeters(a: GeoPoint, b: GeoPoint): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const [lon1, lat1] = a.coordinates.map(radians), [lon2, lat2] = b.coordinates.map(radians);
  const dLat = lat2 - lat1, dLon = lon2 - lon1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export async function roadRoute(a: GeoPoint, b: GeoPoint): Promise<RouteDistance | null> {
  const [aLon, aLat] = a.coordinates, [bLon, bLat] = b.coordinates;
  const cacheKeyValue = `${aLon.toFixed(5)},${aLat.toFixed(5)};${bLon.toFixed(5)},${bLat.toFixed(5)}`;
  const key = cacheKey('route', cacheKeyValue);
  const previous = await cached<RouteDistance>(key);
  if (previous) return previous;
  const base = env.OSRM_BASE_URL.replace(/\/$/, '');
  const url = `${base}/route/v1/driving/${aLon},${aLat};${bLon},${bLat}?overview=false&steps=false`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const data = await response.json() as { code?: string; routes?: Array<{ distance?: number; duration?: number }> };
    const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return null;
    const result = { distanceMeters: route.distance!, durationSeconds: route.duration! };
    await saveCache(key, result);
    return result;
  } catch { return null; }
}
