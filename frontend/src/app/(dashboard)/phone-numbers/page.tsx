'use client';

import { useEffect, useState } from 'react';
import { api, PhoneNumber, Agent } from '@/lib/api';

export default function PhoneNumbersPage() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLink, setShowLink] = useState(false);
  const [linkNumber, setLinkNumber] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const [nums, agts] = await Promise.all([
        api.getPhoneNumbers(),
        api.getAssistants(),
      ]);
      setNumbers(nums);
      setAgents(agts);
      setLoading(false);
    }
    load();
  }, []);

  async function handleLink(e: React.FormEvent) {
    e.preventDefault();
    setLinking(true);
    setError('');
    try {
      const num = await api.linkPhoneNumber(linkNumber.trim());
      setNumbers((prev) => [num, ...prev]);
      setShowLink(false);
      setLinkNumber('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link number');
    } finally {
      setLinking(false);
    }
  }

  async function handleAssign(numberId: string, agentId: string | null) {
    const updated = await api.assignAgent(numberId, agentId);
    setNumbers((prev) => prev.map((n) => (n.id === numberId ? updated : n)));
  }

  async function handleRelease(id: string) {
    if (!confirm('Remove this phone number from your account?')) return;
    await api.releasePhoneNumber(id);
    setNumbers((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phone Numbers</h1>
          <p className="text-gray-500 mt-1">Link your Vobiz numbers and assign agents</p>
        </div>
        <button className="btn-primary" onClick={() => setShowLink(true)}>
          + Link Number
        </button>
      </div>

      {showLink && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-1">Link Existing Vobiz Number</h2>
          <p className="text-sm text-gray-500 mb-4">Add a number you already have in Vobiz to assign it to an agent</p>
          <form onSubmit={handleLink} className="flex gap-4 items-end flex-wrap">
            <div>
              <label className="label">Phone Number</label>
              <input
                className="input w-48"
                placeholder="+918065481672"
                value={linkNumber}
                onChange={(e) => setLinkNumber(e.target.value)}
              />
            </div>
            {error && <p className="text-red-600 text-sm self-center">{error}</p>}
            <button type="submit" className="btn-primary" disabled={linking}>
              {linking ? 'Linking...' : 'Link Number'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setShowLink(false); setError(''); }}>
              Cancel
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : numbers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">📱</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No phone numbers</h3>
          <p className="text-gray-500 mb-6">Link your Vobiz number to start receiving inbound calls</p>
          <button className="btn-primary" onClick={() => setShowLink(true)}>
            Link a Number
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Number</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Provider</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Assigned Agent</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {numbers.map((num) => (
                <tr key={num.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-900">{num.number}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{num.provider}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input text-xs py-1"
                      value={num.agentId || ''}
                      onChange={(e) => handleAssign(num.id, e.target.value || null)}
                    >
                      <option value="">— No agent —</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRelease(num.id)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
