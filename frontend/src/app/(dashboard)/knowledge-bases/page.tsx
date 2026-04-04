'use client';

import { useEffect, useState } from 'react';
import { api, KnowledgeBase, Agent } from '@/lib/api';

export default function KnowledgeBasesPage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [docText, setDocText] = useState('');
  const [docName, setDocName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [assignAgentId, setAssignAgentId] = useState('');

  async function load() {
    try {
      const [kbData, agentData] = await Promise.all([api.getKnowledgeBases(), api.getAssistants()]);
      setKbs(kbData.knowledgeBases);
      setAgents(agentData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!newName) return;
    setSaving(true);
    try {
      await api.createKnowledgeBase({ name: newName, description: newDesc });
      setNewName(''); setNewDesc('');
      setShowCreate(false);
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload() {
    if (!selectedKb || !docText || !docName) return;
    setUploading(true);
    try {
      await api.addKbDocument(selectedKb.id, { filename: docName, content: docText });
      setDocText(''); setDocName('');
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  async function handleAssign() {
    if (!selectedKb || !assignAgentId) return;
    try {
      await api.assignKbToAgent(selectedKb.id, assignAgentId);
      setAssignAgentId('');
      load();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this knowledge base?')) return;
    try {
      await api.deleteKnowledgeBase(id);
      if (selectedKb?.id === id) setSelectedKb(null);
      load();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="text-gray-500 mt-1">Add documents your AI agents can search during calls</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Knowledge Base
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Knowledge Base</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input className="input w-full" placeholder="e.g. Clinic FAQ" value={newName}
                  onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <input className="input w-full" placeholder="What this KB contains" value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)} />
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
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* KB List */}
          <div className="space-y-3">
            {kbs.length === 0 ? (
              <div className="card p-8 text-center">
                <div className="text-3xl mb-2">📚</div>
                <p className="text-gray-500 text-sm">No knowledge bases yet</p>
              </div>
            ) : kbs.map((kb) => (
              <div
                key={kb.id}
                onClick={() => setSelectedKb(kb)}
                className={`card p-4 cursor-pointer transition-colors ${selectedKb?.id === kb.id ? 'border-2 border-blue-500' : 'hover:border-gray-300'}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 text-sm">{kb.name}</h3>
                    {kb.description && <p className="text-xs text-gray-500 mt-0.5">{kb.description}</p>}
                    <div className="flex gap-3 mt-2 text-xs text-gray-400">
                      <span>{kb.documentCount} docs</span>
                      <span>{kb.assignedAgentCount} agents</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(kb.id); }}
                    className="text-gray-300 hover:text-red-500 ml-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* KB Detail */}
          {selectedKb ? (
            <div className="lg:col-span-2 space-y-4">
              {/* Add Document */}
              <div className="card p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Add Document to &quot;{selectedKb.name}&quot;</h3>
                <div className="space-y-3">
                  <input
                    className="input w-full"
                    placeholder="Document name (e.g. clinic-faq.txt)"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                  />
                  <textarea
                    className="input w-full h-40 resize-none"
                    placeholder="Paste document content here. The AI will be able to search this during calls..."
                    value={docText}
                    onChange={(e) => setDocText(e.target.value)}
                  />
                  <button onClick={handleUpload} disabled={uploading || !docName || !docText} className="btn-primary">
                    {uploading ? 'Uploading & Embedding...' : 'Upload Document'}
                  </button>
                </div>
              </div>

              {/* Assign to Agent */}
              <div className="card p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Assign to Agent</h3>
                <div className="flex gap-3">
                  <select
                    className="input flex-1"
                    value={assignAgentId}
                    onChange={(e) => setAssignAgentId(e.target.value)}
                  >
                    <option value="">Select agent...</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <button onClick={handleAssign} disabled={!assignAgentId} className="btn-primary">
                    Assign
                  </button>
                </div>
              </div>

              {/* Documents list */}
              {selectedKb.documents && selectedKb.documents.length > 0 && (
                <div className="card p-5">
                  <h3 className="font-semibold text-gray-900 mb-3">Documents ({selectedKb.documents.length})</h3>
                  <div className="space-y-2">
                    {selectedKb.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <div className="text-sm font-medium text-gray-800">{doc.filename}</div>
                          <div className="text-xs text-gray-400">{doc.chunkCount} chunks &bull; {new Date(doc.createdAt).toLocaleDateString()}</div>
                        </div>
                        <button
                          onClick={() => api.deleteKbDocument(selectedKb.id, doc.id).then(load)}
                          className="text-gray-300 hover:text-red-500"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="lg:col-span-2 card p-12 text-center flex items-center justify-center">
              <div>
                <div className="text-4xl mb-3">👈</div>
                <p className="text-gray-500">Select a knowledge base to manage documents</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
