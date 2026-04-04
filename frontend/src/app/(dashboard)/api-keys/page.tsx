'use client';

import { useEffect, useState } from 'react';
import { api, ApiKey } from '@/lib/api';

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getApiKeys().then(setKeys).finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const key = await api.createApiKey(name.trim());
      setKeys((prev) => [key, ...prev]);
      setNewKey(key.key);
      setName('');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this API key?')) return;
    await api.deleteApiKey(id);
    setKeys((prev) => prev.filter((k) => k.id !== id));
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
        <p className="text-gray-500 mt-1">Use API keys to authenticate with the VoiceAI REST API</p>
      </div>

      {newKey && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-green-800 mb-2">
            Your new API key — copy it now, it won&apos;t be shown again:
          </p>
          <div className="flex items-center gap-3 bg-white rounded border p-3 font-mono text-sm">
            <span className="flex-1 break-all">{newKey}</span>
            <button
              onClick={() => copyKey(newKey)}
              className="btn-secondary text-xs px-3 py-1 shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewKey('')}
            className="text-xs text-green-700 mt-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="card p-6 mb-6">
        <h2 className="font-semibold text-gray-900 mb-4">Create New API Key</h2>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            className="input flex-1"
            placeholder="Key name (e.g. Production)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={creating || !name.trim()}>
            {creating ? 'Creating...' : 'Create Key'}
          </button>
        </form>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : keys.length === 0 ? (
        <p className="text-gray-400 text-sm">No API keys yet</p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Key</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Last Used</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{key.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-500">
                    {(key.key || key.keyPrefix || '').slice(0, 12)}••••••••
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Revoke
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
