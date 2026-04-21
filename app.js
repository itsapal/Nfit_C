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

  const volA = document.getElementById("volA");
  const volB = document.getElementById("volB");
  const volAValue = document.getElementById("volAValue");
  const volBValue = document.getElementById("volBValue");

  const onAirBadge = document.getElementById("onAirBadge");
  const duckState = document.getElementById("duckState");
  const vadReadout = document.getElementById("vadReadout");
  const visualizer = document.getElementById("visualizer");
  const clockReadout = document.getElementById("clockReadout");

  // ---------- State ----------
  /** @type {{name:string,file:File,url:string}[]} */
  const queue = [];
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
      queue.push({ name: file.name.replace(/\.[^.]+$/, ""), file, url });
      added.push(queue.length - 1);
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
      URL.revokeObjectURL(item.url);
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
      URL.revokeObjectURL(item.url);
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

  // Prevent the page from accepting unrelated drops
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  // Clock
  function tickClock() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    clockReadout.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- Helpers ----------
  function fmt(t) {
    if (!isFinite(t)) return "00:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
