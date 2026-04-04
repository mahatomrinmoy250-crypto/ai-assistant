'use client';

import { useEffect, useState, useRef } from 'react';
import { api, ContactList, Contact } from '@/lib/api';

export default function ContactListsPage() {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ContactList | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [addingManual, setAddingManual] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const data = await api.getContactLists();
      setLists(data.contactLists);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadContacts(listId: string) {
    try {
      const data = await api.getContactList(listId);
      setContacts(data.contacts || []);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (selected) loadContacts(selected.id);
  }, [selected]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.createContactList(newName.trim());
      setNewName('');
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this contact list and all its contacts?')) return;
    try {
      await api.deleteContactList(id);
      if (selected?.id === id) setSelected(null);
      load();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAddManual() {
    if (!selected || !manualPhone.trim()) return;
    setAddingManual(true);
    try {
      await api.bulkUploadContacts(selected.id, [
        { phoneNumber: manualPhone.trim(), name: manualName.trim() || undefined },
      ]);
      setManualPhone('');
      setManualName('');
      loadContacts(selected.id);
      load();
    } catch (err) {
      console.error(err);
    } finally {
      setAddingManual(false);
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setUploading(true);
    setUploadError('');
    setUploadResult(null);

    try {
      const text = await file.text();
      const lines = text.trim().split('\n').filter(Boolean);

      // Detect header row
      const firstLine = lines[0].toLowerCase();
      const hasHeader = firstLine.includes('phone') || firstLine.includes('mobile') || firstLine.includes('number');
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const contacts: { phoneNumber: string; name?: string; email?: string }[] = [];

      for (const line of dataLines) {
        // Support comma and semicolon delimiters
        const cols = line.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
        const phone = cols[0];
        if (!phone) continue;
        contacts.push({
          phoneNumber: phone,
          name: cols[1] || undefined,
          email: cols[2] || undefined,
        });
      }

      if (contacts.length === 0) {
        setUploadError('No valid contacts found. CSV format: phone, name (optional), email (optional)');
        return;
      }

      // Upload in batches of 500
      let totalInserted = 0;
      for (let i = 0; i < contacts.length; i += 500) {
        const batch = contacts.slice(i, i + 500);
        const res = await api.bulkUploadContacts(selected.id, batch);
        totalInserted += res.inserted;
      }

      setUploadResult({ inserted: totalInserted, total: contacts.length });
      loadContacts(selected.id);
      load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Contact Lists</h1>
        <p className="text-gray-500 mt-1">Manage phone number lists for outbound campaigns</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: List of contact lists */}
        <div className="space-y-3">
          {/* Create new */}
          <div className="card p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">New Contact List</p>
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="e.g. Doctor Campaign May"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <button onClick={handleCreate} disabled={creating || !newName.trim()} className="btn-primary text-sm px-3">
                {creating ? '...' : 'Create'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : lists.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-gray-500 text-sm">No contact lists yet</p>
            </div>
          ) : (
            lists.map((list) => (
              <div
                key={list.id}
                onClick={() => setSelected(list)}
                className={`card p-4 cursor-pointer transition-colors ${selected?.id === list.id ? 'border-2 border-blue-500' : 'hover:border-gray-300'}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{list.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{list.contactCount} contacts</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(list.id); }}
                    className="text-gray-300 hover:text-red-500"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: Contact list detail */}
        {selected ? (
          <div className="lg:col-span-2 space-y-4">
            {/* CSV Upload */}
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Upload CSV</h3>
              <p className="text-xs text-gray-500 mb-3">
                Format: <code className="bg-gray-100 px-1 rounded">phone, name (optional), email (optional)</code> — one per line. Header row auto-detected.
              </p>
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleCsvUpload}
                  disabled={uploading}
                  className="block text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
                {uploading && (
                  <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                )}
              </div>
              {uploadResult && (
                <div className="mt-3 p-3 bg-green-50 rounded-lg text-sm text-green-700">
                  Uploaded {uploadResult.inserted} of {uploadResult.total} contacts successfully.
                </div>
              )}
              {uploadError && (
                <div className="mt-3 p-3 bg-red-50 rounded-lg text-sm text-red-600">{uploadError}</div>
              )}
            </div>

            {/* Manual add */}
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Add Contact Manually</h3>
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder="+91 98765 43210"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                />
                <input
                  className="input w-40 text-sm"
                  placeholder="Name (optional)"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddManual()}
                />
                <button
                  onClick={handleAddManual}
                  disabled={addingManual || !manualPhone.trim()}
                  className="btn-primary text-sm"
                >
                  {addingManual ? '...' : 'Add'}
                </button>
              </div>
            </div>

            {/* Contacts table */}
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">
                  Contacts ({selected.contactCount})
                </h3>
              </div>
              {contacts.length === 0 ? (
                <div className="p-10 text-center text-gray-400 text-sm">
                  No contacts yet — upload a CSV or add manually
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {['Phone', 'Name', 'Email', 'Added'].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {contacts.slice(0, 200).map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-mono text-gray-800">{c.phoneNumber}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{c.name || '—'}</td>
                        <td className="px-4 py-2 text-sm text-gray-400">{c.email || '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {contacts.length > 200 && (
                <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                  Showing first 200 of {contacts.length} contacts
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 card p-12 text-center flex items-center justify-center">
            <div>
              <div className="text-4xl mb-3">👈</div>
              <p className="text-gray-500">Select a contact list to manage contacts</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
