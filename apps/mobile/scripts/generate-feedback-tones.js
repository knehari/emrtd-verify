#!/usr/bin/env node
/**
 * Génère les tonalités de retour sonore (assets/authentik/sounds/*.wav) à partir de la table
 * `TONES` du design v2 (`Authentik Mobile v2 Dark.dc.html`, méthode `fb()`), qui les synthétisait
 * en direct avec WebAudio : même fréquence et durée par note, même enveloppe (montée linéaire à
 * 0,12 en 8 ms puis décroissance exponentielle jusqu'à 0,0001), note suivante lancée à 85 % de la
 * durée de la précédente, onde triangle pour "error" et sinus pour le reste.
 *
 * Usage : node scripts/generate-feedback-tones.js — les WAV produits sont versionnés, ce script
 * n'est à relancer que si la table change.
 */
const fs = require("fs");
const path = require("path");

const TONES = {
  tick: [[1760, 0.035]],
  tap: [[880, 0.06]],
  live: [[1175, 0.09], [1568, 0.16]],
  success: [[880, 0.1], [1175, 0.1], [1568, 0.24]],
  warning: [[988, 0.12], [988, 0.2]],
  error: [[440, 0.16], [330, 0.28]],
};

const RATE = 22050;
const PEAK = 0.12;
const ATTACK = 0.008;
const FLOOR = 0.0001;

function wave(kind, phase) {
  if (kind === "error") return 1 - 4 * Math.abs(phase - 0.5);
  return Math.sin(2 * Math.PI * phase);
}

function render(kind) {
  const notes = TONES[kind];
  let t0 = 0.01;
  const starts = notes.map(([, dur]) => {
    const s = t0;
    t0 += dur * 0.85;
    return s;
  });
  const total = Math.max(...notes.map(([, dur], i) => starts[i] + dur + 0.02));
  const out = new Float32Array(Math.ceil(total * RATE));
  notes.forEach(([freq, dur], i) => {
    const begin = Math.floor(starts[i] * RATE);
    const len = Math.floor((dur + 0.02) * RATE);
    for (let n = 0; n < len && begin + n < out.length; n++) {
      const t = n / RATE;
      let g;
      if (t < ATTACK) g = (PEAK * t) / ATTACK;
      else if (t < dur) g = PEAK * Math.pow(FLOOR / PEAK, (t - ATTACK) / (dur - ATTACK));
      else g = 0;
      out[begin + n] += g * wave(kind, (freq * t) % 1);
    }
  });
  return out;
}

function toWav(samples) {
  // Les tonalités sont jouées à 0,12 de crête en WebAudio : on normalise vers ~0,5 pour qu'elles
  // restent audibles via le volume système du téléphone, sans écrêtage des notes superposées.
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const scale = 0.5 / peak;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * scale)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const dir = path.join(__dirname, "..", "assets", "authentik", "sounds");
fs.mkdirSync(dir, { recursive: true });
for (const kind of Object.keys(TONES)) {
  fs.writeFileSync(path.join(dir, `${kind}.wav`), toWav(render(kind)));
  console.log(`${kind}.wav`);
}
