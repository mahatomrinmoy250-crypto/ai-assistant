'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import AssistantForm from '@/components/AssistantForm';

export default function NewAssistantPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(data: Record<string, unknown>) {
    setLoading(true);
    setError('');
    try {
      await api.createAssistant(data);
      router.push('/assistants');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assistant');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Create Assistant</h1>
        <p className="text-gray-500 mt-1">Configure your voice AI agent</p>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-700 text-sm mb-6">
          {error}
        </div>
      )}
      <AssistantForm onSubmit={handleSubmit} loading={loading} />
    </div>
  );
}
