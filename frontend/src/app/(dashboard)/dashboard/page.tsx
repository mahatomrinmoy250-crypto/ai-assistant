'use client';

import { useEffect, useState } from 'react';
import { api, Call } from '@/lib/api';
import Link from 'next/link';

interface Stats {
  agents: number;
  totalCalls: number;
  activeCalls: number;
  completedCalls: number;
  totalBookings: number;
  runningCampaigns: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    agents: 0,
    totalCalls: 0,
    activeCalls: 0,
    completedCalls: 0,
    totalBookings: 0,
    runningCampaigns: 0,
  });
  const [recentCalls, setRecentCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [agents, callsData, bookingsData, campaignsData] = await Promise.all([
          api.getAssistants(),
          api.getCalls({ limit: 5 }),
          api.getBookings(),
          api.getCampaigns(),
        ]);

        const allCalls = callsData.calls;
        setStats({
          agents: agents.length,
          totalCalls: callsData.total,
          activeCalls: allCalls.filter((c) => c.status === 'IN_PROGRESS').length,
          completedCalls: allCalls.filter((c) => c.status === 'COMPLETED').length,
          totalBookings: bookingsData.total,
          runningCampaigns: campaignsData.campaigns.filter((c) => c.status === 'running').length,
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {[
          { label: 'Agents', value: stats.agents, color: 'bg-blue-50 text-blue-700', icon: '🤖', href: '/assistants' },
          { label: 'Total Calls', value: stats.totalCalls, color: 'bg-gray-50 text-gray-700', icon: '📞', href: '/calls' },
          { label: 'Active Calls', value: stats.activeCalls, color: 'bg-green-50 text-green-700', icon: '🟢', href: '/calls' },
          { label: 'Completed', value: stats.completedCalls, color: 'bg-purple-50 text-purple-700', icon: '✅', href: '/calls' },
          { label: 'Bookings', value: stats.totalBookings, color: 'bg-pink-50 text-pink-700', icon: '📅', href: '/bookings' },
          { label: 'Campaigns', value: stats.runningCampaigns, color: 'bg-orange-50 text-orange-700', icon: '📣', href: '/campaigns' },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href} className="card p-5 hover:shadow-md transition-shadow">
            <div className="text-2xl mb-1">{stat.icon}</div>
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
          </Link>
        ))}
      </div>

      {/* Quick Actions + Recent Calls */}
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
                <div className="font-medium text-gray-900 text-sm">Create Agent</div>
                <div className="text-xs text-gray-500">Build a new voice AI agent</div>
              </div>
            </Link>
            <Link href="/campaigns" className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-gray-300 hover:border-purple-400 hover:bg-purple-50 transition-colors group">
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200">
                <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-gray-900 text-sm">Launch Campaign</div>
                <div className="text-xs text-gray-500">Bulk outbound calling</div>
              </div>
            </Link>
            <Link href="/knowledge-bases" className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-gray-300 hover:border-green-400 hover:bg-green-50 transition-colors group">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-gray-900 text-sm">Add Knowledge Base</div>
                <div className="text-xs text-gray-500">Upload docs for your agents</div>
              </div>
            </Link>
            <Link href="/bookings" className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-gray-300 hover:border-pink-400 hover:bg-pink-50 transition-colors group">
              <div className="w-8 h-8 bg-pink-100 rounded-lg flex items-center justify-center group-hover:bg-pink-200">
                <svg className="w-4 h-4 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-gray-900 text-sm">View Bookings</div>
                <div className="text-xs text-gray-500">Appointments booked by agents</div>
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
                      {call.fromNumber || call.toNumber || call.phoneNumber || 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {call.agent?.name} · {new Date(call.createdAt).toLocaleDateString()}
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

function CallStatusBadge({ status }: { status: string }) {
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
