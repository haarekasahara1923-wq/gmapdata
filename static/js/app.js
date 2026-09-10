// Google Maps Data Extractor SaaS — Dashboard & Extraction Controller

// ── State ────────────────────────────────────────────────
let currentSessionId   = null;
let currentSessionData = null;
let allSessions        = [];
let sessionLeads       = [];
let isExtracting       = false;
let eventSource        = null;

// ── Global Functions (Exposed on window for inline HTML handlers) ───

window.focusExtractionForm = function() {
    // Switch to dashboard view if currently viewing leads
    window.showDashboard();

    const card = document.getElementById('extractionCard');
    const input = document.getElementById('nicheInput');

    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.remove('highlight-pulse');
        // Trigger reflow for animation restart
        void card.offsetWidth;
        card.classList.add('highlight-pulse');
    }
    if (input) {
        setTimeout(() => input.focus(), 300);
    }
};

window.setQuickNiche = function(niche, location) {
    const nInput = document.getElementById('nicheInput');
    const lInput = document.getElementById('locationInput');
    if (nInput) nInput.value = niche;
    if (lInput) lInput.value = location;
    if (nInput) nInput.focus();
};

window.showDashboard = function() {
    const dash = document.getElementById('dashboardView');
    const detail = document.getElementById('leadsDetailView');
    if (dash) dash.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.handleExtractSubmit = async function(e) {
    if (e && e.preventDefault) e.preventDefault();

    const nInput = document.getElementById('nicheInput');
    const lInput = document.getElementById('locationInput');
    const mSelect = document.getElementById('maxSelect');

    const niche = nInput ? nInput.value.trim() : '';
    const location = lInput ? lInput.value.trim() : '';
    const max_results = mSelect ? parseInt(mSelect.value, 10) : 50;
    const showBrowser = document.getElementById('showBrowserCheck')?.checked ?? true;
    const headless = !showBrowser;

    if (!niche) {
        window.showToast('Please enter a business niche or category', 'error');
        if (nInput) nInput.focus();
        return;
    }

    setExtractingUI(true);

    const banner = document.getElementById('statusBanner');
    const statusText = document.getElementById('statusText');
    const newCount = document.getElementById('newCount');
    const skippedCount = document.getElementById('skippedCount');

    if (banner) banner.classList.remove('hidden');
    if (statusText) statusText.innerText = `Launching browser for "${niche}" in "${location || 'All'}"...`;
    if (newCount) newCount.innerText = '0';
    if (skippedCount) skippedCount.innerText = '0';

    try {
        const resp = await fetch('/api/extract/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ niche, location, max_results, headless })
        });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || 'Failed to start extraction');
        }
        currentSessionId = data.session_id;
        window.showToast('Extraction started! Opening Google Maps...');
        initSSE();
        startStatusPolling();
    } catch (err) {
        setExtractingUI(false);
        stopStatusPolling();
        window.showToast(err.message || 'Error starting extraction', 'error');
        if (statusText) statusText.innerText = 'Error starting extraction.';
    }
};

let statusPollingTimer = null;

function startStatusPolling() {
    stopStatusPolling();
    statusPollingTimer = setInterval(async () => {
        if (!isExtracting) {
            stopStatusPolling();
            return;
        }
        try {
            const res = await fetch('/api/extract/status');
            if (res.ok) {
                const s = await res.json();
                const statusText = document.getElementById('statusText');
                const newCount = document.getElementById('newCount');
                const skippedCount = document.getElementById('skippedCount');
                if (newCount && s.new_count !== undefined) newCount.innerText = s.new_count;
                if (skippedCount && s.skipped_count !== undefined) skippedCount.innerText = s.skipped_count;
                if (statusText && s.current_item) statusText.innerText = s.current_item;

                if (s.status === 'completed' || s.status === 'stopped' || s.status === 'error') {
                    stopStatusPolling();
                    setExtractingUI(false);
                    if (statusText) statusText.innerText = `Extraction ${s.status}!`;
                    window.showToast(`Extraction ${s.status}!`);
                    setTimeout(async () => {
                        await window.loadDashboard();
                        if (s.session_id) openSessionById(s.session_id);
                    }, 1200);
                }
            }
        } catch (_) {}
    }, 1500);
}

function stopStatusPolling() {
    if (statusPollingTimer) {
        clearInterval(statusPollingTimer);
        statusPollingTimer = null;
    }
}

window.handleStopExtract = async function() {
    const stopBtn = document.getElementById('stopExtractBtn');
    const statusText = document.getElementById('statusText');
    if (stopBtn) stopBtn.disabled = true;
    if (statusText) statusText.innerText = 'Sending stop request...';

    try {
        await fetch('/api/extract/stop', { method: 'POST' });
        window.showToast('Stop signal sent. Finishing current item...');
    } catch (e) {
        console.error(e);
    }
};

window.downloadSessionExport = function(format) {
    if (!currentSessionId) {
        window.showToast('No active session selected', 'error');
        return;
    }
    if (format === 'pdf' && currentSessionData && currentSessionData.pdf_cloudinary_url) {
        window.open(currentSessionData.pdf_cloudinary_url, '_blank');
        return;
    }
    window.location.href = `/api/export/${format}?session_id=${encodeURIComponent(currentSessionId)}`;
};

window.copyText = function(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => window.showToast('Copied to clipboard!'));
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        window.showToast('Copied to clipboard!');
    }
};

window.showToast = function(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    const container = document.getElementById('toastContainer');
    if (!toast || !toastMsg) return;

    toastMsg.innerText = msg;
    if (container) {
        if (type === 'error') {
            container.className = 'bg-rose-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-rose-700';
        } else {
            container.className = 'bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-slate-800';
        }
    }

    toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
    toast.classList.add('opacity-100', 'translate-y-0');

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
        toast.classList.remove('opacity-100', 'translate-y-0');
    }, 3200);
};

// ── UI Helpers ───────────────────────────────────────────

function setExtractingUI(on) {
    isExtracting = on;
    const startBtn = document.getElementById('startExtractBtn');
    const stopBtn = document.getElementById('stopExtractBtn');

    if (startBtn) {
        startBtn.disabled = on;
        if (on) {
            startBtn.classList.add('opacity-60', 'cursor-not-allowed');
            startBtn.innerHTML = `
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Extracting...
            `;
        } else {
            startBtn.classList.remove('opacity-60', 'cursor-not-allowed');
            startBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                Start Extraction
            `;
        }
    }

    if (stopBtn) {
        stopBtn.disabled = !on;
    }
}

// ── SSE Event Stream ─────────────────────────────────────

function initSSE() {
    if (eventSource) {
        eventSource.close();
    }
    eventSource = new EventSource('/api/extract/stream');

    eventSource.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            handleSSEMessage(msg);
        } catch (_) {}
    };

    eventSource.onerror = () => {
        // Silent reconnect
    };
}

function handleSSEMessage(msg) {
    if (!msg || !msg.event) return;

    const statusText = document.getElementById('statusText');
    const newCount = document.getElementById('newCount');
    const skippedCount = document.getElementById('skippedCount');

    if (msg.event === 'status_update') {
        const text = msg.data?.message || msg.current_item || '';
        if (statusText && text) statusText.innerText = text;

    } else if (msg.event === 'new_lead') {
        if (newCount) newCount.innerText = msg.new_count || 0;
        const name = msg.data?.name || '';
        if (statusText) statusText.innerText = `Extracted: ${name}`;

    } else if (msg.event === 'lead_skipped') {
        if (skippedCount) skippedCount.innerText = msg.skipped_count || 0;
        const name = msg.data?.name || '';
        if (statusText) statusText.innerText = `Skipped (Duplicate): ${name}`;

    } else if (msg.event === 'extracting_lead') {
        const name = msg.data?.name || '';
        if (statusText) statusText.innerText = `🔍 Reading details: ${name}...`;

    } else if (msg.event === 'completed' || msg.event === 'stopped') {
        setExtractingUI(false);
        stopStatusPolling();
        const finalNew = msg.new_count || (newCount ? newCount.innerText : 0);
        const finalSkip = msg.skipped_count || (skippedCount ? skippedCount.innerText : 0);
        if (statusText) {
            statusText.innerText = `Extraction ${msg.event}! ${finalNew} new leads saved, ${finalSkip} duplicates skipped.`;
        }
        window.showToast(`Extraction ${msg.event}! ${finalNew} new leads added.`);

        // Refresh dashboard and open session
        setTimeout(async () => {
            await window.loadDashboard();
            if (currentSessionId) {
                openSessionById(currentSessionId);
            }
        }, 1200);

    } else if (msg.event === 'error') {
        setExtractingUI(false);
        stopStatusPolling();
        const err = msg.data?.error || 'Extraction encountered an error.';
        if (statusText) statusText.innerText = `Error: ${err}`;
        window.showToast(err, 'error');
    }
}

// ── Dashboard Data Loader ────────────────────────────────

window.loadDashboard = async function() {
    try {
        const [statsResp, sessResp] = await Promise.all([
            fetch('/api/stats'),
            fetch('/api/sessions?limit=100')
        ]);
        const stats = await statsResp.json();
        const sessData = await sessResp.json();

        // Update KPIs
        const sSess = document.getElementById('dashTotalSessions');
        const sLeads = document.getElementById('dashTotalLeads');
        const sNiches = document.getElementById('dashTotalNiches');
        const sPhones = document.getElementById('dashTotalPhones');

        if (sSess) sSess.innerText = stats.total_sessions || 0;
        if (sLeads) sLeads.innerText = stats.total_leads || 0;
        if (sNiches) sNiches.innerText = stats.total_niches || 0;
        if (sPhones) sPhones.innerText = stats.leads_with_phone || 0;

        allSessions = sessData.sessions || [];
        renderHistoryTable(allSessions);
    } catch (e) {
        console.error('Failed to load dashboard:', e);
    }
};

function renderHistoryTable(sessions) {
    const tbody = document.getElementById('historyTableBody');
    const countInfo = document.getElementById('historyCountInfo');
    const emptyRow = document.getElementById('emptyHistoryRow');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (countInfo) {
        countInfo.innerText = `Showing ${sessions.length} extraction${sessions.length !== 1 ? 's' : ''}`;
    }

    if (!sessions || sessions.length === 0) {
        if (emptyRow) {
            tbody.appendChild(emptyRow);
        } else {
            tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400">No extractions recorded yet.</td></tr>`;
        }
        return;
    }

    sessions.forEach(sess => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-indigo-50/50 cursor-pointer transition-colors group';

        let dateStr = sess.created_at || '—';
        try {
            const d = new Date(sess.created_at);
            if (!isNaN(d)) {
                dateStr = d.toLocaleString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true
                });
            }
        } catch (_) {}

        const statusColors = {
            completed: 'bg-emerald-100 text-emerald-800',
            running  : 'bg-indigo-100 text-indigo-800',
            stopped  : 'bg-amber-100 text-amber-700',
            error    : 'bg-rose-100 text-rose-700'
        };
        const sClass = statusColors[sess.status] || 'bg-slate-100 text-slate-600';
        const sLabel = (sess.status || 'Done').charAt(0).toUpperCase() + (sess.status || 'Done').slice(1);

        tr.innerHTML = `
            <td class="py-3.5 px-4 text-sm font-medium text-slate-700 whitespace-nowrap">${dateStr}</td>
            <td class="py-3.5 px-4 font-semibold text-indigo-700 text-sm">${escapeHtml(sess.niche || '—')}</td>
            <td class="py-3.5 px-4 text-slate-500 text-sm">${escapeHtml(sess.location || '—')}</td>
            <td class="py-3.5 px-4 text-center">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">+${sess.new_count || 0}</span>
            </td>
            <td class="py-3.5 px-4 text-center">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">${sess.skipped_count || 0}</span>
            </td>
            <td class="py-3.5 px-4 text-center">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${sClass}">${sLabel}</span>
            </td>
            <td class="py-3.5 px-4 text-right">
                <button type="button" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 group-hover:shadow-md transition-all">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    View Leads
                </button>
            </td>
        `;

        tr.addEventListener('click', () => openSessionLeads(sess));
        tbody.appendChild(tr);
    });
}

window.filterHistoryTable = function() {
    const input = document.getElementById('historySearchInput');
    const q = input ? input.value.toLowerCase().trim() : '';
    if (!q) {
        renderHistoryTable(allSessions);
        return;
    }
    const filtered = allSessions.filter(s =>
        (s.niche || '').toLowerCase().includes(q) ||
        (s.location || '').toLowerCase().includes(q) ||
        (s.created_at || '').toLowerCase().includes(q)
    );
    renderHistoryTable(filtered);
};

// ── Session Leads Drill-Down ─────────────────────────────

async function openSessionById(sessionId) {
    try {
        const resp = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (resp.ok) {
            const data = await resp.json();
            if (data.session) {
                openSessionLeads(data.session);
            }
        }
    } catch (_) {}
}

async function openSessionLeads(session) {
    currentSessionId = session.session_id;
    currentSessionData = session;

    const dash = document.getElementById('dashboardView');
    const detail = document.getElementById('leadsDetailView');
    if (dash) dash.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Update header labels
    const title = document.getElementById('detailNicheTitle');
    const sub = document.getElementById('detailSubTitle');
    if (title) title.innerText = `${session.niche || 'Leads'} (${session.location || 'All Locations'})`;

    let dateStr = session.created_at || '';
    try {
        const d = new Date(session.created_at);
        if (!isNaN(d)) {
            dateStr = d.toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            });
        }
    } catch (_) {}

    if (sub) {
        sub.innerText = `Extracted on ${dateStr} · New Leads: ${session.new_count || 0} · Duplicates Skipped: ${session.skipped_count || 0}`;
    }

    const tbody = document.getElementById('detailTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr><td colspan="8" class="py-12 text-center text-slate-400">
                <div class="flex items-center justify-center gap-2 text-sm">
                    <div class="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                    Loading leads...
                </div>
            </td></tr>`;
    }

    try {
        const resp = await fetch(`/api/leads?session_id=${encodeURIComponent(session.session_id)}`);
        const data = await resp.json();
        sessionLeads = data.leads || [];

        const badge = document.getElementById('detailLeadsCountBadge');
        if (badge) badge.innerText = sessionLeads.length;

        renderLeadsTable(sessionLeads);
    } catch (err) {
        window.showToast('Could not load session leads', 'error');
    }
}

function renderLeadsTable(leads) {
    const tbody = document.getElementById('detailTableBody');
    const footInfo = document.getElementById('detailFooterInfo');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (footInfo) footInfo.innerText = `${leads.length} entries`;

    if (!leads || leads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-slate-400 text-sm">No leads found in this session.</td></tr>`;
        return;
    }

    leads.forEach((lead, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition-colors';

        // Rating
        let ratingHtml = '<span class="text-slate-300">—</span>';
        if (lead.rating && lead.rating > 0) {
            ratingHtml = `<span class="text-xs font-bold text-amber-600">★ ${parseFloat(lead.rating).toFixed(1)}</span>
                          <span class="text-[11px] text-slate-400 ml-1">(${lead.reviews_count || 0})</span>`;
        }

        // Phone
        let phoneHtml = '<span class="text-slate-300">—</span>';
        if (lead.phone) {
            phoneHtml = `
                <div class="flex items-center gap-1">
                    <a href="tel:${escapeHtml(lead.phone)}" class="text-xs font-medium text-slate-800 hover:text-indigo-600">${escapeHtml(lead.phone)}</a>
                    <button type="button" onclick="copyText('${escapeHtml(lead.phone)}')" class="text-slate-300 hover:text-slate-600 p-0.5 cursor-pointer" title="Copy phone">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    </button>
                </div>`;
        }

        // WhatsApp Direct Link
        let waHtml = '<span class="text-slate-300">—</span>';
        const rawNum = (lead.whatsapp || lead.phone || '').replace(/\D/g, '');
        if (rawNum.length >= 10) {
            const waNum = rawNum.length === 10 ? '91' + rawNum : rawNum;
            const waUrl = `https://api.whatsapp.com/send?phone=${waNum}&text=${encodeURIComponent('Hello, I found your business on Google Maps.')}`;
            waHtml = `
                <a href="${waUrl}" target="_blank" rel="noopener"
                    class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                    <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.771-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.312.045-.694.044-2.124-.555-1.748-.734-2.871-2.508-2.958-2.624-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.42-.1.825z"/></svg>
                    +${waNum}
                </a>`;
        }

        // Email
        let emailHtml = '<span class="text-slate-300">—</span>';
        if (lead.email) {
            emailHtml = `
                <div class="flex items-center gap-1">
                    <a href="mailto:${escapeHtml(lead.email)}" class="text-xs text-indigo-600 hover:underline truncate max-w-[150px]">${escapeHtml(lead.email)}</a>
                    <button type="button" onclick="copyText('${escapeHtml(lead.email)}')" class="text-slate-300 hover:text-slate-600 p-0.5 cursor-pointer" title="Copy email">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    </button>
                </div>`;
        }

        // Website
        let webHtml = '<span class="text-slate-300">—</span>';
        if (lead.website) {
            const domain = lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 24);
            webHtml = `
                <a href="${escapeHtml(lead.website)}" target="_blank" rel="noopener"
                    class="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                    <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                    ${escapeHtml(domain)}
                </a>`;
        }

        tr.innerHTML = `
            <td class="py-3 px-3 text-center text-xs text-slate-400 font-medium">${idx + 1}</td>
            <td class="py-3 px-4">
                <div class="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                    ${escapeHtml(lead.name || '—')}
                    ${lead.map_url ? `
                        <a href="${escapeHtml(lead.map_url)}" target="_blank" rel="noopener" class="text-slate-300 hover:text-indigo-600" title="View on Google Maps">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                        </a>
                    ` : ''}
                </div>
                <div class="text-[11px] text-slate-400">${escapeHtml(lead.niche || '')}</div>
            </td>
            <td class="py-3 px-3 whitespace-nowrap">${ratingHtml}</td>
            <td class="py-3 px-4 whitespace-nowrap">${phoneHtml}</td>
            <td class="py-3 px-4 whitespace-nowrap">${waHtml}</td>
            <td class="py-3 px-4 whitespace-nowrap">${emailHtml}</td>
            <td class="py-3 px-4 whitespace-nowrap">${webHtml}</td>
            <td class="py-3 px-4">
                <div class="text-xs text-slate-500 line-clamp-2">${escapeHtml(lead.address || '—')}</div>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

window.filterLeadsTable = function() {
    const input = document.getElementById('detailFilterInput');
    const q = input ? input.value.toLowerCase().trim() : '';
    if (!q) {
        renderLeadsTable(sessionLeads);
        return;
    }
    const filtered = sessionLeads.filter(l =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.phone || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.address || '').toLowerCase().includes(q)
    );
    renderLeadsTable(filtered);
};

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ── Startup ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    window.loadDashboard();
    initSSE();
});
