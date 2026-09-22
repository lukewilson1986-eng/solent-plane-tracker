"use client";

import { useEffect, useState } from "react";

const POLL_MS = 20000;

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch("/api/traffic", { cache: "no-store" });
        const json = await res.json();
        if (!active) return;
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
          setError(null);
        }
      } catch {
        if (active) setError("Can't reach the tracker right now.");
      }
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const landing = data?.landing ?? [];
  const departing = data?.departing ?? [];

  return (
    <main className="page">
      <div className="header">
        <h1>Solent Daedalus</h1>
        <p>Lee-on-Solent · what's queued right now</p>
      </div>

      <div className="status-row">
        <span className={`status-dot${error ? " error" : ""}`} />
        {error
          ? "Can't reach the tracker right now. It'll try again shortly."
          : data
          ? `Updated ${formatTime(data.updated)}`
          : "Loading…"}
      </div>

      <div className="board">
        <div className="landing">
          <p className="section-label landing">Landing soon</p>
          {landing.length === 0 ? (
            <div className="empty-state">
              Nothing inbound right now — you've got a bit of a wait.
            </div>
          ) : (
            <div className="rows">
              {landing.map((a) => (
                <div className="row" key={`${a.callsign}-in`}>
                  <div className="row-main">
                    <span className="callsign">{a.callsign}</span>
                    <span className="row-detail">
                      {a.altitudeFt} ft · {a.distanceNm} nm · {a.speedKt} kt
                    </span>
                  </div>
                  <div className="row-readout">
                    {a.etaMin != null ? `${a.etaMin} min` : "—"}
                    <small>to field</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="departing">
          <p className="section-label departing">Just departed</p>
          {departing.length === 0 ? (
            <div className="empty-state">
              Nothing's climbed out recently.
            </div>
          ) : (
            <div className="rows">
              {departing.map((a) => (
                <div className="row" key={`${a.callsign}-out`}>
                  <div className="row-main">
                    <span className="callsign">{a.callsign}</span>
                    <span className="row-detail">
                      {a.distanceNm} nm · {a.speedKt} kt ·{" "}
                      {a.verticalFpm > 0 ? "+" : ""}
                      {a.verticalFpm} fpm
                    </span>
                  </div>
                  <div className="row-readout">
                    {a.altitudeFt} ft<small>climbing</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="footnote">
        Built from public ADS-B data, refreshed every 20 seconds. Not every
        aircraft broadcasts a position — some smaller types and gliders may
        not appear. Not for navigation.
      </p>
    </main>
  );
}
