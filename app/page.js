"use client";

import { useEffect, useState } from "react";

const POLL_MS = 20000;

function PlaneIcon() {
  return (
    <svg className="logo-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 16.2v-1.5l-7-4.4V4.8c0-.83-.67-1.5-1.5-1.5S11 3.97 11 4.8v5.5l-7 4.4v1.5l7-2.2v5.1l-2.6 1.7v1.4l3.6-1 3.6 1v-1.4L13 19.1v-5.1l8 2.2z" />
    </svg>
  );
}

function typeLine(a) {
  if (a.category && a.aircraftType) return `${a.category} · ${a.aircraftType}`;
  if (a.category) return a.category;
  if (a.aircraftType) return a.aircraftType;
  return null;
}

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
        <div className="header-title">
          <PlaneIcon />
          <h1>Solent Daedalus</h1>
        </div>
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
          <p className="legend">
            altitude (ft) · distance from field (nm) · speed (kt) · estimated
            time to landing
          </p>
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
                    {typeLine(a) && (
                      <span className="aircraft-type">{typeLine(a)}</span>
                    )}
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
          <p className="legend">
            distance from field (nm) · speed (kt) · climb rate (fpm) ·
            altitude now (ft)
          </p>
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
                    {typeLine(a) && (
                      <span className="aircraft-type">{typeLine(a)}</span>
                    )}
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
