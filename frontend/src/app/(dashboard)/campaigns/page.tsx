'use client';

import { useEffect, useState } from 'react';
import { api, Campaign, Agent, ContactList } from '@/lib/api';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', agentId: '', contactListId: '', scheduledAt: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [c, a, cl] = await Promise.all([
        api.getCampaigns(),
        api.getAssistants(),
        api.getContactLists(),
      ]);
      setCampaigns(c.campaigns);
      setAgents(a);
      setContactLists(cl.contactLists);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!form.name || !form.agentId || !form.contactListId) return;
    setSaving(true);
    try {
      await api.createCampaign({
        name: form.name,
        agentId: form.agentId,
        contactListId: form.contactListId,
        scheduledAt: form.scheduledAt || undefined,
      });
      setForm({ name: '', agentId: '', contactListId: '', scheduledAt: '' });
      setShowCreate(false);
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(id: string, action: 'start' | 'pause' | 'stop') {
    try {
      if (action === 'start') await api.startCampaign(id);
      else if (action === 'pause') await api.pauseCampaign(id);
      else await api.stopCampaign(id);
      load();
    } catch (err) {
      console.error(err);
    }
  }

  const statusColor: Record<string, string> = {
    draft: 'badge-gray',
    running: 'badge-green',
    paused: 'badge-yellow',
    completed: 'badge-blue',
    stopped: 'badge-red',
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          <p className="text-gray-500 mt-1">Bulk outbound calling campaigns</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Campaign
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Campaign</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
                <input
                  className="input w-full"
                  placeholder="e.g. Doctor Appointment Drive"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Agent</label>
                <select
                  className="input w-full"
                  value={form.agentId}
                  onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
                >
                  <option value="">Select agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact List</label>
                <select
                  className="input w-full"
                  value={form.contactListId}
                  onChange={(e) => setForm((f) => ({ ...f, contactListId: e.target.value }))}
                >
                  <option value="">Select contact list...</option>
                  {contactLists.map((cl) => (
                    <option key={cl.id} value={cl.id}>{cl.name} ({cl.contactCount} contacts)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule (optional)</label>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={form.scheduledAt}
                  onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📣</div>
          <h3 className="font-semibold text-gray-900 mb-1">No campaigns yet</h3>
          <p className="text-gray-500 text-sm mb-4">Create a campaign to start bulk outbound calling</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">Create Campaign</button>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-gray-900">{c.name}</h3>
                    <span className={statusColor[c.status] || 'badge-gray'}>{c.status}</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    Agent: {c.agent?.name || '—'} &bull; {c.totalContacts} contacts
                  </div>
                  {/* Progress bar */}
                  {c.totalContacts > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{c.calledContacts} called</span>
                        <span>{Math.round((c.calledContacts / c.totalContacts) * 100)}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${(c.calledContacts / c.totalContacts) * 100}%` }}
                        />
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-gray-400">
                        <span className="text-green-600">{c.successfulCalls} answered</span>
                        <span className="text-red-500">{c.failedCalls} failed</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-6">
                  {c.status === 'draft' && (
                    <button onClick={() => handleAction(c.id, 'start')} className="btn-primary text-sm">
                      Start
                    </button>
                  )}
                  {c.status === 'running' && (
                    <button onClick={() => handleAction(c.id, 'pause')} className="btn-secondary text-sm">
                      Pause
                    </button>
                  )}
                  {c.status === 'paused' && (
                    <button onClick={() => handleAction(c.id, 'start')} className="btn-primary text-sm">
                      Resume
                    </button>
                  )}
                  {(c.status === 'running' || c.status === 'paused') && (
                    <button
                      onClick={() => handleAction(c.id, 'stop')}
                      className="btn-secondary text-sm text-red-600"
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
