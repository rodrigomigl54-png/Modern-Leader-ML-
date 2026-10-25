// Sound (GDD section 13): UI clicks, an alert for urgent notifications, missile launch and impact
// sounds, and one calm ambient music track. Everything is synthesized with the Web Audio API, so
// the game ships no audio files (self-made audio, no licenses). Separate volumes for music and
// effects; muted by default on phones until the player turns sound on.

export type SoundEffect = 'click' | 'alert' | 'launch' | 'impact';

const MUSIC_KEY = 'ml.musicVolume';
const EFFECTS_KEY = 'ml.effectsVolume';

const isPhone = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function readVolume(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (localStorage.getItem(key) !== null && Number.isFinite(v))
      return Math.min(1, Math.max(0, v));
  } catch {
    // Storage blocked: use the default.
  }
  return fallback;
}

function writeVolume(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore: the volume still applies for this visit.
  }
}

/** Calm minor chords for the ambient track (frequencies in Hz). */
const CHORDS: number[][] = [
  [110, 164.81, 220, 261.63],
  [87.31, 130.81, 174.61, 220],
  [98, 146.83, 196, 246.94],
  [82.41, 123.47, 164.81, 207.65],
];
const CHORD_SECONDS = 9;

export class Sound {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private chord = 0;
  private wantMusic = false;
  musicVolume = readVolume(MUSIC_KEY, isPhone() ? 0 : 0.3);
  effectsVolume = readVolume(EFFECTS_KEY, isPhone() ? 0 : 0.6);

  /** Browsers allow audio only after a user gesture: the context starts on the first tap. */
  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = globalThis.AudioContext as typeof AudioContext | undefined;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume * 0.25;
    this.musicGain.connect(this.ctx.destination);
    this.effectsGain = this.ctx.createGain();
    this.effectsGain.gain.value = this.effectsVolume;
    this.effectsGain.connect(this.ctx.destination);
    return this.ctx;
  }

  setMusicVolume(value: number): void {
    this.musicVolume = value;
    writeVolume(MUSIC_KEY, value);
    if (this.musicGain) this.musicGain.gain.value = value * 0.25;
    if (this.wantMusic) this.startMusic();
  }

  setEffectsVolume(value: number): void {
    this.effectsVolume = value;
    writeVolume(EFFECTS_KEY, value);
    if (this.effectsGain) this.effectsGain.gain.value = value;
  }

  play(effect: SoundEffect): void {
    if (this.effectsVolume <= 0) return;
    const ctx = this.audio();
    if (!ctx || !this.effectsGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const out = this.effectsGain;
    switch (effect) {
      case 'click':
        tone(ctx, out, 'sine', 1200, 900, t, 0.04, 0.12);
        break;
      case 'alert':
        tone(ctx, out, 'triangle', 660, 660, t, 0.14, 0.25);
        tone(ctx, out, 'triangle', 880, 880, t + 0.16, 0.18, 0.25);
        break;
      case 'launch':
        noise(ctx, out, t, 0.9, 400, 2400, 0.35);
        break;
      case 'impact':
        tone(ctx, out, 'sine', 120, 40, t, 0.5, 0.6);
        noise(ctx, out, t, 0.6, 900, 200, 0.4);
        break;
    }
  }

  /** Starts the ambient track if the music volume is above zero. */
  startMusic(): void {
    this.wantMusic = true;
    if (this.musicVolume <= 0 || this.musicTimer) return;
    const ctx = this.audio();
    if (!ctx || !this.musicGain) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const next = (): void => {
      if (!this.wantMusic || this.musicVolume <= 0 || !this.musicGain) {
        this.musicTimer = null;
        return;
      }
      pad(ctx, this.musicGain, CHORDS[this.chord % CHORDS.length]!, ctx.currentTime);
      this.chord++;
      this.musicTimer = setTimeout(next, CHORD_SECONDS * 1000);
    };
    next();
  }

  stopMusic(): void {
    this.wantMusic = false;
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }
}

/** A short tone sliding from one frequency to another, with a quick fade out. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  from: number,
  to: number,
  start: number,
  seconds: number,
  volume: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + seconds);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
}

/** Filtered noise: a whoosh (rising filter) or a rumble (falling filter). */
function noise(
  ctx: AudioContext,
  out: AudioNode,
  start: number,
  seconds: number,
  fromHz: number,
  toHz: number,
  volume: number,
): void {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // A fixed pattern instead of Math.random: the same sound every time.
  let x = 0x2545f491;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(fromHz, start);
  filter.frequency.exponentialRampToValueAtTime(toHz, start + seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + seconds * 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  source.connect(filter).connect(gain).connect(out);
  source.start(start);
  source.stop(start + seconds + 0.02);
}

/** One slow chord of the ambient track: soft detuned voices that swell and fade. */
function pad(ctx: AudioContext, out: AudioNode, chord: number[], start: number): void {
  const seconds = CHORD_SECONDS + 3;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(0.12, start + 3);
  gain.gain.linearRampToValueAtTime(0.0001, start + seconds);
  filter.connect(gain).connect(out);
  for (const f of chord) {
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(start);
      osc.stop(start + seconds + 0.05);
    }
  }
}
