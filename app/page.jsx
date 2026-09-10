'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, Search, Plus, ArrowLeft, Download, FileText, Table, 
  MessageCircle, Copy, ExternalLink, RefreshCw, CheckCircle2, 
  AlertCircle, Building2, Phone, Star, Mail, Globe, Users, 
  Calendar, Layers, Inbox, StopCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

export default function Dashboard() {
  // Navigation & View State
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'detail'
  const [selectedSession, setSelectedSession] = useState(null);

  // Form Inputs
  const [niche, setNiche] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState('20');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState('');

  // Data
  const [stats, setStats] = useState({
    total_leads: 0,
    total_sessions: 0,
    total_niches: 0,
    leads_with_phone: 0,
  });
  const [sessions, setSessions] = useState([]);
  const [sessionLeads, setSessionLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(false);

  // Search & Filter
  const [historySearch, setHistorySearch] = useState('');
  const [leadsFilter, setLeadsFilter] = useState('');

  // Toast
  const [toast, setToast] = useState(null);
  const formRef = useRef(null);
  const nicheInputRef = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3200);
  };

  // Load Dashboard Data
  const loadDashboard = async () => {
    try {
      const [statsRes, sessRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/sessions'),
      ]);
      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s);
      }
      if (sessRes.ok) {
        const d = await sessRes.json();
        setSessions(d.sessions || []);
      }
    } catch (err) {
      console.error('Error loading dashboard:', err);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  // Quick Niche Fill
  const setQuickNiche = (n, loc) => {
    setNiche(n);
    setLocation(loc);
    if (nicheInputRef.current) nicheInputRef.current.focus();
  };

  // Focus Form
  const focusForm = () => {
    setView('dashboard');
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      formRef.current.classList.remove('highlight-pulse');
      void formRef.current.offsetWidth;
      formRef.current.classList.add('highlight-pulse');
    }
    if (nicheInputRef.current) {
      setTimeout(() => nicheInputRef.current.focus(), 250);
    }
  };

  // Handle Extraction Submit
  const handleExtract = async (e) => {
    if (e) e.preventDefault();
    if (!niche.trim()) {
      showToast('Please enter a business niche / category', 'error');
      return;
    }

    setIsExtracting(true);
    setExtractStatus(`Searching Google business data for "${niche}" in "${location || 'India'}"...`);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          niche: niche.trim(),
          location: location.trim(),
          max_results: parseInt(maxResults, 10),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Extraction failed');
      }

      showToast(`Extraction complete! ${data.new_count || 0} new leads saved.`);
      setExtractStatus(`Finished! Added ${data.new_count || 0} new leads (${data.skipped_count || 0} duplicate skipped).`);
      
      // Refresh dashboard and open session
      await loadDashboard();
      if (data.session_id) {
        openSession({
          session_id: data.session_id,
          niche,
          location,
          new_count: data.new_count,
          skipped_count: data.skipped_count,
          created_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      showToast(err.message, 'error');
      setExtractStatus(`Error: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  // Open Session Leads Drill-Down
  const openSession = async (sess) => {
    setSelectedSession(sess);
    setView('detail');
    setLoadingLeads(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const res = await fetch(`/api/leads?session_id=${encodeURIComponent(sess.session_id)}`);
      if (res.ok) {
        const d = await res.json();
        setSessionLeads(d.leads || []);
      }
    } catch (err) {
      showToast('Could not load session leads', 'error');
    } finally {
      setLoadingLeads(false);
    }
  };

  // Copy to Clipboard
  const copyText = (text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast('Copied to clipboard!');
    }
  };

  // Export CSV
  const exportCsv = () => {
    if (!sessionLeads.length) return;
    const headers = ['Business Name', 'Rating', 'Reviews', 'Phone', 'WhatsApp', 'Email', 'Website', 'Address'];
    const rows = sessionLeads.map(l => [
      `"${(l.name || '').replace(/"/g, '""')}"`,
      l.rating || 0,
      l.reviews_count || 0,
      `"${l.phone || ''}"`,
      `"${l.whatsapp || ''}"`,
      `"${l.email || ''}"`,
      `"${l.website || ''}"`,
      `"${(l.address || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Leads_${selectedSession?.niche || 'Export'}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV downloaded!');
  };

  // Export Excel (.xlsx)
  const exportExcel = () => {
    if (!sessionLeads.length) return;
    const data = sessionLeads.map((l, i) => ({
      '#': i + 1,
      'Business Name': l.name || '',
      'Rating': l.rating || 0,
      'Reviews': l.reviews_count || 0,
      'Phone': l.phone || '',
      'WhatsApp': l.whatsapp ? `+${l.whatsapp}` : '',
      'Email': l.email || '',
      'Website': l.website || '',
      'Address': l.address || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    XLSX.writeFile(wb, `Leads_${selectedSession?.niche || 'Export'}_${Date.now()}.xlsx`);
    showToast('Excel downloaded!');
  };

  // Export PDF
  const exportPdf = () => {
    if (!sessionLeads.length) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    doc.setFontSize(14);
    doc.text(`Google Maps Leads: ${selectedSession?.niche || 'Report'} (${selectedSession?.location || 'All'})`, 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString()} | Total Leads: ${sessionLeads.length}`, 40, 58);

    const tableHeaders = [['#', 'Business Name', 'Rating', 'Phone', 'WhatsApp', 'Email', 'Address']];
    const tableData = sessionLeads.map((l, i) => [
      i + 1,
      l.name || '—',
      l.rating ? `★ ${l.rating}` : '—',
      l.phone || '—',
      l.whatsapp ? `+${l.whatsapp}` : '—',
      l.email || '—',
      l.address ? l.address.substring(0, 50) : '—',
    ]);

    doc.autoTable({
      head: tableHeaders,
      body: tableData,
      startY: 70,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
    });

    doc.save(`Leads_${selectedSession?.niche || 'Export'}_${Date.now()}.pdf`);
    showToast('PDF downloaded!');
  };

  // Filtered lists
  const filteredSessions = sessions.filter(s => {
    const q = historySearch.toLowerCase();
    return (s.niche || '').toLowerCase().includes(q) || 
           (s.location || '').toLowerCase().includes(q) ||
           (s.created_at || '').toLowerCase().includes(q);
  });

  const filteredLeads = sessionLeads.filter(l => {
    const q = leadsFilter.toLowerCase();
    return (l.name || '').toLowerCase().includes(q) ||
           (l.phone || '').toLowerCase().includes(q) ||
           (l.email || '').toLowerCase().includes(q) ||
           (l.address || '').toLowerCase().includes(q);
  });

  return (
    <>
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('dashboard')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-md">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">G-Map Data Extractor Pro</h1>
              <p className="text-xs text-slate-400">Next.js SaaS · AI Grounded Search · Smart Deduplication</p>
            </div>
          </div>

          <button
            type="button"
            onClick={focusForm}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 shadow-md shadow-indigo-100 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Extraction
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">

        {view === 'dashboard' ? (
          /* ================= DASHBOARD VIEW ================= */
          <section className="space-y-6">

            {/* 1. Extraction Form Card */}
            <div ref={formRef} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300">
              <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 to-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                    <Search className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Start New Lead Extraction</h2>
                    <p className="text-xs text-slate-500">Already extracted businesses are automatically skipped (Zero Duplicates)</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleExtract} className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
                  {/* Niche Input */}
                  <div className="md:col-span-5">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Niche / Business Category <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <Building2 className="w-4 h-4" />
                      </span>
                      <input
                        ref={nicheInputRef}
                        type="text"
                        required
                        value={niche}
                        onChange={(e) => setNiche(e.target.value)}
                        placeholder="e.g. Dentists, Gyms, Real Estate, Hotels, Cafes"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-slate-50/50 hover:bg-white transition-all"
                      />
                    </div>
                  </div>

                  {/* Location Input */}
                  <div className="md:col-span-4">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      City / Location
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <MapPin className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. Delhi, Mumbai, Sector 62 Noida"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-slate-50/50 hover:bg-white transition-all"
                      />
                    </div>
                  </div>

                  {/* Max Results */}
                  <div className="md:col-span-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Max Leads
                    </label>
                    <select
                      value={maxResults}
                      onChange={(e) => setMaxResults(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-medium text-slate-700"
                    >
                      <option value="10">10 leads</option>
                      <option value="20">20 leads</option>
                      <option value="50">50 leads</option>
                      <option value="100">100 leads</option>
                    </select>
                  </div>
                </div>

                {/* Quick Suggestions & Submit Button */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-slate-400 font-medium">Quick:</span>
                    <button type="button" onClick={() => setQuickNiche('Dentists', 'Delhi')} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-xs text-slate-600 font-medium transition-colors">Dentists in Delhi</button>
                    <button type="button" onClick={() => setQuickNiche('Gym', 'Mumbai')} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-xs text-slate-600 font-medium transition-colors">Gym in Mumbai</button>
                    <button type="button" onClick={() => setQuickNiche('Hotels', 'Jaipur')} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-xs text-slate-600 font-medium transition-colors">Hotels in Jaipur</button>
                    <button type="button" onClick={() => setQuickNiche('Real Estate', 'Noida')} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-xs text-slate-600 font-medium transition-colors">Real Estate in Noida</button>
                  </div>

                  <button
                    type="submit"
                    disabled={isExtracting}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-60 shadow-md shadow-indigo-100 transition-all cursor-pointer"
                  >
                    {isExtracting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Extracting Leads...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        Start Extraction
                      </>
                    )}
                  </button>
                </div>

                {/* Live Progress Banner */}
                {isExtracting && (
                  <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-100 transition-all">
                    <div className="flex items-center gap-2.5 text-indigo-900 text-xs font-semibold">
                      <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <span>{extractStatus}</span>
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* 2. KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">{stats.total_sessions}</div>
                  <div className="text-xs text-slate-500">Total Extractions</div>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">{stats.total_leads}</div>
                  <div className="text-xs text-slate-500">Total Unique Leads</div>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">{stats.total_niches}</div>
                  <div className="text-xs text-slate-500">Niches Tracked</div>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">{stats.leads_with_phone}</div>
                  <div className="text-xs text-slate-500">Verified Phones</div>
                </div>
              </div>
            </div>

            {/* 3. Extraction History Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    Extraction History (Date-wise)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Click any row to open and view leads</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search history..."
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-400 outline-none w-48"
                    />
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400 pointer-events-none" />
                  </div>
                  <button
                    onClick={loadDashboard}
                    title="Refresh"
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Date & Time</th>
                      <th className="py-3 px-4">Niche / Keyword</th>
                      <th className="py-3 px-4">Location</th>
                      <th className="py-3 px-4 text-center">New Leads</th>
                      <th className="py-3 px-4 text-center">Skipped</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-2 text-slate-400">
                            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                              <Inbox className="w-6 h-6 text-slate-400" />
                            </div>
                            <p className="text-sm font-medium text-slate-600">No extractions found</p>
                            <p className="text-xs">Enter a niche above and click "Start Extraction"</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredSessions.map((sess) => {
                        const dateStr = sess.created_at 
                          ? new Date(sess.created_at).toLocaleString('en-IN', {
                              day: '2-digit', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit', hour12: true
                            })
                          : '—';

                        return (
                          <tr
                            key={sess.session_id}
                            onClick={() => openSession(sess)}
                            className="hover:bg-indigo-50/50 cursor-pointer transition-colors group"
                          >
                            <td className="py-3.5 px-4 text-sm font-medium text-slate-700 whitespace-nowrap">{dateStr}</td>
                            <td className="py-3.5 px-4 font-semibold text-indigo-700 text-sm">{sess.niche || '—'}</td>
                            <td className="py-3.5 px-4 text-slate-500 text-sm">{sess.location || '—'}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                +{sess.new_count || 0}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                                {sess.skipped_count || 0}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                                Completed
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 group-hover:shadow-md transition-all"
                              >
                                View Leads
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-400">
                Showing {filteredSessions.length} extraction{filteredSessions.length !== 1 ? 's' : ''}
              </div>
            </div>

          </section>
        ) : (
          /* ================= LEADS DETAIL VIEW ================= */
          <section className="space-y-5">
            {/* Top Bar with Back & Downloads */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setView('dashboard')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-all cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Dashboard
                </button>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {selectedSession?.niche || 'Leads'} {selectedSession?.location ? `(${selectedSession.location})` : ''}
                  </h2>
                  <p className="text-xs text-slate-500">
                    New Leads: {selectedSession?.new_count || 0} · Duplicates Skipped: {selectedSession?.skipped_count || 0}
                  </p>
                </div>
              </div>

              {/* Direct Download Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportCsv}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 shadow-sm transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4 text-slate-600" />
                  Download CSV
                </button>

                <button
                  type="button"
                  onClick={exportExcel}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all cursor-pointer"
                >
                  <Table className="w-4 h-4" />
                  Download Excel
                </button>

                <button
                  type="button"
                  onClick={exportPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition-all cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  Download PDF
                </button>
              </div>
            </div>

            {/* Leads Table Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-700">Extracted Leads</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-100">
                    {sessionLeads.length}
                  </span>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Filter by name, phone, address..."
                    value={leadsFilter}
                    onChange={(e) => setLeadsFilter(e.target.value)}
                    className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-400 outline-none w-64"
                  />
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-3 w-10 text-center">#</th>
                      <th className="py-3 px-4 min-w-[200px]">Business Name</th>
                      <th className="py-3 px-3 min-w-[120px]">Rating</th>
                      <th className="py-3 px-4 min-w-[150px]">Phone</th>
                      <th className="py-3 px-4 min-w-[160px]">WhatsApp</th>
                      <th className="py-3 px-4 min-w-[180px]">Email</th>
                      <th className="py-3 px-4 min-w-[140px]">Website</th>
                      <th className="py-3 px-4 min-w-[240px]">Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingLeads ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          <div className="flex items-center justify-center gap-2 text-sm">
                            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                            Loading leads...
                          </div>
                        </td>
                      </tr>
                    ) : filteredLeads.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                          No leads found.
                        </td>
                      </tr>
                    ) : (
                      filteredLeads.map((lead, idx) => (
                        <tr key={lead.id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-3 text-center text-xs text-slate-400 font-medium">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                              {lead.name || '—'}
                              {lead.map_url && (
                                <a
                                  href={lead.map_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-300 hover:text-indigo-600"
                                  title="View on Google Maps"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">{lead.niche}</div>
                          </td>

                          {/* Rating */}
                          <td className="py-3 px-3 whitespace-nowrap">
                            {lead.rating && lead.rating > 0 ? (
                              <div>
                                <span className="text-xs font-bold text-amber-600">★ {lead.rating}</span>
                                <span className="text-[11px] text-slate-400 ml-1">({lead.reviews_count || 0})</span>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>

                          {/* Phone */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            {lead.phone ? (
                              <div className="flex items-center gap-1">
                                <a href={`tel:${lead.phone}`} className="text-xs font-medium text-slate-800 hover:text-indigo-600">
                                  {lead.phone}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => copyText(lead.phone)}
                                  className="text-slate-300 hover:text-slate-600 p-0.5 cursor-pointer"
                                  title="Copy phone"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>

                          {/* WhatsApp */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            {lead.whatsapp ? (
                              <a
                                href={`https://api.whatsapp.com/send?phone=${lead.whatsapp}&text=${encodeURIComponent('Hello, I found your business details on Google Maps.')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                +{lead.whatsapp}
                              </a>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>

                          {/* Email */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            {lead.email ? (
                              <div className="flex items-center gap-1">
                                <a href={`mailto:${lead.email}`} className="text-xs text-indigo-600 hover:underline truncate max-w-[150px]">
                                  {lead.email}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => copyText(lead.email)}
                                  className="text-slate-300 hover:text-slate-600 p-0.5 cursor-pointer"
                                  title="Copy email"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>

                          {/* Website */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            {lead.website ? (
                              <a
                                href={lead.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                              >
                                <Globe className="w-3 h-3 flex-shrink-0" />
                                {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 22)}
                              </a>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>

                          {/* Address */}
                          <td className="py-3 px-4">
                            <div className="text-xs text-slate-500 line-clamp-2">{lead.address || '—'}</div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-400 flex items-center justify-between">
                <span>{filteredLeads.length} entries</span>
                <span className="text-emerald-600 font-medium">WhatsApp Direct Chat Enabled ✓</span>
              </div>
            </div>
          </section>
        )}

      </main>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 transition-all duration-300">
          <div className={`px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border text-xs text-white ${
            toast.type === 'error' ? 'bg-rose-900 border-rose-700' : 'bg-slate-900 border-slate-800'
          }`}>
            {toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </>
  );
}
