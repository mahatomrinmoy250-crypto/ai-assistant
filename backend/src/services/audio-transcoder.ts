/**
 * Audio Transcoder
 *
 * Handles conversion between:
 *   - Vobiz/Telephony: mulaw (PCMU) 8kHz
 *   - Gemini Live API: PCM 16-bit signed little-endian 16kHz (input)
 *   - Gemini Live API: PCM 16-bit signed little-endian 24kHz (output)
 *
 * mulaw <-> PCM conversion uses the standard ITU-T G.711 algorithm.
 * Sample rate conversion uses simple linear interpolation (good enough for speech).
 */

// ─── μ-law (mulaw/PCMU) decode table ────────────────────────────────────────
// Precomputed decode table for all 256 mulaw byte values → 16-bit PCM
const MULAW_DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    let byte = ~i & 0xFF;
    const sign = byte & 0x80;
    const exponent = (byte >> 4) & 0x07;
    const mantissa = byte & 0x0F;
    let sample = (mantissa << 3) | 0x84;
    sample <<= exponent;
    sample -= 132;
    table[i] = sign ? -sample : sample;
  }
  return table;
})();

// ─── μ-law encode lookup ─────────────────────────────────────────────────────
const MULAW_MAX = 0x1FFF;
const MULAW_BIAS = 132;

function encodeMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sign) sample = -sample;
  sample += MULAW_BIAS;
  if (sample > 32767) sample = 32767;

  let exponent = 7;
  let expMask = 0x4000;
  for (; exponent > 0; exponent--, expMask >>= 1) {
    if (sample & expMask) break;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Decode mulaw buffer (8kHz) → PCM Int16 samples (8kHz)
 */
export function mulawToPCM(mulawBuf: Buffer): Int16Array {
  const pcm = new Int16Array(mulawBuf.length);
  for (let i = 0; i < mulawBuf.length; i++) {
    pcm[i] = MULAW_DECODE_TABLE[mulawBuf[i]];
  }
  return pcm;
}

/**
 * Encode PCM Int16 samples → mulaw buffer
 */
export function pcmToMulaw(pcm: Int16Array): Buffer {
  const buf = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    buf[i] = encodeMulaw(pcm[i]);
  }
  return buf;
}

/**
 * Resample PCM Int16 samples using linear interpolation
 * fromRate → toRate
 */
export function resamplePCM(
  samples: Int16Array,
  fromRate: number,
  toRate: number
): Int16Array {
  if (fromRate === toRate) return samples;

  const ratio = fromRate / toRate;
  const outputLength = Math.round(samples.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const s0 = samples[srcIdx] ?? 0;
    const s1 = samples[srcIdx + 1] ?? s0;
    output[i] = Math.round(s0 + frac * (s1 - s0));
  }

  return output;
}

/**
 * Int16Array → Buffer (little-endian)
 */
export function int16ToBuffer(samples: Int16Array): Buffer {
  const buf = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], i * 2);
  }
  return buf;
}

/**
 * Buffer (little-endian Int16) → Int16Array
 */
export function bufferToInt16(buf: Buffer): Int16Array {
  const samples = new Int16Array(buf.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(i * 2);
  }
  return samples;
}

/**
 * Convert Vobiz mulaw 8kHz → PCM Buffer 16kHz (for Gemini Live input)
 * Gemini expects: raw PCM, 16-bit signed LE, 16kHz, mono
 */
export function vobizAudioToGemini(mulawBase64: string): Buffer {
  const mulawBuf = Buffer.from(mulawBase64, 'base64');
  const pcm8k = mulawToPCM(mulawBuf);
  const pcm16k = resamplePCM(pcm8k, 8000, 16000);
  return int16ToBuffer(pcm16k);
}

/**
 * Convert Gemini output PCM 24kHz → Vobiz mulaw 8kHz base64
 * Gemini outputs: raw PCM 16-bit signed LE, 24kHz
 */
export function geminiAudioToVobiz(pcm24kBuffer: Buffer): string {
  const pcm24k = bufferToInt16(pcm24kBuffer);
  const pcm8k = resamplePCM(pcm24k, 24000, 8000);
  const mulaw = pcmToMulaw(pcm8k);
  return mulaw.toString('base64');
}
