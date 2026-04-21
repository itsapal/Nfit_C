/* =============================================================
 * LATE NIGHT RADIO — app.js
 * Vanilla JS dual-track player with VAD-based ducking.
 *
 * Track A (audioA): looping time announcer at /audio/timetrack.mp3
 *   -> AnalyserNode samples RMS every 100ms.
 *   -> When speaking, Track B is ducked to ~15%.
 * Track B (audioB): user-uploaded music queue, plays sequentially.
 * ============================================================= */

(() => {
  // ---------- DOM ----------
  const audioA = document.getElementById("audioA");
  const audioB = document.getElementById("audioB");

  const playBtn = document.getElementById("playBtn");
  const skipBtn = document.getElementById("skipBtn");
  const playIcon = document.getElementById("playIcon");
  const pauseIcon = document.getElementById("pauseIcon");

  const trackTitle = document.getElementById("trackTitle");
  const trackMeta = document.getElementById("trackMeta");
  const trackTime = document.getElementById("trackTime");
  const progressBar = document.getElementById("progressBar");
  const progressWrap = document.getElementById("progressWrap");

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const queueList = document.getElementById("queueList");
  const queueCount = document.getElementById("queueCount");
  const presetList = document.getElementById("presetList");
  const presetCount = document.getElementById("presetCount");

  const volA = document.getElementById("volA");
  const volB = document.getElementById("volB");
  const volAValue = document.getElementById("volAValue");
  const volBValue = document.getElementById("volBValue");

  const onAirBadge = document.getElementById("onAirBadge");
  const duckState = document.getElementById("duckState");
  const vadReadout = document.getElementById("vadReadout");
  const visualizer = document.getElementById("visualizer");
  const clockReadout = document.getElementById("clockReadout");
  const timeCounterValue = document.getElementById("timeCounterValue");
  const counterMeta = document.getElementById("counterMeta");
  const counterStep = document.getElementById("counterStep");

  // ---------- State ----------
  /** @type {{name:string,url:string,objectUrl?:boolean}[]} */
  const queue = [];
  /** @type {{name:string,tracks:{name:string,url:string}[]}[]} */
  const presets = [];
  let currentIndex = -1; // index of the currently playing item in queue
  let isPlaying = false;
  let audioCtx = null;
  let gainA = null;
  let gainB = null;
  let analyserA = null;
  let analyserB = null;
  let vadInterval = null;
  let isSpeaking = false;
  const VAD_THRESHOLD = 0.015;
  const DUCK_LEVEL = 0.15; // 15% of base
  const COUNTER_FALLBACK_STEP_SECONDS = 7;
  /** @type {number[]} */
  let counterTimestamps = [];
  let counterValue = 0;
  let lastCounterSource = "";
  let userVolB = parseInt(volB.value, 10) / 100; // base level
  let userVolA = parseInt(volA.value, 10) / 100;

  // ---------- Audio graph ----------
  function ensureAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const srcA = audioCtx.createMediaElementSource(audioA);
    const srcB = audioCtx.createMediaElementSource(audioB);

    gainA = audioCtx.createGain();
    gainB = audioCtx.createGain();
    gainA.gain.value = userVolA;
    gainB.gain.value = userVolB;

    analyserA = audioCtx.createAnalyser();
    analyserA.fftSize = 1024;
    analyserB = audioCtx.createAnalyser();
    analyserB.fftSize = 256;

    // A: source -> gain -> analyser -> destination
    srcA.connect(gainA);
    gainA.connect(analyserA);
    analyserA.connect(audioCtx.destination);

    // B: source -> gain -> analyser -> destination
    srcB.connect(gainB);
    gainB.connect(analyserB);
    analyserB.connect(audioCtx.destination);

    startVad();
    drawVisualizer();
  }

  // ---------- VAD ----------
  function startVad() {
    if (vadInterval) return;
    const buf = new Uint8Array(analyserA.fftSize);
    vadInterval = setInterval(() => {
      analyserA.getByteTimeDomainData(buf);
      // Compute RMS over normalized [-1,1] samples
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      vadReadout.textContent = `VAD · ${rms.toFixed(3)}`;

      const speaking = rms > VAD_THRESHOLD && !audioA.paused;
      if (speaking !== isSpeaking) {
        isSpeaking = speaking;
        applyDucking();
      }
    }, 100);
  }

  function applyDucking() {
    if (!gainB) return;
    const now = audioCtx.currentTime;
    gainB.gain.cancelScheduledValues(now);
    gainB.gain.setValueAtTime(gainB.gain.value, now);

    if (isSpeaking) {
      // Duck down quickly (200ms)
      gainB.gain.linearRampToValueAtTime(userVolB * DUCK_LEVEL, now + 0.2);
      onAirBadge.dataset.active = "true";
      duckState.textContent = "DUCKED";
      duckState.dataset.active = "true";
    } else {
      // Restore smoothly (400ms)
      gainB.gain.linearRampToValueAtTime(userVolB, now + 0.4);
      onAirBadge.dataset.active = "false";
      duckState.textContent = "IDLE";
      duckState.dataset.active = "false";
    }
  }

  // ---------- Visualizer ----------
  const vctx = visualizer.getContext("2d");

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = visualizer.getBoundingClientRect();
    visualizer.width = rect.width * dpr;
    visualizer.height = rect.height * dpr;
    vctx.scale(dpr, dpr);
  }
  window.addEventListener("resize", () => {
    visualizer.width = visualizer.width; // reset transform
    resizeCanvas();
  });
  resizeCanvas();

  function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    if (!analyserB) return;

    const w = visualizer.clientWidth;
    const h = visualizer.clientHeight;
    vctx.clearRect(0, 0, w, h);

    const bins = analyserB.frequencyBinCount;
    const data = new Uint8Array(bins);
    analyserB.getByteFrequencyData(data);

    const barCount = 56;
    const step = Math.floor(bins / barCount);
    const barW = (w / barCount) * 0.7;
    const gap = (w / barCount) * 0.3;

    for (let i = 0; i < barCount; i++) {
      const v = data[i * step] / 255;
      const barH = Math.max(2, v * h * 0.95);
      const x = i * (barW + gap);
      const y = h - barH;

      const grad = vctx.createLinearGradient(0, y, 0, h);
      grad.addColorStop(0, "#ffc24d");
      grad.addColorStop(1, "#f0a500");
      vctx.fillStyle = grad;
      vctx.shadowColor = "rgba(240,165,0,0.5)";
      vctx.shadowBlur = 10;
      vctx.fillRect(x, y, barW, barH);
    }
    vctx.shadowBlur = 0;
  }

  // ---------- Queue management ----------
  function addFiles(files) {
    const added = [];
    for (const file of files) {
      if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name)) continue;
      const url = URL.createObjectURL(file);
      queue.push({ name: file.name.replace(/\.[^.]+$/, ""), url, objectUrl: true });
      added.push(queue.length - 1);
    }
    renderQueue();
    if (currentIndex === -1 && queue.length > 0) {
      loadTrack(0);
    }
  }

  function loadPresetManifest() {
    presets.length = 0;
    const source = Array.isArray(window.SONG_PRESETS) ? window.SONG_PRESETS : [];
    for (const preset of source) {
      if (!preset || typeof preset.name !== "string" || !Array.isArray(preset.tracks)) continue;
      const tracks = preset.tracks
        .filter((track) => track && typeof track.name === "string" && typeof track.url === "string")
        .map((track) => ({ name: track.name, url: track.url }));
      if (tracks.length === 0) continue;
      tracks.sort((a, b) => a.name.localeCompare(b.name));
      presets.push({ name: preset.name, tracks });
    }
    presets.sort((a, b) => a.name.localeCompare(b.name));
    renderPresets();
  }

  function renderPresets() {
    if (!presetList || !presetCount) return;
    presetCount.textContent = `${presets.length} preset${presets.length === 1 ? "" : "s"}`;
    if (presets.length === 0) {
      presetList.innerHTML = `<p class="preset-empty mono">No preset folders found yet.</p>`;
      return;
    }

    presetList.innerHTML = "";
    presets.forEach((preset, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset-btn";
      btn.dataset.presetIndex = String(idx);
      btn.innerHTML = `
        <span class="preset-name">${escapeHtml(preset.name)}</span>
        <span class="preset-meta mono">${preset.tracks.length} track${preset.tracks.length === 1 ? "" : "s"} · Add to queue</span>
      `;
      presetList.appendChild(btn);
    });
  }

  function addPresetToQueue(presetIndex) {
    const preset = presets[presetIndex];
    if (!preset || preset.tracks.length === 0) return;
    for (const track of preset.tracks) {
      queue.push({ name: track.name, url: track.url });
    }
    renderQueue();
    if (currentIndex === -1 && queue.length > 0) {
      loadTrack(0);
    }
  }

  function renderQueue() {
    queueCount.textContent = `${queue.length} track${queue.length === 1 ? "" : "s"}`;
    if (queue.length === 0) {
      queueList.innerHTML = `<li class="queue-empty">Queue is empty — your tracks will appear here.</li>`;
      skipBtn.disabled = true;
      playBtn.disabled = true;
      return;
    }

    queueList.innerHTML = "";
    queue.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "queue-item" + (i === currentIndex ? " is-current" : "");
      li.innerHTML = `
        <span class="qi-index mono">${String(i + 1).padStart(2, "0")}</span>
        <span class="qi-name">${escapeHtml(item.name)}</span>
        <button class="qi-remove" aria-label="Remove" data-index="${i}">✕</button>
      `;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".qi-remove")) return;
        loadTrack(i);
        playB();
      });
      queueList.appendChild(li);
    });

    queueList.querySelectorAll(".qi-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFromQueue(parseInt(btn.dataset.index, 10));
      });
    });

    playBtn.disabled = false;
    skipBtn.disabled = queue.length <= 1;
  }

  function removeFromQueue(idx) {
    const item = queue[idx];
    if (!item) return;

    if (idx === currentIndex) {
      // Stop and try to advance
      audioB.pause();
      if (item.objectUrl) URL.revokeObjectURL(item.url);
      queue.splice(idx, 1);
      if (queue.length === 0) {
        currentIndex = -1;
        trackTitle.textContent = "No track loaded";
        trackMeta.textContent = "Drop a file to begin transmission.";
        trackTime.textContent = "00:00 / 00:00";
        progressBar.style.width = "0%";
        setPlayingUI(false);
      } else {
        const nextIdx = Math.min(idx, queue.length - 1);
        currentIndex = -1;
        loadTrack(nextIdx);
        if (isPlaying) playB();
      }
    } else {
      if (item.objectUrl) URL.revokeObjectURL(item.url);
      queue.splice(idx, 1);
      if (idx < currentIndex) currentIndex--;
    }
    renderQueue();
  }

  // ---------- Playback ----------
  function loadTrack(i) {
    if (i < 0 || i >= queue.length) return;
    currentIndex = i;
    const item = queue[i];
    audioB.src = item.url;
    trackTitle.textContent = item.name;
    trackMeta.textContent = `Track ${i + 1} of ${queue.length}`;
    renderQueue();
  }

  async function playB() {
    if (queue.length === 0) return;
    ensureAudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    try {
      await audioB.play();
      // Also start Track A on first gesture
      if (audioA.paused) {
        audioA.play().catch(() => {});
      }
      setPlayingUI(true);
    } catch (err) {
      console.warn("Playback failed:", err);
    }
  }

  function pauseB() {
    audioB.pause();
    setPlayingUI(false);
  }

  function setPlayingUI(playing) {
    isPlaying = playing;
    playIcon.style.display = playing ? "none" : "block";
    pauseIcon.style.display = playing ? "block" : "none";
  }

  function nextTrack() {
    if (queue.length === 0) return;
    const next = (currentIndex + 1) % queue.length;
    loadTrack(next);
    playB();
  }

  // ---------- Events ----------
  playBtn.addEventListener("click", () => {
    if (currentIndex === -1 && queue.length > 0) loadTrack(0);
    if (isPlaying) pauseB();
    else playB();
  });

  skipBtn.addEventListener("click", nextTrack);

  audioB.addEventListener("ended", nextTrack);
  audioB.addEventListener("timeupdate", () => {
    if (!audioB.duration) return;
    progressBar.style.width = `${(audioB.currentTime / audioB.duration) * 100}%`;
    trackTime.textContent = `${fmt(audioB.currentTime)} / ${fmt(audioB.duration)}`;
    updateCounterFromTime(audioA.currentTime);
  });
  audioB.addEventListener("play", () => setPlayingUI(true));
  audioB.addEventListener("pause", () => {
    if (audioB.ended) return;
    setPlayingUI(false);
  });

  progressWrap.addEventListener("click", (e) => {
    if (!audioB.duration) return;
    const rect = progressWrap.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioB.currentTime = pct * audioB.duration;
  });

  // Volume sliders
  volA.addEventListener("input", () => {
    userVolA = parseInt(volA.value, 10) / 100;
    volAValue.textContent = volA.value;
    if (gainA) gainA.gain.setTargetAtTime(userVolA, audioCtx.currentTime, 0.02);
  });

  volB.addEventListener("input", () => {
    userVolB = parseInt(volB.value, 10) / 100;
    volBValue.textContent = volB.value;
    if (gainB) {
      const target = isSpeaking ? userVolB * DUCK_LEVEL : userVolB;
      gainB.gain.setTargetAtTime(target, audioCtx.currentTime, 0.02);
    }
  });

  // Drag-and-drop
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-drag");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-drag");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  presetList?.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-preset-index]") : null;
    if (!(target instanceof HTMLElement)) return;
    const presetIndex = Number.parseInt(target.dataset.presetIndex ?? "", 10);
    if (!Number.isFinite(presetIndex)) return;
    addPresetToQueue(presetIndex);
  });

  // Prevent the page from accepting unrelated drops
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  audioA.addEventListener("timeupdate", () => {
    updateCounterFromTime(audioA.currentTime);
  });
  audioA.addEventListener("loadedmetadata", () => {
    buildFallbackCounterTimes();
  });
  audioA.addEventListener("seeked", () => {
    updateCounterFromTime(audioA.currentTime);
  });

  // Clock
  function tickClock() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    clockReadout.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  loadPresetManifest();
  loadCounterTimes().finally(() => {
    updateCounterFromTime(audioA.currentTime || 0);
  });

  // ---------- Helpers ----------
  async function loadCounterTimes() {
    try {
      const response = await fetch("./audio/timetrack-times.txt", { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to fetch timings: ${response.status}`);
      const text = await response.text();
      const parsed = parseCounterTimestamps(text);
      if (parsed.length > 0) {
        counterTimestamps = parsed;
        lastCounterSource = "file";
        counterStep.textContent = "STEP · FILE";
        return;
      }
    } catch (err) {
      console.warn("Using fallback timetrack counter timing:", err);
    }
    buildFallbackCounterTimes();
  }

  function buildFallbackCounterTimes() {
    const duration = Number.isFinite(audioA.duration) ? audioA.duration : 0;
    const upperBound = duration > 0 ? duration : 60 * 60;
    const steps = [];
    for (let t = COUNTER_FALLBACK_STEP_SECONDS; t <= upperBound; t += COUNTER_FALLBACK_STEP_SECONDS) {
      steps.push(t);
    }
    counterTimestamps = steps;
    lastCounterSource = "fallback";
    counterStep.textContent = `STEP · ${COUNTER_FALLBACK_STEP_SECONDS}s`;
  }

  function parseCounterTimestamps(rawText) {
    const out = [];
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split(":").map((part) => part.trim());
      if (parts.length !== 3) continue;
      const h = Number.parseInt(parts[0], 10);
      const m = Number.parseInt(parts[1], 10);
      const s = Number.parseInt(parts[2], 10);
      if (![h, m, s].every(Number.isFinite)) continue;
      const total = h * 3600 + m * 60 + s;
      if (total >= 0) out.push(total);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  function updateCounterFromTime(seconds) {
    const currentTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    if (counterTimestamps.length === 0 && lastCounterSource !== "fallback") {
      buildFallbackCounterTimes();
    }
    let count = 0;
    while (count < counterTimestamps.length && currentTime >= counterTimestamps[count]) {
      count++;
    }
    counterValue = count;
    timeCounterValue.textContent = String(counterValue);
    const nextTime = counterTimestamps[counterValue];
    counterMeta.textContent =
      typeof nextTime === "number" ? `NEXT · ${fmtHMS(nextTime)}` : "NEXT · END OF TRACK";
  }

  function fmt(t) {
    if (!isFinite(t)) return "00:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function fmtHMS(t) {
    if (!isFinite(t)) return "--:--:--";
    const total = Math.floor(Math.max(0, t));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }
})();
