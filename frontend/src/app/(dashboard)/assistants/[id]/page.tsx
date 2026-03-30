'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, Assistant } from '@/lib/api';
import AssistantForm from '@/components/AssistantForm';

export default function EditAssistantPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAssistant(id).then(setAssistant).finally(() => setFetchLoading(false));
  }, [id]);

  async function handleSubmit(data: Record<string, unknown>) {
    setLoading(true);
    setError('');
    try {
      await api.updateAssistant(id, data);
      router.push('/assistants');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assistant');
    } finally {
      setLoading(false);
    }
  }

  if (fetchLoading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!assistant) {
    return <div className="p-8 text-gray-500">Assistant not found</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Edit Assistant</h1>
        <p className="text-gray-500 mt-1">{assistant.name}</p>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-700 text-sm mb-6">
          {error}
        </div>
      )}
      <AssistantForm
        initialValues={assistant}
        onSubmit={handleSubmit}
        loading={loading}
        submitLabel="Save Changes"
      />
    </div>
  );
}
