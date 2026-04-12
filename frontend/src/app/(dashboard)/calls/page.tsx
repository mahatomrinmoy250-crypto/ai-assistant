'use client';

import { useEffect, useState } from 'react';
import { api, Call, Assistant } from '@/lib/api';
import Link from 'next/link';

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'badge-green',
  IN_PROGRESS: 'badge-blue',
  FAILED: 'badge-red',
  CANCELED: 'badge-gray',
  QUEUED: 'badge-yellow',
  RINGING: 'badge-yellow',
  BUSY: 'badge-red',
  NO_ANSWER: 'badge-gray',
};

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showOutbound, setShowOutbound] = useState(false);
  const [outboundForm, setOutboundForm] = useState({ agentId: '', toNumber: '' });
  const [outboundLoading, setOutboundLoading] = useState(false);
  const [outboundError, setOutboundError] = useState('');

  const LIMIT = 20;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [callsData, assistantsList] = await Promise.all([
          api.getCalls({ page, limit: LIMIT }),
          api.getAssistants(),
        ]);
        setCalls(callsData.calls);
        setTotal(callsData.total);
        setAssistants(assistantsList);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [page]);

  async function handleOutboundCall(e: React.FormEvent) {
    e.preventDefault();
    setOutboundLoading(true);
    setOutboundError('');
    try {
      const call = await api.createCall(outboundForm);
      setCalls((prev) => [call, ...prev]);
      setShowOutbound(false);
      setOutboundForm({ agentId: '', toNumber: '' });
    } catch (err) {
      setOutboundError(err instanceof Error ? err.message : 'Failed to start call');
    } finally {
      setOutboundLoading(false);
    }
  }

  async function handleHangup(id: string) {
    await api.hangupCall(id);
    setCalls((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'CANCELED' } : c))
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calls</h1>
          <p className="text-gray-500 mt-1">{total} total calls</p>
        </div>
        <button className="btn-primary" onClick={() => setShowOutbound(true)}>
          + Outbound Call
        </button>
      </div>

      {/* Outbound Call Form */}
      {showOutbound && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Make Outbound Call</h2>
          <form onSubmit={handleOutboundCall} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Assistant</label>
                <select
                  className="input"
                  value={outboundForm.agentId}
                  onChange={(e) => setOutboundForm({ ...outboundForm, agentId: e.target.value })}
                  required
                >
                  <option value="">Select assistant...</option>
                  {assistants.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">To Number</label>
                <input
                  className="input"
                  placeholder="+1234567890"
                  value={outboundForm.toNumber}
                  onChange={(e) => setOutboundForm({ ...outboundForm, toNumber: e.target.value })}
                  required
                />
              </div>
            </div>
            {outboundError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-700 text-sm">
                {outboundError}
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={outboundLoading}>
                {outboundLoading ? 'Calling...' : 'Call Now'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowOutbound(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : calls.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">📞</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No calls yet</h3>
          <p className="text-gray-500">Calls will appear here once your assistant receives or makes calls</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Direction</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Number</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Assistant</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Duration</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {calls.map((call) => (
                <tr key={call.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={call.type === 'INBOUND' ? 'badge-blue' : 'badge-green'}>
                      {call.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {call.type === 'INBOUND' ? call.fromNumber : call.toNumber}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{call.assistant?.name}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[call.status] || 'badge-gray'}>
                      {call.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {call.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(call.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/calls/${call.id}`} className="text-blue-600 hover:underline text-xs">
                        View
                      </Link>
                      {call.status === 'IN_PROGRESS' && (
                        <button
                          onClick={() => handleHangup(call.id)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Hangup
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-500">
                Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn-secondary text-xs px-3 py-1"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </button>
                <button
                  className="btn-secondary text-xs px-3 py-1"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * LIMIT >= total}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
