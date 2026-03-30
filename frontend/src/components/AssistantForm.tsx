'use client';

import { useState } from 'react';
import { Assistant } from '@/lib/api';

interface Props {
  initialValues?: Partial<Assistant>;
  onSubmit: (data: Record<string, unknown>) => void;
  loading?: boolean;
  submitLabel?: string;
}

const CLAUDE_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

const ELEVENLABS_MODELS = [
  'eleven_turbo_v2_5',
  'eleven_turbo_v2',
  'eleven_multilingual_v2',
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
    llmModel: initialValues?.llmModel || 'claude-sonnet-4-6',
    llmTemperature: initialValues?.llmTemperature ?? 0.7,
    llmMaxTokens: initialValues?.llmMaxTokens ?? 500,
    sttLanguage: initialValues?.sttLanguage || 'en-US',
    sttModel: initialValues?.sttModel || 'nova-2',
    ttsVoiceId: initialValues?.ttsVoiceId || '21m00Tcm4TlvDq8ikWAM',
    ttsModel: initialValues?.ttsModel || 'eleven_turbo_v2_5',
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

      {/* LLM */}
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Language Model (LLM)</h2>
        <div>
          <label className="label">Model</label>
          <select
            className="input"
            value={form.llmModel}
            onChange={(e) => setForm({ ...form, llmModel: e.target.value })}
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Temperature ({form.llmTemperature})</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={form.llmTemperature}
              onChange={(e) => setForm({ ...form, llmTemperature: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
          <div>
            <label className="label">Max Tokens</label>
            <input
              type="number"
              className="input"
              min="50"
              max="4096"
              value={form.llmMaxTokens}
              onChange={(e) => setForm({ ...form, llmMaxTokens: parseInt(e.target.value) })}
            />
          </div>
        </div>
      </section>

      {/* TTS */}
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Voice Synthesis (TTS)</h2>
        <div>
          <label className="label">Voice ID (ElevenLabs)</label>
          <input
            className="input"
            placeholder="21m00Tcm4TlvDq8ikWAM"
            value={form.ttsVoiceId}
            onChange={(e) => setForm({ ...form, ttsVoiceId: e.target.value })}
          />
          <p className="text-xs text-gray-400 mt-1">Find voice IDs at elevenlabs.io/voice-library</p>
        </div>
        <div>
          <label className="label">TTS Model</label>
          <select
            className="input"
            value={form.ttsModel}
            onChange={(e) => setForm({ ...form, ttsModel: e.target.value })}
          >
            {ELEVENLABS_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
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
              className="input"
              value={form.sttLanguage}
              onChange={(e) => setForm({ ...form, sttLanguage: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Model</label>
            <select
              className="input"
              value={form.sttModel}
              onChange={(e) => setForm({ ...form, sttModel: e.target.value })}
            >
              <option value="nova-2">nova-2 (recommended)</option>
              <option value="nova">nova</option>
              <option value="enhanced">enhanced</option>
              <option value="base">base</option>
            </select>
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
