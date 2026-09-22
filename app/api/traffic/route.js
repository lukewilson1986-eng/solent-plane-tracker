import { NextResponse } from "next/server";

// OpenSky's servers time out connections from Vercel's standard
// (AWS-based) serverless network, but respond fine over the Edge
// network, so this route runs on the edge instead.
export const runtime = "edge";

// Solent Airport Daedalus (EGHF), Lee-on-Solent — official ARP.
const AIRPORT = { lat: 50.8156, lon: -1.2067 };

// How far out (in degrees) we ask OpenSky to search. Roughly a
// 25km x 25km box centred on the airfield.
const SEARCH_BOX = { lat: 0.22, lon: 0.34 };

// Aircraft further than this from the field are treated as just
// passing through, not queued for it.
const MAX_DISTANCE_KM = 20;

// Aircraft above this altitude are treated as overflying traffic,
// not part of the circuit / approach / departure picture.
const MAX_ALTITUDE_M = 1350; // ~4,400 ft

// How fast an aircraft has to be climbing/descending (m/s) before
// we count it as "departing" or "landing" rather than level flight.
const CLIMB_THRESHOLD_MS = 0.5;
const DESCENT_THRESHOLD_MS = -0.5;

// How closely an aircraft's track has to line up with the direct
// bearing to/from the airport to count as heading there, in degrees.
const TRACK_TOLERANCE_DEG = 70;

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";

// Kept across warm serverless invocations so we don't fetch a new
// token on every single request.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET environment variables."
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`OpenSky login failed (${res.status})`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Refresh a little before it actually expires.
  tokenExpiresAt = now + Math.max(0, (data.expires_in || 60) - 30) * 1000;
  return cachedToken;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDiff(a, b) {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function classify(states) {
  const landing = [];
  const departing = [];

  for (const s of states) {
    const icao24 = s[0];
    const rawCallsign = s[1];
    const lon = s[5];
    const lat = s[6];
    const baroAlt = s[7];
    const onGround = s[8];
    const velocity = s[9];
    const trueTrack = s[10];
    const verticalRate = s[11];

    if (onGround) continue;
    if (
      lat == null ||
      lon == null ||
      baroAlt == null ||
      verticalRate == null ||
      trueTrack == null ||
      velocity == null
    ) {
      continue;
    }

    const dKm = distanceKm(AIRPORT.lat, AIRPORT.lon, lat, lon);
    if (dKm > MAX_DISTANCE_KM) continue;
    if (baroAlt > MAX_ALTITUDE_M) continue;

    const callsign = (rawCallsign || "").trim() || icao24.toUpperCase();
    const altitudeFt = Math.round(baroAlt * 3.28084);
    const distanceNm = Math.round(dKm * 0.539957 * 10) / 10;
    const speedKt = Math.round(velocity * 1.94384);
    const verticalFpm = Math.round(verticalRate * 196.85);

    if (verticalRate <= DESCENT_THRESHOLD_MS) {
      const bearingToAirport = bearingDeg(lat, lon, AIRPORT.lat, AIRPORT.lon);
      if (angleDiff(trueTrack, bearingToAirport) <= TRACK_TOLERANCE_DEG) {
        const speedKmh = velocity * 3.6;
        const etaMin =
          speedKmh > 5 ? Math.max(0, Math.round((dKm / speedKmh) * 60)) : null;
        landing.push({
          callsign,
          altitudeFt,
          distanceNm,
          speedKt,
          verticalFpm,
          etaMin,
        });
      }
    } else if (verticalRate >= CLIMB_THRESHOLD_MS) {
      const bearingFromAirport = bearingDeg(
        AIRPORT.lat,
        AIRPORT.lon,
        lat,
        lon
      );
      if (angleDiff(trueTrack, bearingFromAirport) <= TRACK_TOLERANCE_DEG) {
        departing.push({
          callsign,
          altitudeFt,
          distanceNm,
          speedKt,
          verticalFpm,
        });
      }
    }
  }

  landing.sort((a, b) => (a.etaMin ?? 999) - (b.etaMin ?? 999));
  departing.sort((a, b) => a.altitudeFt - b.altitudeFt);

  return { landing, departing };
}

export async function GET() {
  try {
    const token = await getAccessToken();

    const params = new URLSearchParams({
      lamin: (AIRPORT.lat - SEARCH_BOX.lat).toFixed(4),
      lamax: (AIRPORT.lat + SEARCH_BOX.lat).toFixed(4),
      lomin: (AIRPORT.lon - SEARCH_BOX.lon).toFixed(4),
      lomax: (AIRPORT.lon + SEARCH_BOX.lon).toFixed(4),
    });

    // Shared across everyone viewing the page for 20 seconds, so one
    // fetch serves any number of visitors.
    const res = await fetch(`${STATES_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 20 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `OpenSky returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const { landing, departing } = classify(data.states || []);

    return NextResponse.json({
      updated: new Date().toISOString(),
      landing,
      departing,
    });
  } catch (err) {
    console.error("traffic route failed:", err);
    return NextResponse.json(
      { error: err.message || "Something went wrong." },
      { status: 500 }
    );
  }
}
