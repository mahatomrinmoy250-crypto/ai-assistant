'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Assistant } from '@/lib/api';

export default function AssistantsPage() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAssistants().then(setAssistants).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this assistant?')) return;
    await api.deleteAssistant(id);
    setAssistants((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Assistants</h1>
          <p className="text-gray-500 mt-1">Manage your voice AI agents</p>
        </div>
        <Link href="/assistants/new" className="btn-primary">
          + New Assistant
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : assistants.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No assistants yet</h3>
          <p className="text-gray-500 mb-6">Create your first voice AI agent to get started</p>
          <Link href="/assistants/new" className="btn-primary">
            Create Assistant
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {assistants.map((assistant) => (
            <div key={assistant.id} className="card p-6 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <span className="text-xl">🤖</span>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/assistants/${assistant.id}`}
                    className="btn-secondary text-xs px-3 py-1"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(assistant.id)}
                    className="btn-danger text-xs px-3 py-1"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{assistant.name}</h3>
              <p className="text-sm text-gray-500 line-clamp-2 mb-4">
                {assistant.systemPrompt}
              </p>
              <div className="mt-auto pt-4 border-t border-gray-100 flex gap-3 text-xs text-gray-400">
                <span className="badge-blue">{assistant.llmModel}</span>
                <span className="badge-gray">{assistant.ttsVoiceId.slice(0, 8)}...</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
