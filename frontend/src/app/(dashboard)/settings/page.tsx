'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    vobizApiKey: '',
    vobizBaseUrl: 'https://api.vobiz.ai/v1',
    vobizFromNumber: '',
  });

  useEffect(() => {
    async function load() {
      try {
        const me = await api.getMe();
        if (me.workspace) {
          setForm({
            vobizApiKey: (me.workspace as any).vobizApiKey || '',
            vobizBaseUrl: (me.workspace as any).vobizBaseUrl || 'https://api.vobiz.ai/v1',
            vobizFromNumber: (me.workspace as any).vobizFromNumber || '',
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.updateWorkspace(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure your telephony credentials</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Vobiz Section */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Vobiz Telephony</h2>
              <p className="text-sm text-gray-500">Add your Vobiz account credentials for calling</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">Vobiz API Key</label>
              <input
                type="password"
                className="input"
                placeholder="Enter your Vobiz API key"
                value={form.vobizApiKey}
                onChange={(e) => setForm({ ...form, vobizApiKey: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1">
                Get from your Vobiz dashboard → API Settings
              </p>
            </div>

            <div>
              <label className="label">Your Phone Number (From Number)</label>
              <input
                type="text"
                className="input"
                placeholder="+919876543210"
                value={form.vobizFromNumber}
                onChange={(e) => setForm({ ...form, vobizFromNumber: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1">
                Your Vobiz number — used for outbound calls and inbound routing
              </p>
            </div>

            <div>
              <label className="label">Vobiz API Base URL</label>
              <input
                type="text"
                className="input"
                placeholder="https://api.vobiz.ai/v1"
                value={form.vobizBaseUrl}
                onChange={(e) => setForm({ ...form, vobizBaseUrl: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1">
                Default: https://api.vobiz.ai/v1 (do not change unless Vobiz told you to)
              </p>
            </div>
          </div>
        </div>

        {/* Webhook Info */}
        <div className="card p-5 bg-blue-50 border-blue-200">
          <h3 className="font-semibold text-blue-900 mb-2 text-sm">Inbound Call Webhook URL</h3>
          <p className="text-xs text-blue-700 mb-2">
            Set this URL in your Vobiz dashboard for your phone number to receive inbound calls:
          </p>
          <code className="text-xs bg-white border border-blue-200 rounded px-3 py-2 block text-blue-800 break-all">
            {typeof window !== 'undefined'
              ? `${window.location.protocol}//${window.location.hostname}:3001/api/calls/inbound`
              : 'http://YOUR_SERVER_IP:3001/api/calls/inbound'}
          </code>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {saved && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 text-green-700 text-sm">
            Settings saved successfully!
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
