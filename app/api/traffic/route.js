import { NextResponse } from "next/server";

// OpenSky's servers time out every connection from Vercel's network
// (both standard and Edge), confirmed via diagnostics, likely due to
// blocking of cloud/hosting-provider IP ranges. adsb.lol is a free,
// no-auth ADS-B aggregator built for exactly this kind of use and
// responds fine from Vercel.
export const runtime = "edge";

// Solent Airport Daedalus (EGHF), Lee-on-Solent — official ARP.
const AIRPORT = { lat: 50.8156, lon: -1.2067 };

// Search radius requested from adsb.lol, in nautical miles. A bit
// larger than MAX_DISTANCE_NM so aircraft on approach/departure are
// already in view before they cross that cutoff.
const SEARCH_RADIUS_NM = 15;

// Aircraft further than this from the field are treated as just
// passing through, not queued for it.
const MAX_DISTANCE_NM = 10.8; // ~20 km

// Aircraft above this altitude are treated as overflying traffic,
// not part of the circuit / approach / departure picture.
const MAX_ALTITUDE_FT = 4400;

// How fast an aircraft has to be climbing/descending (feet/min)
// before we count it as "departing" or "landing" rather than level
// flight.
const CLIMB_THRESHOLD_FPM = 100;
const DESCENT_THRESHOLD_FPM = -100;

// How closely an aircraft's track has to line up with the direct
// bearing to/from the airport to count as heading there, in degrees.
const TRACK_TOLERANCE_DEG = 70;

// Ground movements only happen right at the field, so this is much
// tighter than MAX_DISTANCE_NM.
const GROUND_MAX_DISTANCE_NM = 1;

// Ground speed below this is treated as parked (GPS jitter, engine
// warm-up) rather than actually taxiing.
const TAXI_MIN_GS_KT = 2;

const POINT_URL = "https://api.adsb.lol/v2/point";

// ADS-B "emitter category" codes (DO-260B), reduced to the ones
// likely to show up near a small GA field. Aircraft that don't
// broadcast a category, or send one outside this list, get no label
// rather than a guessed one.
const CATEGORY_LABELS = {
  A1: "Light aircraft",
  A2: "Small aircraft",
  A3: "Large aircraft",
  A4: "Large aircraft",
  A5: "Heavy aircraft",
  A6: "High-performance aircraft",
  A7: "Helicopter",
  B1: "Glider",
  B2: "Airship/balloon",
  B4: "Microlight/paraglider",
  B6: "Drone",
};

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function distanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
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

function classify(aircraft) {
  const landing = [];
  const departing = [];
  const onGround = [];

  for (const a of aircraft) {
    const {
      hex,
      flight,
      lat,
      lon,
      alt_baro: altBaro,
      gs,
      track,
      true_heading: trueHeading,
      baro_rate: baroRate,
      t: typeCode,
      category: categoryCode,
    } = a;

    if (lat == null || lon == null || gs == null) continue;

    const dNm = distanceNm(AIRPORT.lat, AIRPORT.lon, lat, lon);
    const callsign = (flight || "").trim() || hex.toUpperCase();
    const category = CATEGORY_LABELS[categoryCode] || null;
    const aircraftType = typeCode || null;

    if (altBaro === "ground") {
      if (dNm <= GROUND_MAX_DISTANCE_NM && gs >= TAXI_MIN_GS_KT) {
        const heading = track ?? trueHeading;
        onGround.push({
          callsign,
          speedKt: Math.round(gs),
          headingDeg: heading != null ? Math.round(heading) % 360 : null,
          category,
          aircraftType,
          distanceNm: Math.round(dNm * 10) / 10,
        });
      }
      continue;
    }

    if (typeof altBaro !== "number" || track == null || baroRate == null) {
      continue;
    }

    if (dNm > MAX_DISTANCE_NM) continue;
    if (altBaro > MAX_ALTITUDE_FT) continue;

    const altitudeFt = Math.round(altBaro);
    const distanceNmRounded = Math.round(dNm * 10) / 10;
    const speedKt = Math.round(gs);
    const verticalFpm = Math.round(baroRate);

    if (baroRate <= DESCENT_THRESHOLD_FPM) {
      const bearingToAirport = bearingDeg(lat, lon, AIRPORT.lat, AIRPORT.lon);
      if (angleDiff(track, bearingToAirport) <= TRACK_TOLERANCE_DEG) {
        const speedKmh = gs * 1.852;
        const etaMin =
          speedKmh > 5
            ? Math.max(0, Math.round((dNm * 1.852 / speedKmh) * 60))
            : null;
        landing.push({
          callsign,
          altitudeFt,
          distanceNm: distanceNmRounded,
          speedKt,
          verticalFpm,
          etaMin,
          category,
          aircraftType,
        });
      }
    } else if (baroRate >= CLIMB_THRESHOLD_FPM) {
      const bearingFromAirport = bearingDeg(
        AIRPORT.lat,
        AIRPORT.lon,
        lat,
        lon
      );
      if (angleDiff(track, bearingFromAirport) <= TRACK_TOLERANCE_DEG) {
        departing.push({
          callsign,
          altitudeFt,
          distanceNm: distanceNmRounded,
          speedKt,
          verticalFpm,
          category,
          aircraftType,
        });
      }
    }
  }

  landing.sort((a, b) => (a.etaMin ?? 999) - (b.etaMin ?? 999));
  departing.sort((a, b) => a.altitudeFt - b.altitudeFt);
  onGround.sort((a, b) => a.distanceNm - b.distanceNm);

  return { landing, departing, onGround };
}

export async function GET() {
  try {
    const url = `${POINT_URL}/${AIRPORT.lat}/${AIRPORT.lon}/${SEARCH_RADIUS_NM}`;

    // Shared across everyone viewing the page for 20 seconds, so one
    // fetch serves any number of visitors.
    const res = await fetch(url, {
      next: { revalidate: 20 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `adsb.lol returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const { landing, departing, onGround } = classify(data.ac || []);

    return NextResponse.json({
      updated: new Date().toISOString(),
      landing,
      departing,
      onGround,
    });
  } catch (err) {
    console.error("traffic route failed:", err);
    return NextResponse.json(
      { error: err.message || "Something went wrong." },
      { status: 500 }
    );
  }
}
