// Client-side geocoding via Google Geocoding API.
// Used to move the map pin when the user types an address in a form field.
import { GOOGLE_MAPS_KEY } from "@/src/components/map-html";

export type GeoResult = { lat: number; lng: number; display: string };

export async function searchAddress(q: string): Promise<GeoResult | null> {
  const query = (q || "").trim();
  if (!query) return null;
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=id&key=${GOOGLE_MAPS_KEY}`,
  );
  const d = await res.json();
  const r = d && d.results && d.results[0];
  if (!r || !r.geometry) return null;
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, display: r.formatted_address };
}
