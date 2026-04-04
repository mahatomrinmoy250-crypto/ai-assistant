'use client';

import { useEffect, useState } from 'react';
import { api, WebhookEndpoint, WebhookDelivery } from '@/lib/api';

const EVENT_OPTIONS = [
  'call.started', 'call.ended', 'call.failed',
  'booking.created', 'campaign.completed',
];

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ url: '', events: ['call.ended', 'booking.created'] });
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<{ id: string; secret: string } | null>(null);
  const [deliveries, setDeliveries] = useState<{ webhookId: string; items: WebhookDelivery[] } | null>(null);

  async function load() {
    try {
      const data = await api.getWebhooks();
      setWebhooks(data.webhooks);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleEvent(ev: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));
  }

  async function handleCreate() {
    if (!form.url || form.events.length === 0) return;
    setSaving(true);
    try {
      const result = await api.createWebhook({ url: form.url, events: form.events });
      setNewSecret({ id: result.id, secret: (result as WebhookEndpoint & { secret: string }).secret });
      setForm({ url: '', events: ['call.ended', 'booking.created'] });
      setShowCreate(false);
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this webhook?')) return;
    try {
      await api.deleteWebhook(id);
      load();
    } catch (err) {
      console.error(err);
    }
  }

  async function loadDeliveries(id: string) {
    try {
      const data = await api.getWebhookDeliveries(id);
      setDeliveries({ webhookId: id, items: data.deliveries });
    } catch (err) {
      console.error(err);
    }
  }

  const statusDot = (active: boolean) =>
    active ? 'bg-green-400' : 'bg-gray-300';

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-gray-500 mt-1">Receive real-time events to your endpoints</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Endpoint
        </button>
      </div>

      {/* Secret reveal toast */}
      {newSecret && (
        <div className="mb-6 card p-4 border-l-4 border-yellow-400 bg-yellow-50">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-yellow-800 text-sm">Save your webhook secret — shown only once!</p>
              <code className="text-xs bg-yellow-100 px-2 py-1 rounded mt-2 block break-all">{newSecret.secret}</code>
              <p className="text-xs text-yellow-600 mt-1">Use this to verify HMAC-SHA256 signatures on incoming requests.</p>
            </div>
            <button onClick={() => setNewSecret(null)} className="text-yellow-600 hover:text-yellow-800 ml-4">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Webhook Endpoint</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint URL</label>
                <input
                  className="input w-full"
                  placeholder="https://your-server.com/webhook"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Events to subscribe</label>
                <div className="space-y-2">
                  {EVENT_OPTIONS.map((ev) => (
                    <label key={ev} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.events.includes(ev)}
                        onChange={() => toggleEvent(ev)}
                        className="rounded"
                      />
                      <code className="text-sm text-gray-700">{ev}</code>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Adding...' : 'Add Endpoint'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery logs modal */}
      {deliveries && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Delivery Logs</h2>
              <button onClick={() => setDeliveries(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {deliveries.items.length === 0 ? (
              <p className="text-gray-400 text-sm">No deliveries yet</p>
            ) : (
              <div className="space-y-3">
                {deliveries.items.map((d) => (
                  <div key={d.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <code className="text-xs text-gray-600">{d.event}</code>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${d.success ? 'text-green-600' : 'text-red-500'}`}>
                          {d.statusCode || 'ERR'}
                        </span>
                        <span className="text-xs text-gray-400">{new Date(d.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    {d.error && <p className="text-xs text-red-500 mt-1">{d.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">🔗</div>
          <h3 className="font-semibold text-gray-900 mb-1">No webhook endpoints</h3>
          <p className="text-gray-500 text-sm mb-4">Receive real-time events like bookings, call ended, and more</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">Add Endpoint</button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((wh) => (
            <div key={wh.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full ${statusDot(wh.isActive)}`} />
                    <code className="text-sm font-medium text-gray-900">{wh.url}</code>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {wh.events.map((ev) => (
                      <span key={ev} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{ev}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => loadDeliveries(wh.id)}
                    className="btn-secondary text-xs"
                  >
                    Logs
                  </button>
                  <button
                    onClick={() => handleDelete(wh.id)}
                    className="text-gray-300 hover:text-red-500"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
