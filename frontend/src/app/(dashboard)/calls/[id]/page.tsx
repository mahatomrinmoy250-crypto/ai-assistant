'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, Call } from '@/lib/api';

export default function CallDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [call, setCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCall(id).then(setCall).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!call) return <div className="p-8 text-gray-500">Call not found</div>;

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/calls" className="text-gray-400 hover:text-gray-600">
          ← Back to Calls
        </Link>
      </div>

      <div className="card p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="Status" value={call.status.replace('_', ' ')} />
          <Stat label="Type" value={call.type} />
          <Stat label="Assistant" value={call.assistant?.name || '—'} />
          <Stat
            label="Duration"
            value={
              call.duration
                ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s`
                : '—'
            }
          />
          <Stat label="From" value={call.fromNumber || '—'} />
          <Stat label="To" value={call.toNumber || '—'} />
          <Stat
            label="Started"
            value={call.startedAt ? new Date(call.startedAt).toLocaleString() : '—'}
          />
          <Stat
            label="Ended"
            value={call.endedAt ? new Date(call.endedAt).toLocaleString() : '—'}
          />
        </div>
      </div>

      {/* Transcript */}
      <div className="card p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Transcript</h2>
        {!call.messages || call.messages.length === 0 ? (
          <p className="text-gray-400 text-sm">No transcript available</p>
        ) : (
          <div className="space-y-3">
            {call.messages
              .filter((m) => m.role !== 'SYSTEM')
              .map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                      msg.role === 'USER'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <div className="text-xs opacity-70 mb-1">
                      {msg.role === 'USER' ? 'Caller' : 'Assistant'} ·{' '}
                      {new Date(msg.timestamp || msg.createdAt).toLocaleTimeString()}
                    </div>
                    {msg.content}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-sm font-medium text-gray-900">{value}</div>
    </div>
  );
}
