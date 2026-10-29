'use strict';

const fs   = require('fs');
const path = require('path');
const PRESETS_FILE = path.join(__dirname, 'presets.json');

// ─── State ───────────────────────────────────────────────────────────────────
let ctx = null, source = null, stream = null;
const n = {};
const state = {
  compressor:false, overdrive:false, distortion:false, chorus:false,
  phaser:false, delay:false, reverb:false, tremolo:false, eq:false,
};

const ampState = { gain:5, volume:6, presence:5, bass:5, mid:5, treble:5 };
let currentChannel = 'clean';
let currentModel   = 'fender';

// ─── Amp models ──────────────────────────────────────────────────────────────
const AMP_MODELS = {
  fender:   { gain:3, volume:6, presence:4, bass:6, mid:4, treble:6 },
  marshall: { gain:7, volume:7, presence:7, bass:5, mid:7, treble:7 },
  mesa:     { gain:8, volume:7, presence:8, bass:3, mid:2, treble:7 },
  vox:      { gain:5, volume:6, presence:6, bass:4, mid:5, treble:8 },
  tweed:    { gain:4, volume:6, presence:3, bass:7, mid:6, treble:5 },
};

const CHANNEL_GAIN = { clean: 0.3, crunch: 0.65, lead: 1.0 };

// ─── Genre presets ────────────────────────────────────────────────────────────
const GENRES = {
  clean:   { compressor:{on:false}, overdrive:{on:false}, distortion:{on:false}, chorus:{on:false}, phaser:{on:false}, delay:{on:false}, reverb:{on:true,room:0.3,decay:0.3,mix:0.15}, tremolo:{on:false}, eq:{on:false} },
  rock:    { compressor:{on:true,threshold:-24,ratio:4}, overdrive:{on:false}, distortion:{on:true,drive:0.55,tone:3500,level:0.75}, chorus:{on:false}, phaser:{on:false}, delay:{on:true,time:0.25,feedback:0.3,mix:0.4}, reverb:{on:true,room:0.4,decay:0.4,mix:0.25}, tremolo:{on:false}, eq:{on:true,bass:3,mid:2,treble:1} },
  metal:   { compressor:{on:true,threshold:-30,ratio:8}, overdrive:{on:false}, distortion:{on:true,drive:0.9,tone:2500,level:0.8}, chorus:{on:false}, phaser:{on:false}, delay:{on:true,time:0.15,feedback:0.15,mix:0.2}, reverb:{on:false}, tremolo:{on:false}, eq:{on:true,bass:5,mid:-4,treble:3} },
  blues:   { compressor:{on:true,threshold:-20,ratio:3}, overdrive:{on:true,drive:0.4,tone:4000,level:0.8}, distortion:{on:false}, chorus:{on:false}, phaser:{on:false}, delay:{on:true,time:0.4,feedback:0.4,mix:0.45}, reverb:{on:true,room:0.65,decay:0.55,mix:0.35}, tremolo:{on:false}, eq:{on:true,bass:4,mid:3,treble:-1} },
  jazz:    { compressor:{on:true,threshold:-18,ratio:3}, overdrive:{on:false}, distortion:{on:false}, chorus:{on:true,rate:0.8,depth:0.35,mix:0.3}, phaser:{on:false}, delay:{on:false}, reverb:{on:true,room:0.3,decay:0.3,mix:0.2}, tremolo:{on:false}, eq:{on:true,bass:3,mid:0,treble:-4} },
  funk:    { compressor:{on:true,threshold:-26,ratio:6}, overdrive:{on:false}, distortion:{on:false}, chorus:{on:false}, phaser:{on:true,rate:2,depth:0.6,mix:0.5}, delay:{on:false}, reverb:{on:false}, tremolo:{on:false}, eq:{on:true,bass:2,mid:-3,treble:3} },
  pop:     { compressor:{on:true,threshold:-20,ratio:4}, overdrive:{on:false}, distortion:{on:false}, chorus:{on:true,rate:1.5,depth:0.5,mix:0.4}, phaser:{on:false}, delay:{on:true,time:0.3,feedback:0.25,mix:0.3}, reverb:{on:true,room:0.5,decay:0.45,mix:0.3}, tremolo:{on:false}, eq:{on:true,bass:1,mid:0,treble:2} },
  country: { compressor:{on:true,threshold:-22,ratio:3}, overdrive:{on:true,drive:0.2,tone:5500,level:0.75}, distortion:{on:false}, chorus:{on:false}, phaser:{on:false}, delay:{on:true,time:0.18,feedback:0.12,mix:0.3}, reverb:{on:true,room:0.35,decay:0.3,mix:0.2}, tremolo:{on:true,rate:4,depth:0.45}, eq:{on:true,bass:0,mid:0,treble:4} },
  reggae:  { compressor:{on:true,threshold:-20,ratio:4}, overdrive:{on:false}, distortion:{on:false}, chorus:{on:true,rate:0.5,depth:0.3,mix:0.25}, phaser:{on:false}, delay:{on:true,time:0.65,feedback:0.5,mix:0.55}, reverb:{on:true,room:0.5,decay:0.5,mix:0.3}, tremolo:{on:false}, eq:{on:true,bass:6,mid:-2,treble:-2} },
};

const SLIDER_MAP = {
  compressor: {'comp-threshold':'threshold','comp-ratio':'ratio'},
  overdrive:  {'od-drive':'drive','od-tone':'tone','od-level':'level'},
  distortion: {'dist-drive':'drive','dist-tone':'tone','dist-level':'level'},
  chorus:     {'chorus-rate':'rate','chorus-depth':'depth','chorus-mix':'mix'},
  phaser:     {'phaser-rate':'rate','phaser-depth':'depth','phaser-mix':'mix'},
  delay:      {'delay-time':'time','delay-feedback':'feedback','delay-mix':'mix'},
  reverb:     {'reverb-room':'room','reverb-decay':'decay','reverb-mix':'mix'},
  tremolo:    {'tremolo-rate':'rate','tremolo-depth':'depth'},
  eq:         {'eq-bass':'bass','eq-mid':'mid','eq-treble':'treble'},
};

// ─── Oscilloscope ─────────────────────────────────────────────────────────────
let animId = null;

function startDisplays() {
  if (animId) cancelAnimationFrame(animId);
  const osc  = document.getElementById('oscilloscope');
  const vu   = document.getElementById('vu-meter');
  const oc   = osc.getContext('2d');
  const vc   = vu.getContext('2d');
  const W = osc.width, H = osc.height;
  const VW = vu.width, VH = vu.height;

  function draw() {
    animId = requestAnimationFrame(draw);

    // ── Oscilloscope ──
    oc.fillStyle = 'rgba(7,9,14,0.85)';
    oc.fillRect(0, 0, W, H);
    // grid
    oc.strokeStyle = 'rgba(0,255,136,0.06)';
    oc.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      oc.beginPath(); oc.moveTo(0, H*i/4); oc.lineTo(W, H*i/4); oc.stroke();
    }
    for (let i = 1; i < 6; i++) {
      oc.beginPath(); oc.moveTo(W*i/6, 0); oc.lineTo(W*i/6, H); oc.stroke();
    }

    if (n.analyser) {
      const buf = new Float32Array(n.analyser.fftSize);
      n.analyser.getFloatTimeDomainData(buf);
      oc.lineWidth = 1.5;
      oc.strokeStyle = '#00ff88';
      oc.shadowColor  = '#00ff88';
      oc.shadowBlur   = 5;
      oc.beginPath();
      const step = W / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const x = i * step;
        const y = (0.5 - buf[i] * 0.45) * H;
        i === 0 ? oc.moveTo(x, y) : oc.lineTo(x, y);
      }
      oc.stroke();
      oc.shadowBlur = 0;
    } else {
      // idle flatline
      oc.lineWidth = 1;
      oc.strokeStyle = 'rgba(0,255,136,0.25)';
      oc.beginPath(); oc.moveTo(0, H/2); oc.lineTo(W, H/2); oc.stroke();
    }

    // ── VU Meter ──
    vc.fillStyle = '#07090e';
    vc.fillRect(0, 0, VW, VH);

    let level = 0;
    if (n.analyser) {
      const d = new Float32Array(n.analyser.fftSize);
      n.analyser.getFloatTimeDomainData(d);
      const rms = Math.sqrt(d.reduce((s, v) => s + v*v, 0) / d.length);
      level = Math.min(1, rms * 6);
    }

    const barH = level * VH;
    const grad = vc.createLinearGradient(0, VH, 0, 0);
    grad.addColorStop(0,   '#00ff88');
    grad.addColorStop(0.6, '#ffff00');
    grad.addColorStop(1,   '#ff3333');
    vc.fillStyle = grad;
    vc.fillRect(0, VH - barH, VW, barH);
    if (level > 0.05) {
      vc.shadowColor = level > 0.7 ? '#ff3333' : '#00ff88';
      vc.shadowBlur = 6;
      vc.fillRect(0, VH - barH, VW, barH);
      vc.shadowBlur = 0;
    }
  }
  draw();
}

// ─── DOMContentLoaded ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // enumerate audio devices
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inSel = document.getElementById('input-device');
    const outSel = document.getElementById('output-device');
    for (const d of devices) {
      const label = d.label || `${d.kind} (${d.deviceId.slice(0,8)})`;
      if (d.kind === 'audioinput')  inSel.appendChild(new Option(label, d.deviceId));
      if (d.kind === 'audiooutput') outSel.appendChild(new Option(label, d.deviceId));
    }
  } catch(e) { setStatus('Permission refusée: ' + e.message); }

  // init rotary knobs
  document.querySelectorAll('.amp-knob-wrap').forEach(wrap => {
    const param = wrap.dataset.param;
    const min   = +wrap.dataset.min;
    const max   = +wrap.dataset.max;
    const def   = +wrap.dataset.default;
    const dial  = document.getElementById('dial-' + param);
    const valEl = document.getElementById('kv-' + param);

    let startY, startVal, dragging = false;

    function setVal(v) {
      ampState[param] = Math.max(min, Math.min(max, v));
      const pct = (ampState[param] - min) / (max - min);
      dial.style.transform = `rotate(${-135 + pct * 270}deg)`;
      // update conic ring fill
      wrap.querySelector('.knob-ring').style.setProperty('--fill', (pct * 270) + 'deg');
      valEl.textContent = ampState[param].toFixed(1);
      applyAmpSettings();
    }

    wrap.addEventListener('pointerdown', e => {
      dragging = true; startY = e.clientY; startVal = ampState[param];
      wrap.setPointerCapture(e.pointerId); e.preventDefault();
    });
    wrap.addEventListener('pointermove', e => {
      if (!dragging) return;
      setVal(startVal + (startY - e.clientY) * (max - min) / 140);
    });
    wrap.addEventListener('pointerup', () => { dragging = false; });
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      setVal(ampState[param] - Math.sign(e.deltaY) * (max - min) / 20);
    }, { passive: false });

    setVal(def);
  });

  updateAll();
  startDisplays();
  refreshPresetSelect();

  el('ai-prompt').addEventListener('keydown', e => { if (e.key === 'Enter') aiSuggest(); });
});

// ─── Connect / Disconnect ────────────────────────────────────────────────────
async function toggleConnect() {
  const btn = document.getElementById('connect-btn');
  if (ctx) {
    stream?.getTracks().forEach(t => t.stop());
    await ctx.close();
    ctx = source = stream = null;
    document.getElementById('power-led').classList.remove('on');
    btn.textContent = 'CONNECT'; btn.classList.remove('active');
    setStatus('Déconnecté'); return;
  }
  try {
    const inputId  = document.getElementById('input-device').value;
    const outputId = document.getElementById('output-device').value;
    ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
    if (ctx.setSinkId && outputId) await ctx.setSinkId(outputId).catch(() => {});
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: inputId ? { exact: inputId } : undefined,
               echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    await ctx.resume();
    source = ctx.createMediaStreamSource(stream);
    buildChain();
    document.getElementById('power-led').classList.add('on');
    btn.textContent = 'DISCONNECT'; btn.classList.add('active');
    setStatus(`Actif · ${ctx.sampleRate} Hz · latence ≈ ${Math.round(ctx.baseLatency * 1000)} ms`);
  } catch(e) {
    if (ctx) { await ctx.close(); ctx = null; }
    setStatus('Erreur : ' + e.message);
  }
}

// ─── Build audio chain ────────────────────────────────────────────────────────
// Source → AmpSection → Comp → OD → Dist → Chorus → Phaser → Delay → Reverb → Tremolo → EQ → Master → Analyser → Out

function g(v = 1) { const x = ctx.createGain(); x.gain.value = v; return x; }
function bqf(type, freq, Q, gainVal) {
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  if (Q !== null) f.Q.value = Q; f.gain.value = gainVal; return f;
}

function buildChain() {
  n.in = g();

  // ── AMP SECTION ──────────────────────────────────────────────────────────
  n.ampPreGain  = g(0.6);
  n.ampBass     = bqf('lowshelf',   200,  null, 0);
  n.ampMid      = bqf('peaking',    500,  1,    0);
  n.ampTreble   = bqf('highshelf', 3000,  null, 0);
  n.ampPresence = bqf('highshelf', 6500,  null, 0);
  n.in.connect(n.ampPreGain);
  n.ampPreGain.connect(n.ampBass); n.ampBass.connect(n.ampMid);
  n.ampMid.connect(n.ampTreble);  n.ampTreble.connect(n.ampPresence);
  let prev = n.ampPresence;

  // ── 1. COMPRESSEUR ───────────────────────────────────────────────────────
  n.compDry = g(1); n.compWet = g(0);
  n.compNode = ctx.createDynamicsCompressor();
  n.compNode.attack.value = 0.003; n.compNode.release.value = 0.25; n.compNode.knee.value = 10;
  n.compOut = g();
  prev.connect(n.compDry); n.compDry.connect(n.compOut);
  prev.connect(n.compWet); n.compWet.connect(n.compNode); n.compNode.connect(n.compOut);
  prev = n.compOut;

  // ── 2. OVERDRIVE (tanh soft clip) ────────────────────────────────────────
  n.odDry = g(1); n.odWet = g(0);
  n.odShape = ctx.createWaveShaper(); n.odShape.oversample = '2x';
  n.odTone  = bqf('lowpass', 5000, 0.7, 0);
  n.odLevel = g(0.8); n.odOut = g();
  prev.connect(n.odDry);  n.odDry.connect(n.odOut);
  prev.connect(n.odWet);  n.odWet.connect(n.odShape);
  n.odShape.connect(n.odTone); n.odTone.connect(n.odLevel); n.odLevel.connect(n.odOut);
  prev = n.odOut;

  // ── 3. DISTORSION (hard clip) ────────────────────────────────────────────
  n.dstDry = g(1); n.dstWet = g(0);
  n.dstShape = ctx.createWaveShaper(); n.dstShape.oversample = '4x';
  n.dstTone  = bqf('lowpass', 3000, 0.7, 0);
  n.dstLevel = g(0.7); n.dstOut = g();
  prev.connect(n.dstDry);  n.dstDry.connect(n.dstOut);
  prev.connect(n.dstWet);  n.dstWet.connect(n.dstShape);
  n.dstShape.connect(n.dstTone); n.dstTone.connect(n.dstLevel); n.dstLevel.connect(n.dstOut);
  prev = n.dstOut;

  // ── 4. CHORUS ────────────────────────────────────────────────────────────
  n.chorLFO = ctx.createOscillator(); n.chorLFO.type = 'sine'; n.chorLFO.frequency.value = 1.5;
  n.chorDepth = g(0.003);
  n.chorDelay = ctx.createDelay(0.1); n.chorDelay.delayTime.value = 0.025;
  n.chorWet = g(0); n.chorOut = g();
  n.chorLFO.connect(n.chorDepth); n.chorDepth.connect(n.chorDelay.delayTime); n.chorLFO.start();
  prev.connect(n.chorOut);
  prev.connect(n.chorDelay); n.chorDelay.connect(n.chorWet); n.chorWet.connect(n.chorOut);
  prev = n.chorOut;

  // ── 5. PHASER (4 allpass stages + LFO) ───────────────────────────────────
  n.phasLFO   = ctx.createOscillator(); n.phasLFO.type = 'sine'; n.phasLFO.frequency.value = 0.5;
  n.phasDepth = g(400);
  n.phasAP    = [800, 1600, 3200, 6400].map(f => {
    const ap = ctx.createBiquadFilter(); ap.type = 'allpass';
    ap.frequency.value = f; ap.Q.value = 0.5; return ap;
  });
  n.phasWet = g(0); n.phasOut = g();
  n.phasLFO.connect(n.phasDepth);
  n.phasAP.forEach(ap => n.phasDepth.connect(ap.frequency));
  for (let i = 0; i < n.phasAP.length - 1; i++) n.phasAP[i].connect(n.phasAP[i + 1]);
  n.phasLFO.start();
  prev.connect(n.phasOut);
  prev.connect(n.phasAP[0]);
  n.phasAP[n.phasAP.length - 1].connect(n.phasWet); n.phasWet.connect(n.phasOut);
  prev = n.phasOut;

  // ── 6. DELAY ─────────────────────────────────────────────────────────────
  n.dlNode = ctx.createDelay(2.0); n.dlFb = g(0); n.dlMix = g(0); n.dlOut = g();
  prev.connect(n.dlOut);
  prev.connect(n.dlNode); n.dlNode.connect(n.dlFb); n.dlFb.connect(n.dlNode);
  n.dlNode.connect(n.dlMix); n.dlMix.connect(n.dlOut);
  prev = n.dlOut;

  // ── 7. REVERB ────────────────────────────────────────────────────────────
  n.rvConv = ctx.createConvolver(); n.rvConv.buffer = makeIR(2, 0.5);
  n.rvWet = g(0); n.rvOut = g();
  prev.connect(n.rvOut);
  prev.connect(n.rvConv); n.rvConv.connect(n.rvWet); n.rvWet.connect(n.rvOut);
  prev = n.rvOut;

  // ── 8. TREMOLO ───────────────────────────────────────────────────────────
  n.tremLFO = ctx.createOscillator(); n.tremLFO.type = 'sine'; n.tremLFO.frequency.value = 5;
  n.tremDepth = g(0); n.tremGain = g(1);
  n.tremLFO.connect(n.tremDepth); n.tremDepth.connect(n.tremGain.gain); n.tremLFO.start();
  prev.connect(n.tremGain); prev = n.tremGain;

  // ── 9. EQ ────────────────────────────────────────────────────────────────
  n.eqBass = bqf('lowshelf', 200, null, 0);
  n.eqMid  = bqf('peaking', 1000, 1,   0);
  n.eqHigh = bqf('highshelf', 4000, null, 0);
  prev.connect(n.eqBass); n.eqBass.connect(n.eqMid); n.eqMid.connect(n.eqHigh);
  prev = n.eqHigh;

  // ── OUTPUT ───────────────────────────────────────────────────────────────
  n.ampMaster = g(0.6);
  n.analyser  = ctx.createAnalyser(); n.analyser.fftSize = 1024;
  prev.connect(n.ampMaster); n.ampMaster.connect(n.analyser); n.analyser.connect(ctx.destination);

  source.connect(n.in);
  applyAmpSettings();
  updateAll();
  Object.keys(state).forEach(syncEffect);
}

// ─── Amp section ─────────────────────────────────────────────────────────────
function applyAmpSettings() {
  if (!ctx) return;
  const chMult = CHANNEL_GAIN[currentChannel] ?? 0.3;
  if (n.ampPreGain)  n.ampPreGain.gain.value  = (ampState.gain / 10) * chMult * 2 + 0.01;
  if (n.ampMaster)   n.ampMaster.gain.value   = ampState.volume / 10;
  if (n.ampBass)     n.ampBass.gain.value     = (ampState.bass - 5) * 2.5;
  if (n.ampMid)      n.ampMid.gain.value      = (ampState.mid - 5) * 2;
  if (n.ampTreble)   n.ampTreble.gain.value   = (ampState.treble - 5) * 2;
  if (n.ampPresence) n.ampPresence.gain.value = (ampState.presence - 5) * 1.5;
}

function setAmpModel(model) {
  currentModel = model;
  document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('model-' + model).classList.add('active');
  const s = AMP_MODELS[model]; if (!s) return;
  document.querySelectorAll('.amp-knob-wrap').forEach(wrap => {
    const p = wrap.dataset.param; if (!(p in s)) return;
    const min = +wrap.dataset.min, max = +wrap.dataset.max;
    const pct = (s[p] - min) / (max - min);
    document.getElementById('dial-' + p).style.transform = `rotate(${-135 + pct * 270}deg)`;
    wrap.querySelector('.knob-ring').style.setProperty('--fill', (pct * 270) + 'deg');
    document.getElementById('kv-' + p).textContent = s[p].toFixed(1);
    ampState[p] = s[p];
  });
  applyAmpSettings();
}

function setChannel(ch) {
  currentChannel = ch;
  document.querySelectorAll('.ch-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('ch-' + ch).classList.add('active');
  applyAmpSettings();
}

// ─── IR generation (Reverb) ──────────────────────────────────────────────────
function makeIR(dur, decay) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 10);
  }
  return buf;
}

// ─── Distortion curves ────────────────────────────────────────────────────────
function makeDistCurve(drive) {
  const c = new Float32Array(512), k = drive * 300 + 1;
  for (let i = 0; i < 512; i++) {
    const x = (i * 2) / 512 - 1;
    c[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
  }
  return c;
}
function makeODCurve(drive) {
  const c = new Float32Array(512), k = drive * 5 + 0.1;
  for (let i = 0; i < 512; i++) {
    const x = (i * 2) / 512 - 1;
    c[i] = Math.tanh(x * k * 3) * 0.85;
  }
  return c;
}

// ─── Sync audio nodes ────────────────────────────────────────────────────────
function syncEffect(name) {
  if (!ctx) return;
  const on = state[name];
  switch(name) {
    case 'compressor':
      n.compDry.gain.value = on ? 0 : 1; n.compWet.gain.value = on ? 1 : 0; break;
    case 'overdrive':
      n.odDry.gain.value = on ? 0 : 1; n.odWet.gain.value = on ? 1 : 0;
      n.odLevel.gain.value = on ? +el('od-level').value : 1; break;
    case 'distortion':
      n.dstDry.gain.value = on ? 0 : 1; n.dstWet.gain.value = on ? 1 : 0;
      n.dstLevel.gain.value = on ? +el('dist-level').value : 1; break;
    case 'chorus':
      n.chorWet.gain.value = on ? +el('chorus-mix').value : 0; break;
    case 'phaser':
      n.phasWet.gain.value = on ? +el('phaser-mix').value * 0.5 : 0; break;
    case 'delay':
      n.dlFb.gain.value = on ? +el('delay-feedback').value : 0;
      n.dlMix.gain.value = on ? +el('delay-mix').value : 0; break;
    case 'reverb':
      n.rvWet.gain.value = on ? +el('reverb-mix').value : 0; break;
    case 'tremolo':
      n.tremDepth.gain.value = on ? +el('tremolo-depth').value * 0.5 : 0; break;
    case 'eq':
      n.eqBass.gain.value = on ? +el('eq-bass').value : 0;
      n.eqMid.gain.value  = on ? +el('eq-mid').value  : 0;
      n.eqHigh.gain.value = on ? +el('eq-treble').value : 0; break;
  }
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function toggleEffect(name) {
  state[name] = !state[name];
  el(name + '-toggle').textContent = state[name] ? 'ON' : 'OFF';
  el(name + '-toggle').classList.toggle('on', state[name]);
  el('pedal-' + name).classList.toggle('active', state[name]);
  syncEffect(name);
}

// ─── Apply genre preset ───────────────────────────────────────────────────────
function applyGenre(key) {
  const preset = GENRES[key]; if (!preset) return;
  document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
  el('genre-' + key).classList.add('active');
  for (const [name, settings] of Object.entries(preset)) {
    state[name] = settings.on;
    el(name + '-toggle').textContent = settings.on ? 'ON' : 'OFF';
    el(name + '-toggle').classList.toggle('on', settings.on);
    el('pedal-' + name).classList.toggle('active', settings.on);
    if (settings.on) {
      for (const [sid, param] of Object.entries(SLIDER_MAP[name] || {})) {
        if (settings[param] !== undefined) el(sid).value = settings[param];
      }
    }
  }
  updateAll();
  if (ctx) Object.keys(state).forEach(syncEffect);
}

// ─── Update parameter display + audio nodes ───────────────────────────────────
function updateCompressor() {
  const t = +el('comp-threshold').value, r = +el('comp-ratio').value;
  if (n.compNode) { n.compNode.threshold.value = t; n.compNode.ratio.value = r; }
  setText('comp-threshold-val', t + ' dB'); setText('comp-ratio-val', r.toFixed(1) + ':1');
}
function updateOverdrive() {
  const drive = +el('od-drive').value, tone = +el('od-tone').value, level = +el('od-level').value;
  if (n.odShape) n.odShape.curve = makeODCurve(drive);
  if (n.odTone)  n.odTone.frequency.value = tone;
  if (n.odLevel && state.overdrive) n.odLevel.gain.value = level;
  setText('od-drive-val', Math.round(drive*100)+'%'); setText('od-tone-val', Math.round(tone)+' Hz'); setText('od-level-val', Math.round(level*100)+'%');
}
function updateDistortion() {
  const drive = +el('dist-drive').value, tone = +el('dist-tone').value, level = +el('dist-level').value;
  if (n.dstShape) n.dstShape.curve = makeDistCurve(drive);
  if (n.dstTone)  n.dstTone.frequency.value = tone;
  if (n.dstLevel && state.distortion) n.dstLevel.gain.value = level;
  setText('dist-drive-val', Math.round(drive*100)+'%'); setText('dist-tone-val', Math.round(tone)+' Hz'); setText('dist-level-val', Math.round(level*100)+'%');
}
function updateChorus() {
  const rate = +el('chorus-rate').value, depth = +el('chorus-depth').value, mix = +el('chorus-mix').value;
  if (n.chorLFO) n.chorLFO.frequency.value = rate;
  if (n.chorDepth) n.chorDepth.gain.value = depth * 0.005;
  if (n.chorWet && state.chorus) n.chorWet.gain.value = mix;
  setText('chorus-rate-val', rate.toFixed(1)+' Hz'); setText('chorus-depth-val', Math.round(depth*100)+'%'); setText('chorus-mix-val', Math.round(mix*100)+'%');
}
function updatePhaser() {
  const rate = +el('phaser-rate').value, depth = +el('phaser-depth').value, mix = +el('phaser-mix').value;
  if (n.phasLFO) n.phasLFO.frequency.value = rate;
  if (n.phasDepth) n.phasDepth.gain.value = depth * 500;
  if (n.phasWet && state.phaser) n.phasWet.gain.value = mix * 0.5;
  setText('phaser-rate-val', rate.toFixed(1)+' Hz'); setText('phaser-depth-val', Math.round(depth*100)+'%'); setText('phaser-mix-val', Math.round(mix*100)+'%');
}
function updateDelay() {
  const time = +el('delay-time').value, fb = +el('delay-feedback').value, mix = +el('delay-mix').value;
  if (n.dlNode) n.dlNode.delayTime.value = time;
  if (state.delay) { if (n.dlFb) n.dlFb.gain.value = fb; if (n.dlMix) n.dlMix.gain.value = mix; }
  setText('delay-time-val', Math.round(time*1000)+' ms'); setText('delay-feedback-val', Math.round(fb*100)+'%'); setText('delay-mix-val', Math.round(mix*100)+'%');
}
function updateReverb() {
  const room = +el('reverb-room').value, decay = +el('reverb-decay').value, mix = +el('reverb-mix').value;
  if (ctx && n.rvConv) n.rvConv.buffer = makeIR(room * 3.5 + 0.5, decay);
  if (state.reverb && n.rvWet) n.rvWet.gain.value = mix;
  setText('reverb-room-val', Math.round(room*100)+'%'); setText('reverb-decay-val', Math.round(decay*100)+'%'); setText('reverb-mix-val', Math.round(mix*100)+'%');
}
function updateTremolo() {
  const rate = +el('tremolo-rate').value, depth = +el('tremolo-depth').value;
  if (n.tremLFO) n.tremLFO.frequency.value = rate;
  if (state.tremolo && n.tremDepth) n.tremDepth.gain.value = depth * 0.5;
  setText('tremolo-rate-val', rate.toFixed(1)+' Hz'); setText('tremolo-depth-val', Math.round(depth*100)+'%');
}
function updateEQ() {
  const bass = +el('eq-bass').value, mid = +el('eq-mid').value, treble = +el('eq-treble').value;
  if (state.eq) { if (n.eqBass) n.eqBass.gain.value = bass; if (n.eqMid) n.eqMid.gain.value = mid; if (n.eqHigh) n.eqHigh.gain.value = treble; }
  const f = v => (v>=0?'+':'')+Math.round(v)+' dB';
  setText('eq-bass-val', f(bass)); setText('eq-mid-val', f(mid)); setText('eq-treble-val', f(treble));
}
function updateAll() {
  updateCompressor(); updateOverdrive(); updateDistortion(); updateChorus();
  updatePhaser(); updateDelay(); updateReverb(); updateTremolo(); updateEQ();
}

const el      = id => document.getElementById(id);
const setText = (id, t) => { const e = el(id); if (e) e.textContent = t; };
const setStatus = m => setText('status', m);

// ─── Preset storage ───────────────────────────────────────────────────────────
function _readPresets() {
  try {
    if (!fs.existsSync(PRESETS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')).presets || [];
  } catch { return []; }
}

function _writePresets(presets) {
  fs.writeFileSync(PRESETS_FILE, JSON.stringify({ presets }, null, 2), 'utf8');
}

function refreshPresetSelect() {
  const sel = el('preset-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— sélectionner —</option>';
  _readPresets().forEach(p => {
    const opt = new Option(p.name, p.id);
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

function _captureState() {
  const effects = {};
  for (const [name, sliders] of Object.entries(SLIDER_MAP)) {
    effects[name] = { on: state[name] };
    for (const [sid, param] of Object.entries(sliders)) {
      effects[name][param] = +el(sid).value;
    }
  }
  return {
    id: Date.now().toString(),
    ampModel: currentModel,
    channel: currentChannel,
    amp: { ...ampState },
    effects,
  };
}

function savePreset() {
  const nameEl = el('preset-name');
  const name = nameEl.value.trim();
  if (!name) {
    nameEl.focus();
    nameEl.classList.add('error');
    setTimeout(() => nameEl.classList.remove('error'), 1200);
    return;
  }
  const presets = _readPresets();
  const data = { ..._captureState(), name };
  presets.push(data);
  _writePresets(presets);
  refreshPresetSelect();
  el('preset-select').value = data.id;
  nameEl.value = '';
  const btn = el('preset-save-btn');
  btn.textContent = 'SAVED'; btn.classList.add('preset-flash-ok');
  setTimeout(() => { btn.textContent = 'SAVE'; btn.classList.remove('preset-flash-ok'); }, 900);
}

function _applyPresetData(p) {
  if (p.ampModel) setAmpModel(p.ampModel);
  if (p.channel)  setChannel(p.channel);
  if (p.amp) {
    document.querySelectorAll('.amp-knob-wrap').forEach(wrap => {
      const param = wrap.dataset.param;
      if (!(param in p.amp)) return;
      const v = p.amp[param];
      const min = +wrap.dataset.min, max = +wrap.dataset.max;
      const pct = (v - min) / (max - min);
      document.getElementById('dial-' + param).style.transform = `rotate(${-135 + pct * 270}deg)`;
      wrap.querySelector('.knob-ring').style.setProperty('--fill', (pct * 270) + 'deg');
      document.getElementById('kv-' + param).textContent = v.toFixed(1);
      ampState[param] = v;
    });
    applyAmpSettings();
  }
  for (const [name, settings] of Object.entries(p.effects || {})) {
    state[name] = settings.on;
    el(name + '-toggle').textContent = settings.on ? 'ON' : 'OFF';
    el(name + '-toggle').classList.toggle('on', settings.on);
    el('pedal-' + name).classList.toggle('active', settings.on);
    for (const [sid, param] of Object.entries(SLIDER_MAP[name] || {})) {
      if (settings[param] !== undefined) el(sid).value = settings[param];
    }
  }
  updateAll();
  if (ctx) Object.keys(state).forEach(syncEffect);
}

function loadPreset() {
  const id = el('preset-select').value;
  if (!id) return;
  const p = _readPresets().find(x => x.id === id);
  if (!p) return;
  _applyPresetData(p);
  const btn = el('preset-load-btn');
  btn.textContent = 'LOADED'; btn.classList.add('preset-flash-ok');
  setTimeout(() => { btn.textContent = 'LOAD'; btn.classList.remove('preset-flash-ok'); }, 900);
}

function deletePreset() {
  const id = el('preset-select').value;
  if (!id) return;
  _writePresets(_readPresets().filter(p => p.id !== id));
  refreshPresetSelect();
}

// ─── AI Panel ─────────────────────────────────────────────────────────────────
const AI_URL = 'http://127.0.0.1:5174';
let aiPanelOpen = false;
let aiModelsLoaded = false;

function toggleAIPanel() {
  aiPanelOpen = !aiPanelOpen;
  el('ai-panel').classList.toggle('open', aiPanelOpen);
  el('ai-toggle-btn').classList.toggle('active', aiPanelOpen);
  if (aiPanelOpen) {
    if (!aiModelsLoaded) { aiLoadModels(); aiModelsLoaded = true; }
    setTimeout(() => el('ai-prompt').focus(), 280);
  }
}

async function aiLoadModels() {
  const sel = el('ai-model-sel');
  const prev = sel.value;
  try {
    const res = await fetch(`${AI_URL}/models`);
    const { models } = await res.json();
    sel.innerHTML = '';
    (models || []).forEach(m => {
      const label = m.size_gb ? `${m.name}  (${m.size_gb} GB)` : m.name;
      sel.appendChild(new Option(label, m.name));
    });
    if (!sel.options.length) sel.appendChild(new Option('llama3.2', 'llama3.2'));
    if (prev) sel.value = prev;
  } catch {
    sel.innerHTML = '<option value="llama3.2">llama3.2</option>';
  }
}

function _presetSummary(p) {
  if (!p) return '';
  const parts = [];
  if (p.ampModel && p.channel)
    parts.push(`${p.ampModel.toUpperCase()}  ·  ${p.channel.toUpperCase()}`);
  if (p.amp) {
    const a = p.amp;
    parts.push(`Gain ${(+a.gain).toFixed(0)}  Basses ${(+a.bass).toFixed(0)}  Médiums ${(+a.mid).toFixed(0)}  Aigus ${(+a.treble).toFixed(0)}`);
  }
  if (p.effects) {
    const active = Object.entries(p.effects)
      .filter(([, v]) => v && v.on)
      .map(([k]) => ({ compressor:'COMP', overdrive:'OD', distortion:'DIST',
                       chorus:'CHORUS', phaser:'PHASER', delay:'DELAY',
                       reverb:'REVERB', tremolo:'TREM', eq:'EQ' }[k] || k.toUpperCase()))
      .join('  ');
    if (active) parts.push(active);
  }
  return parts.join('\n');
}

function _addMsg(role, text, preset, isError) {
  const body = el('ai-chat-body');
  const welcome = body.querySelector('.ai-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');

  if (role === 'loading') {
    div.className = 'ai-msg ai-msg-ai';
    div.innerHTML = '<span class="ai-dots"><span>·</span><span>·</span><span>·</span></span>';
  } else if (role === 'user') {
    div.className = 'ai-msg ai-msg-user';
    div.textContent = text;
  } else {
    // AI message
    div.className = 'ai-msg ai-msg-ai' + (isError ? ' ai-msg-err' : '');

    if (text) {
      const expl = document.createElement('p');
      expl.className = 'ai-expl';
      expl.textContent = text;
      div.appendChild(expl);
    }
    if (preset && preset._source) {
      const badge = document.createElement('span');
      badge.className = preset._source === 'dataset' ? 'ai-badge-dataset' : 'ai-badge-ai';
      badge.textContent = preset._source === 'dataset' ? '📀 Dataset vérifié' : '✦ Généré par IA';
      div.appendChild(badge);
    }

    if (preset) {
      const summary = _presetSummary(preset);
      if (summary) {
        const card = document.createElement('pre');
        card.className = 'ai-preset-card';
        card.textContent = summary;
        div.appendChild(card);
      }

      const btn = document.createElement('button');
      btn.className = 'ai-apply-btn';
      btn.innerHTML = '⚡ Appliquer automatiquement';
      btn.onclick = () => {
        _applyPresetData(preset);
        btn.innerHTML = '✓ Appliqué !';
        btn.classList.add('applied');
        setTimeout(() => { btn.innerHTML = '⚡ Appliquer automatiquement'; btn.classList.remove('applied'); }, 2500);
      };
      div.appendChild(btn);
    }
  }

  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}

function togglePullSection() {
  const section = el('ai-pull-section');
  const btn     = el('ai-add-model-btn');
  const open    = section.classList.toggle('open');
  btn.classList.toggle('active', open);
  if (open) el('ai-pull-input').focus();
}

function aiPullCustom() {
  const name = el('ai-pull-input').value.trim();
  if (name) aiPullModel(name);
}

async function aiPullModel(name) {
  const statusEl  = el('ai-pull-status');
  const barWrap   = el('ai-pull-bar-wrap');
  const bar       = el('ai-pull-bar');
  const pullBtn   = el('ai-pull-btn');
  const quickBtns = document.querySelectorAll('.ai-pull-quick');

  statusEl.textContent = `Connexion à Ollama…`;
  statusEl.className = '';
  barWrap.style.display = 'none';
  quickBtns.forEach(b => b.disabled = true);
  if (pullBtn) pullBtn.disabled = true;

  try {
    const res = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status} — est-il lancé ?`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          if (d.error) throw new Error(d.error);
          if (d.total && d.completed) {
            const pct = Math.round((d.completed / d.total) * 100);
            const mb  = Math.round(d.completed / 1_048_576);
            const tot = Math.round(d.total / 1_048_576);
            barWrap.style.display = 'block';
            bar.style.width = pct + '%';
            statusEl.textContent = `${name}  ${pct}%  (${mb} / ${tot} MB)`;
          } else if (d.status && d.status !== 'success') {
            statusEl.textContent = `${name}  —  ${d.status}`;
          }
          if (d.status === 'success') {
            barWrap.style.display = 'none';
            statusEl.textContent  = `✓ ${name} téléchargé`;
            statusEl.className    = 'ai-pull-ok';
            await aiLoadModels();
            el('ai-model-sel').value = name;
          }
        } catch (e) {
          if (e.message) throw e;
        }
      }
    }
  } catch (err) {
    barWrap.style.display = 'none';
    statusEl.textContent  = `⚠ ${err.message}`;
    statusEl.className    = 'ai-pull-err';
  } finally {
    quickBtns.forEach(b => b.disabled = false);
    if (pullBtn) pullBtn.disabled = false;
  }
}

async function aiSuggest() {
  const promptEl = el('ai-prompt');
  const prompt   = promptEl.value.trim();
  if (!prompt) { promptEl.focus(); return; }

  const btn   = el('ai-suggest-btn');
  const model = el('ai-model-sel').value || 'llama3.2';

  _addMsg('user', prompt, null);
  promptEl.value = '';
  btn.disabled = true;

  const loadingDiv = _addMsg('loading', '', null);

  try {
    const res  = await fetch(`${AI_URL}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model }),
    });
    const data = await res.json();
    loadingDiv.remove();

    if (!res.ok) {
      const detail = data.detail || `Erreur ${res.status}`;
      _addMsg('ai', `⚠ ${detail}`, null, true);
    } else {
      const preset = data.preset ? { ...data.preset, _source: data.source || 'ai' } : null;
    _addMsg('ai', data.explanation || '', preset, false);
    }
  } catch (err) {
    loadingDiv.remove();
    const isConn = err.message.includes('fetch') || err.message.includes('Failed') || err.message.includes('NetworkError');
    _addMsg('ai',
      isConn ? '⚠ Serveur IA non démarré. Lance : python3 ai-server/server.py' : '⚠ ' + err.message,
      null, true
    );
  } finally {
    btn.disabled = false;
    promptEl.focus();
  }
}
