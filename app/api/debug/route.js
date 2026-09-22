import { NextResponse } from "next/server";

export const runtime = "edge";

async function check(url, init) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    return { ok: true, status: res.status, ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      cause: err.cause ? String(err.cause) : null,
      ms: Date.now() - start,
    };
  }
}

export async function GET() {
  const anonymousStates = await check(
    "https://opensky-network.org/api/states/all?lamin=50&lamax=51&lomin=-2&lomax=0"
  );
  const authToken = await check(
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    { method: "POST" }
  );
  const adsbLol = await check(
    "https://api.adsb.lol/v2/point/50.8156/-1.2067/15"
  );
  return NextResponse.json({ anonymousStates, authToken, adsbLol });
}
