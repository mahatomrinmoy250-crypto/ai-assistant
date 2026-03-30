'use client';

import { useEffect, useState } from 'react';
import { api, Assistant, Call } from '@/lib/api';
import Link from 'next/link';

interface Stats {
  assistants: number;
  totalCalls: number;
  activeCalls: number;
  completedCalls: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    assistants: 0,
    totalCalls: 0,
    activeCalls: 0,
    completedCalls: 0,
  });
  const [recentCalls, setRecentCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [assistants, callsData] = await Promise.all([
          api.getAssistants(),
          api.getCalls({ limit: 5 }),
        ]);

        const allCalls = callsData.calls;
        setStats({
          assistants: assistants.length,
          totalCalls: callsData.total,
          activeCalls: allCalls.filter((c) => c.status === 'IN_PROGRESS').length,
          completedCalls: allCalls.filter((c) => c.status === 'COMPLETED').length,
        });
        setRecentCalls(allCalls);
      } catch (err) {
        console.error('Failed to load dashboard:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of your voice AI platform</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Assistants', value: stats.assistants, color: 'bg-blue-50 text-blue-700', icon: '🤖' },
          { label: 'Total Calls', value: stats.totalCalls, color: 'bg-gray-50 text-gray-700', icon: '📞' },
          { label: 'Active Calls', value: stats.activeCalls, color: 'bg-green-50 text-green-700', icon: '🟢' },
          { label: 'Completed', value: stats.completedCalls, color: 'bg-purple-50 text-purple-700', icon: '✅' },
        ].map((stat) => (
          <div key={stat.label} className="card p-6">
            <div className={`text-3xl mb-1`}>{stat.icon}</div>
            <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
            <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link href="/assistants/new" className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-colors group">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200">
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-gray-900 text-sm">Create Assistant</div>
                <div className="text-xs text-gray-500">Build a new voice AI agent</div>
              </div>
            </Link>
            <Link href="/calls" className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-gray-300 hover:border-green-400 hover:bg-green-50 transition-colors group">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-gray-900 text-sm">Make a Call</div>
                <div className="text-xs text-gray-500">Initiate an outbound call</div>
              </div>
            </Link>
          </div>
        </div>

        {/* Recent Calls */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Recent Calls</h2>
            <Link href="/calls" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {recentCalls.length === 0 ? (
            <p className="text-gray-400 text-sm">No calls yet</p>
          ) : (
            <div className="space-y-3">
              {recentCalls.map((call) => (
                <div key={call.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {call.fromNumber || call.toNumber || 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {call.assistant?.name} · {new Date(call.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <CallStatusBadge status={call.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CallStatusBadge({ status }: { status: Call['status'] }) {
  const map: Record<string, string> = {
    COMPLETED: 'badge-green',
    IN_PROGRESS: 'badge-blue',
    FAILED: 'badge-red',
    CANCELED: 'badge-gray',
    QUEUED: 'badge-yellow',
    RINGING: 'badge-yellow',
    BUSY: 'badge-red',
    NO_ANSWER: 'badge-gray',
  };
  return <span className={map[status] || 'badge-gray'}>{status.replace('_', ' ')}</span>;
}
