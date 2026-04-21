import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import "../player.css";
import { initLateNightRadio } from "../player-runtime.js";
import timetrackUrl from "../timetrack.mp3";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Late Night Radio — Dual Track Player" },
      {
        name: "description",
        content:
          "A late-night radio web player with a looping time announcer that ducks your music queue automatically.",
      },
      { property: "og:title", content: "Late Night Radio — Dual Track Player" },
      {
        property: "og:description",
        content:
          "Vanilla JS web player with VAD-based ducking, queue management, and a moody amber visualizer.",
      },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&display=swap",
      },
    ],
  }),
});

function Index() {
  useEffect(() => {
    const cleanup = initLateNightRadio();
    return cleanup;
  }, []);

  return (
    <>
      <div className="grain" aria-hidden="true" />

      <main className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="logo-dot" />
            <div>
              <h1 className="brand-title">Late Night Radio</h1>
            </div>
          </div>

          <div className="status-cluster">
            <div className="live-pill" id="liveStatus">
              <span className="live-dot" />
              <span className="live-label">TIME LOOP</span>
            </div>
            <div className="onair-pill" id="onAirBadge" data-active="false">
              <span className="onair-dot" />
              <span>ON AIR</span>
            </div>
          </div>
        </header>

        <section className="grid">
          <article className="card glass now-playing">
            <div className="card-head">
              <span className="kicker">Now Spinning</span>
              <span className="mono" id="trackTime">00:00 / 00:00</span>
            </div>

            <h2 className="track-title" id="trackTitle">No track loaded</h2>
            <p className="track-meta" id="trackMeta">Drop a file to begin transmission.</p>

            <canvas id="visualizer" className="visualizer" />

            <div className="progress" id="progressWrap">
              <div className="progress-bar" id="progressBar" />
            </div>

            <div className="transport">
              <button className="btn ghost" id="skipBtn" title="Skip to next track" disabled>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M6 6h2v12H6zM9.5 12L18 6v12z" />
                </svg>
              </button>
              <button className="btn primary" id="playBtn" title="Play / Pause" disabled>
                <svg id="playIcon" viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <svg
                  id="pauseIcon"
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="currentColor"
                  style={{ display: "none" }}
                >
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                </svg>
              </button>
              <div className="vad-readout mono" id="vadReadout">VAD · 0.000</div>
            </div>
          </article>

          <article className="card glass queue-card">
            <div className="card-head">
              <span className="kicker">Queue</span>
              <span className="mono" id="queueCount">0 tracks</span>
            </div>

            <div className="dropzone" id="dropzone" tabIndex={0}>
              <input type="file" id="fileInput" accept="audio/*" multiple hidden />
              <div className="drop-inner">
                <div className="drop-icon">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="drop-title">Drop audio here</p>
                <p className="drop-sub">
                  or <span className="link">browse files</span> · MP3, WAV, OGG
                </p>
              </div>
            </div>

            <ul className="queue-list" id="queueList">
              <li className="queue-empty">Queue is empty — your tracks will appear here.</li>
            </ul>
          </article>

          <article className="card glass mixer">
            <div className="card-head">
              <span className="kicker">Mixer</span>
              <span className="mono">2 CH</span>
            </div>

            <div className="channels">
              <div className="channel">
                <div className="channel-head">
                  <div>
                    <p className="ch-label">CH&nbsp;A</p>
                    <p className="ch-name">Time Announcer</p>
                  </div>
                  <span className="ch-value mono" id="volAValue">80</span>
                </div>
                <input
                  type="range"
                  id="volA"
                  min="0"
                  max="100"
                  defaultValue="80"
                  className="slider slider--amber"
                />
                <p className="ch-foot mono">LOOP · DUCK SOURCE</p>
              </div>

              <div className="channel">
                <div className="channel-head">
                  <div>
                    <p className="ch-label">CH&nbsp;B</p>
                    <p className="ch-name">Music Queue</p>
                  </div>
                  <span className="ch-value mono" id="volBValue">70</span>
                </div>
                <input
                  type="range"
                  id="volB"
                  min="0"
                  max="100"
                  defaultValue="70"
                  className="slider slider--cream"
                />
                <p className="ch-foot mono">
                  <span id="duckState">IDLE</span> · DUCK TARGET
                </p>
              </div>
            </div>
          </article>
        </section>

        <footer className="foot mono">
          <span>// signal stable</span>
          <span id="clockReadout">--:--:--</span>
        </footer>
      </main>

      {/* Hidden audio elements */}
      <audio id="audioA" src={timetrackUrl} loop preload="auto" crossOrigin="anonymous" />
      <audio id="audioB" preload="auto" crossOrigin="anonymous" />
    </>
  );
}
