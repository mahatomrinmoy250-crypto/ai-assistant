'use client';

import { useEffect, useState } from 'react';
import { api, Booking } from '@/lib/api';

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ date: '', status: '' });
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getBookings({
        date: filters.date || undefined,
        status: filters.status || undefined,
      });
      setBookings(data.bookings);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filters]);

  async function handleExport() {
    setExporting(true);
    try {
      const url = api.exportBookingsCsv({ date: filters.date || undefined, status: filters.status || undefined });
      const token = localStorage.getItem('token');
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bookings-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await api.updateBooking(id, { status });
      load();
    } catch (err) {
      console.error(err);
    }
  }

  const statusColor: Record<string, string> = {
    confirmed: 'badge-green',
    cancelled: 'badge-red',
    completed: 'badge-blue',
    pending: 'badge-yellow',
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
          <p className="text-gray-500 mt-1">Appointments booked by your AI agents</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-secondary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6 flex gap-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">Filter by Date</label>
          <input
            type="date"
            value={filters.date}
            onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))}
            className="input w-full"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">Filter by Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="input w-full"
          >
            <option value="">All Statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={() => setFilters({ date: '', status: '' })} className="btn-secondary">
            Clear
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : bookings.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📅</div>
          <h3 className="font-semibold text-gray-900 mb-1">No bookings yet</h3>
          <p className="text-gray-500 text-sm">Bookings will appear here when your AI agents schedule appointments</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Patient', 'Phone', 'Date', 'Time', 'Agent', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{b.patientName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{b.patientPhone || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{b.appointmentDate || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{b.appointmentTime || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{b.agent?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={statusColor[b.status] || 'badge-gray'}>{b.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={b.status}
                      onChange={(e) => handleStatusChange(b.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600"
                    >
                      <option value="confirmed">Confirmed</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="pending">Pending</option>
                    </select>
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
