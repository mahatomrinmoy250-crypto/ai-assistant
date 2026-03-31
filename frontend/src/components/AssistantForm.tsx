'use client';

import { useState } from 'react';
import { Assistant } from '@/lib/api';

interface Props {
  initialValues?: Partial<Assistant>;
  onSubmit: (data: Record<string, unknown>) => void;
  loading?: boolean;
  submitLabel?: string;
}

// Gemini Live models (handles STT + LLM + TTS in one)
const GEMINI_LIVE_MODELS = [
  'gemini-3.1-flash-live-preview',   // Latest — best quality
  'gemini-live-2.5-flash-native-audio', // GA stable
];

// Gemini built-in voices (30 HD voices available)
const GEMINI_VOICES = [
  { id: 'Puck',     label: 'Puck (Upbeat male)' },
  { id: 'Charon',   label: 'Charon (Informative male)' },
  { id: 'Kore',     label: 'Kore (Firm female)' },
  { id: 'Fenrir',   label: 'Fenrir (Excitable male)' },
  { id: 'Aoede',    label: 'Aoede (Breezy female)' },
  { id: 'Leda',     label: 'Leda (Youthful female)' },
  { id: 'Orus',     label: 'Orus (Firm male)' },
  { id: 'Zephyr',   label: 'Zephyr (Bright female)' },
  { id: 'Achernar', label: 'Achernar (Soft female)' },
  { id: 'Schedar',  label: 'Schedar (Even male)' },
];

// Supported languages
const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'ar-XA', label: 'Arabic' },
  { code: 'ja-JP', label: 'Japanese' },
];

export default function AssistantForm({
  initialValues,
  onSubmit,
  loading,
  submitLabel = 'Create Assistant',
}: Props) {
  const [form, setForm] = useState({
    name: initialValues?.name || '',
    systemPrompt: initialValues?.systemPrompt || '',
    firstMessage: initialValues?.firstMessage || '',
    llmModel: initialValues?.llmModel || 'gemini-3.1-flash-live-preview',
    llmTemperature: initialValues?.llmTemperature ?? 0.7,
    llmMaxTokens: initialValues?.llmMaxTokens ?? 500,
    sttLanguage: initialValues?.sttLanguage || 'en-US',
    sttModel: initialValues?.sttModel || 'gemini-3.1-flash-live-preview',
    ttsVoiceId: initialValues?.ttsVoiceId || 'Puck',
    ttsModel: initialValues?.ttsModel || 'gemini-3.1-flash-live-preview',
    ttsStability: initialValues?.ttsStability ?? 0.5,
    ttsSimilarity: initialValues?.ttsSimilarity ?? 0.75,
    ttsSpeed: initialValues?.ttsSpeed ?? 1.0,
    endCallMessage: initialValues?.endCallMessage || '',
    endCallPhrases: initialValues?.endCallPhrases?.join(', ') || '',
    maxCallDuration: initialValues?.maxCallDuration ?? 3600,
    webhookUrl: initialValues?.webhookUrl || '',
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      ...form,
      endCallPhrases: form.endCallPhrases
        ? form.endCallPhrases.split(',').map((p) => p.trim()).filter(Boolean)
        : [],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic */}
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Basic Configuration</h2>
        <div>
          <label className="label">Assistant Name *</label>
          <input
            className="input"
            placeholder="e.g. Customer Support Agent"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">System Prompt *</label>
          <textarea
            className="input h-32 resize-y"
            placeholder="You are a helpful customer support agent for Acme Corp..."
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">First Message</label>
          <input
            className="input"
            placeholder="Hello! How can I help you today?"
            value={form.firstMessage}
            onChange={(e) => setForm({ ...form, firstMessage: e.target.value })}
          />
          <p className="text-xs text-gray-400 mt-1">Message spoken at the start of the call</p>
        </div>
      </section>

      {/* Gemini Live — AI Engine */}
      <section className="card p-6 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-semibold text-gray-900">AI Engine</h2>
          <span className="badge-blue text-xs">Gemini Live — STT + LLM + TTS in one</span>
        </div>
        <p className="text-xs text-gray-500">
          Gemini 3.1 Flash Live handles speech recognition, conversation, and voice synthesis in a single real-time API — no separate STT/TTS needed.
        </p>
        <div>
          <label className="label">Model</label>
          <select
            className="input"
            value={form.llmModel}
            onChange={(e) => setForm({ ...form, llmModel: e.target.value, sttModel: e.target.value, ttsModel: e.target.value })}
          >
            {GEMINI_LIVE_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Language</label>
            <select
              className="input"
              value={form.sttLanguage}
              onChange={(e) => setForm({ ...form, sttLanguage: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Voice</label>
            <select
              className="input"
              value={form.ttsVoiceId}
              onChange={(e) => setForm({ ...form, ttsVoiceId: e.target.value })}
            >
              {GEMINI_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Advanced voice settings (kept for DB compat) */}
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Advanced Voice Settings</h2>
        <div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Stability ({form.ttsStability})</label>
            <input
              type="range" min="0" max="1" step="0.05"
              value={form.ttsStability}
              onChange={(e) => setForm({ ...form, ttsStability: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
          <div>
            <label className="label">Similarity ({form.ttsSimilarity})</label>
            <input
              type="range" min="0" max="1" step="0.05"
              value={form.ttsSimilarity}
              onChange={(e) => setForm({ ...form, ttsSimilarity: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
          <div>
            <label className="label">Speed ({form.ttsSpeed}x)</label>
            <input
              type="range" min="0.5" max="2" step="0.1"
              value={form.ttsSpeed}
              onChange={(e) => setForm({ ...form, ttsSpeed: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* STT */}
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Transcription (STT)</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Language</label>
            <input
              type="range" min="0" max="1" step="0.1"
              value={form.llmTemperature}
              onChange={(e) => setForm({ ...form, llmTemperature: parseFloat(e.target.value) })}
              className="w-full"
            />
            <p className="text-xs text-gray-400 mt-1">Controls response creativity ({form.llmTemperature})</p>
          </div>
        </div>
      </section>

      {/* Call Behavior */}
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Call Behavior</h2>
        <div>
          <label className="label">End Call Message</label>
          <input
            className="input"
            placeholder="Goodbye! Have a great day."
            value={form.endCallMessage}
            onChange={(e) => setForm({ ...form, endCallMessage: e.target.value })}
          />
        </div>
        <div>
          <label className="label">End Call Phrases (comma-separated)</label>
          <input
            className="input"
            placeholder="goodbye, bye, end call, hang up"
            value={form.endCallPhrases}
            onChange={(e) => setForm({ ...form, endCallPhrases: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Max Call Duration (seconds)</label>
          <input
            type="number"
            className="input"
            min="60"
            max="14400"
            value={form.maxCallDuration}
            onChange={(e) => setForm({ ...form, maxCallDuration: parseInt(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">Webhook URL</label>
          <input
            type="url"
            className="input"
            placeholder="https://your-app.com/webhook"
            value={form.webhookUrl}
            onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
          />
          <p className="text-xs text-gray-400 mt-1">Receive call events (started, ended)</p>
        </div>
      </section>

      <div className="flex gap-4">
        <button type="submit" className="btn-primary px-8 py-2.5" disabled={loading}>
          {loading ? 'Saving...' : submitLabel}
        </button>
        <a href="/assistants" className="btn-secondary px-8 py-2.5">
          Cancel
        </a>
      </div>
    </form>
  );
}
