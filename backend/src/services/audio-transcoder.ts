/**
 * Audio Transcoder
 *
 * Handles conversion between:
 *   - Vobiz/Telephony: L16 (linear PCM, 16-bit big-endian) 8kHz  [audio/x-l16]
 *   - Gemini Live API: PCM 16-bit signed little-endian 16kHz (input)
 *   - Gemini Live API: PCM 16-bit signed little-endian 24kHz (output)
 *
 * Sample rate conversion uses simple linear interpolation (good enough for speech).
 */

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Decode L16 big-endian buffer → Int16Array
 * audio/x-l16 uses network byte order (big-endian) per RFC 3551
 */
export function l16ToInt16(buf: Buffer): Int16Array {
  const samples = new Int16Array(buf.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16BE(i * 2);
  }
  return samples;
}

/**
 * Int16Array → L16 big-endian buffer
 */
export function int16ToL16(samples: Int16Array): Buffer {
  const buf = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16BE(samples[i], i * 2);
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
 * Convert Vobiz L16 big-endian 8kHz → PCM Buffer 16kHz (for Gemini Live input)
 * Vobiz sends: audio/x-l16, 16-bit big-endian, 8kHz, mono
 * Gemini expects: raw PCM, 16-bit signed LE, 16kHz, mono
 */
export function vobizAudioToGemini(l16Base64: string): Buffer {
  const l16Buf = Buffer.from(l16Base64, 'base64');
  const pcm8k = l16ToInt16(l16Buf);
  const pcm16k = resamplePCM(pcm8k, 8000, 16000);
  return int16ToBuffer(pcm16k);
}

/**
 * Convert Gemini output PCM 24kHz → Vobiz L16 big-endian 8kHz base64
 * Gemini outputs: raw PCM 16-bit signed LE, 24kHz
 * Vobiz playAudio expects: audio/x-l16, 16-bit big-endian, 8kHz, mono
 */
export function geminiAudioToVobiz(pcm24kBuffer: Buffer): string {
  const pcm24k = bufferToInt16(pcm24kBuffer);
  const pcm8k = resamplePCM(pcm24k, 24000, 8000);
  return int16ToL16(pcm8k).toString('base64');
}
