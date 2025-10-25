// main.js - motor sesi için gerçek sample desteği eklenmiş versiyon
// 2D Araba Oyunu - Manuel vites, gaz/fren, motor sesi (sample destekli)
(() => {
  const canvas = document.getElementById('gameCanvas');
  const scoreEl = document.getElementById('score');
  const speedEl = document.getElementById('speed');
  const gearEl = document.getElementById('gear');
  const rpmEl = document.getElementById('rpm');

  const gasBtn = document.getElementById('gasBtn');
  const brakeBtn = document.getElementById('brakeBtn');
  const gearUpBtn = document.getElementById('gearUp');
  const gearDownBtn = document.getElementById('gearDown');
  const soundToggle = document.getElementById('soundToggle');

  const ctx = canvas.getContext('2d');

  let W = 480, H = 800;
  function resize() {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const ratio = W / H;
    let targetW = cssW;
    let targetH = Math.round(cssW / ratio);
    if (targetH > cssH) {
      targetH = cssH;
      targetW = Math.round(cssH * ratio);
    }
    canvas.style.width = targetW + 'px';
    canvas.style.height = targetH + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Road (düz)
  const road = { x: W*0.08, width: W*0.84 };

  // Car state
  const car = {
    x: W/2,
    y: H - 140,
    w: 44, h: 76,
    vx: 0, vy: 0,
    speed: 0, // m/s
    steerSpeed: 160, // px/s lateral
    color: '#00b2ff'
  };

  // Physics & gears
  const maxGear = 9;
  let gear = 1;
  const gearRatios = [0, 4.0, 3.2, 2.6, 2.1, 1.7, 1.4, 1.1, 0.9, 0.7]; // 1..9
  const idleRPM = 800;
  const redline = 7000;

  // Controls
  const input = { gas: false, brake: false, left: false, right: false };
  window.addEventListener('keydown', e => {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') input.gas = true;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') input.brake = true;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') input.left = true;
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') input.right = true;
    if (e.key === 'e' || e.key === 'E') shiftUp();
    if (e.key === 'q' || e.key === 'Q') shiftDown();
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') input.gas = false;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') input.brake = false;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') input.left = false;
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') input.right = false;
  });

  gasBtn.addEventListener('touchstart', e => { e.preventDefault(); input.gas = true; }, {passive:false});
  gasBtn.addEventListener('touchend', e => { e.preventDefault(); input.gas = false; }, {passive:false});
  brakeBtn.addEventListener('touchstart', e => { e.preventDefault(); input.brake = true; }, {passive:false});
  brakeBtn.addEventListener('touchend', e => { e.preventDefault(); input.brake = false; }, {passive:false});

  gearUpBtn.addEventListener('click', shiftUp);
  gearDownBtn.addEventListener('click', shiftDown);

  function shiftUp(){
    if (gear < maxGear) {
      gear++;
      playOneShot('gear_shift');
    }
    updateTelemetry();
  }
  function shiftDown(){
    if (gear > 1) {
      gear--;
      playOneShot('gear_shift');
    }
    updateTelemetry();
  }

  // Audio (sample-based with oscillator fallback)
  let audioCtx = null;
  let buffers = {}; // loaded audio buffers
  let samplesLoaded = false;
  let sampleList = {
    engine_idle: 'assets/engine_idle.wav',
    engine_low: 'assets/engine_low.wav',
    engine_high: 'assets/engine_high.wav',
    gear_shift: 'assets/gear_shift.wav',
    crash: 'assets/crash.wav'
  };

  // Engine loop nodes
  let engineLowSrc = null, engineHighSrc = null;
  let engineLowGain = null, engineHighGain = null;
  let masterGain = null;
  let soundEnabled = true;

  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggle.textContent = soundEnabled ? 'Ses: Aç' : 'Ses: Kapalı';
    if (!soundEnabled) stopEngineSound();
    else startEngineSoundIfNeeded();
  });

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // Load samples (async)
  async function loadSamples() {
    ensureAudio();
    const keys = Object.keys(sampleList);
    try {
      const promises = keys.map(async k => {
        const url = sampleList[k];
        const res = await fetch(url);
        if (!res.ok) throw new Error('Sample not found: ' + url);
        const ab = await res.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(ab);
        buffers[k] = buf;
      });
      await Promise.all(promises);
      samplesLoaded = true;
      console.log('Samples loaded');
    } catch (e) {
      console.warn('Sample loading failed, falling back to oscillator. Error:', e);
      samplesLoaded = false;
    }
  }

  // Start engine sample loops (low/high)
  function startEngineSoundIfNeeded(){
    if (!soundEnabled) return;
    ensureAudio();
    if (engineLowSrc || engineHighSrc) return; // already running

    if (samplesLoaded && buffers.engine_low && buffers.engine_high) {
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(audioCtx.destination);

      // Low layer
      engineLowSrc = audioCtx.createBufferSource();
      engineLowSrc.buffer = buffers.engine_low;
      engineLowSrc.loop = true;
      engineLowGain = audioCtx.createGain();
      engineLowGain.gain.value = 0.0;
      engineLowSrc.connect(engineLowGain);
      engineLowGain.connect(masterGain);
      engineLowSrc.start(0);

      // High layer
      engineHighSrc = audioCtx.createBufferSource();
      engineHighSrc.buffer = buffers.engine_high;
      engineHighSrc.loop = true;
      engineHighGain = audioCtx.createGain();
      engineHighGain.gain.value = 0.0;
      engineHighSrc.connect(engineHighGain);
      engineHighGain.connect(masterGain);
      engineHighSrc.start(0);

      // optionally keep idle buffer under everything if exists
      if (buffers.engine_idle) {
        const idleSrc = audioCtx.createBufferSource();
        idleSrc.buffer = buffers.engine_idle;
        idleSrc.loop = true;
        const idleGain = audioCtx.createGain();
        idleGain.gain.value = 0.06;
        idleSrc.connect(idleGain);
        idleGain.connect(masterGain);
        idleSrc.start(0);
      }
    } else {
      if (!audioCtx) return;
      if (!engineLowSrc) {
        engineLowSrc = audioCtx.createOscillator();
        engineLowGain = audioCtx.createGain();
        engineLowGain.gain.value = 0.0001;
        engineLowSrc.type = 'sawtooth';
        engineLowSrc.connect(engineLowGain);
        engineLowGain.connect(audioCtx.destination);
        engineLowSrc.start();
      }
    }
  }

  function stopEngineSound(){
    try {
      if (engineLowSrc) {
        if (engineLowSrc.stop) engineLowSrc.stop(0);
        engineLowSrc.disconnect && engineLowSrc.disconnect();
      }
      if (engineHighSrc) {
        if (engineHighSrc.stop) engineHighSrc.stop(0);
        engineHighSrc.disconnect && engineHighSrc.disconnect();
      }
      if (engineLowGain) engineLowGain.disconnect && engineLowGain.disconnect();
      if (engineHighGain) engineHighGain.disconnect && engineHighGain.disconnect();
    } catch (e) {}
    engineLowSrc = engineHighSrc = null;
    engineLowGain = engineHighGain = null;
    masterGain = null;
  }

  function playOneShot(name) {
    ensureAudio();
    if (!soundEnabled) return;
    if (samplesLoaded && buffers[name]) {
      const s = audioCtx.createBufferSource();
      s.buffer = buffers[name];
      const g = audioCtx.createGain();
      g.gain.value = 0.9;
      s.connect(g); g.connect(audioCtx.destination);
      s.start(0);
      setTimeout(()=>{ try { s.stop(); s.disconnect(); g.disconnect(); } catch(e){} }, (s.buffer.duration+0.2)*1000);
    } else {
      const o = audioCtx.createOscillator();
      const gg = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.value = 200;
      gg.gain.value = 0.01;
      o.connect(gg); gg.connect(audioCtx.destination);
      o.start();
      gg.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
      setTimeout(()=>{ try { o.stop(); o.disconnect(); gg.disconnect(); } catch(e){} }, 500);
    }
  }

  function updateEngineSound(rpm) {
    if (!soundEnabled) return;
    startEngineSoundIfNeeded();
    const norm = Math.max(0, Math.min(1, (rpm - idleRPM) / (redline - idleRPM)));
    if (samplesLoaded && engineLowSrc && engineHighSrc && engineLowGain && engineHighGain) {
      const lowGainTarget = Math.max(0.0, 1.0 - norm * 1.4);
      const highGainTarget = Math.max(0.0, norm * 1.2);
      engineLowGain.gain.linearRampToValueAtTime(lowGainTarget, audioCtx.currentTime + 0.05);
      engineHighGain.gain.linearRampToValueAtTime(highGainTarget, audioCtx.currentTime + 0.05);
      try {
        engineLowSrc.playbackRate.setTargetAtTime(0.8 + norm * 0.9, audioCtx.currentTime, 0.02);
        engineHighSrc.playbackRate.setTargetAtTime(0.9 + norm * 1.3, audioCtx.currentTime, 0.02);
      } catch (e) {
        try {
          engineLowSrc.playbackRate.value = 0.8 + norm * 0.9;
          engineHighSrc.playbackRate.value = 0.9 + norm * 1.3;
        } catch (e2) {}
      }
    } else if (engineLowSrc && engineLowGain) {
      try {
        const minFreq = 80;
        const maxFreq = 1200;
        const freq = minFreq + norm*(maxFreq - minFreq);
        engineLowSrc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.02);
        engineLowGain.gain.setTargetAtTime(0.04 + 0.08*norm, audioCtx.currentTime, 0.05);
      } catch (e) {}
    }
  }

  // Try to load samples on start
  try {
    loadSamples();
  } catch (e) { console.warn('loadSamples error', e); }

  // Obstacles, scoring, physics
  let obstacles = [];
  let spawnTimer = 0;
  let spawnInterval = 1.2;
  let score = 0;
  let lastTime = performance.now();
  let gameOver = false;

  function spawnObstacle(){
    const w = 40 + Math.random()*80;
    const h = 20 + Math.random()*30;
    const laneX = road.x + Math.random() * (road.width - w);
    const y = -h - 10;
    const speed = 100 + Math.random()*120 + score*0.6;
    obstacles.push({ x: laneX, y, w, h, speed, color: '#ff6b6b' });
  }

  function intersects(a,b){
    return !(a.x + a.w < b.x || b.x +
