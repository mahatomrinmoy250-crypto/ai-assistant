'use client';

import { useEffect, useState } from 'react';
import { api, PhoneNumber, Assistant } from '@/lib/api';

export default function PhoneNumbersPage() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPurchase, setShowPurchase] = useState(false);
  const [areaCode, setAreaCode] = useState('415');
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const [nums, assists] = await Promise.all([
        api.getPhoneNumbers(),
        api.getAssistants(),
      ]);
      setNumbers(nums);
      setAssistants(assists);
      setLoading(false);
    }
    load();
  }, []);

  async function handlePurchase(e: React.FormEvent) {
    e.preventDefault();
    setPurchasing(true);
    setError('');
    try {
      const num = await api.purchasePhoneNumber(areaCode);
      setNumbers((prev) => [num, ...prev]);
      setShowPurchase(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to purchase number');
    } finally {
      setPurchasing(false);
    }
  }

  async function handleAssign(numberId: string, assistantId: string | null) {
    const updated = await api.assignAssistant(numberId, assistantId);
    setNumbers((prev) => prev.map((n) => (n.id === numberId ? updated : n)));
  }

  async function handleRelease(id: string) {
    if (!confirm('Release this phone number? This cannot be undone.')) return;
    await api.releasePhoneNumber(id);
    setNumbers((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phone Numbers</h1>
          <p className="text-gray-500 mt-1">Manage your Twilio phone numbers</p>
        </div>
        <button className="btn-primary" onClick={() => setShowPurchase(true)}>
          + Buy Number
        </button>
      </div>

      {showPurchase && (
        <div className="card p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Purchase Phone Number</h2>
          <form onSubmit={handlePurchase} className="flex gap-4 items-end">
            <div>
              <label className="label">Area Code (US)</label>
              <input
                className="input w-32"
                placeholder="415"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button type="submit" className="btn-primary" disabled={purchasing}>
              {purchasing ? 'Purchasing...' : 'Purchase'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowPurchase(false)}>
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
          <p className="text-gray-500 mb-6">Purchase a Twilio number to receive inbound calls</p>
          <button className="btn-primary" onClick={() => setShowPurchase(true)}>
            Buy a Number
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Number</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Friendly Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Assigned Assistant</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {numbers.map((num) => (
                <tr key={num.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-900">{num.number}</td>
                  <td className="px-4 py-3 text-gray-500">{num.friendlyName || '—'}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input text-xs py-1"
                      value={num.assistantId || ''}
                      onChange={(e) => handleAssign(num.id, e.target.value || null)}
                    >
                      <option value="">— No assistant —</option>
                      {assistants.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRelease(num.id)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Release
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
