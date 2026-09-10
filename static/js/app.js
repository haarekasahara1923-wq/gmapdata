// Google Maps Data Extractor SaaS — Dashboard Controller

document.addEventListener('DOMContentLoaded', () => {

    // ── State ────────────────────────────────────────────────
    let currentSessionId   = null;
    let currentSessionData = null;
    let allSessions        = [];
    let sessionLeads       = [];
    let isExtracting       = false;
    let eventSource        = null;

    // ── Elements ─────────────────────────────────────────────
    const dashboardView    = document.getElementById('dashboardView');
    const leadsDetailView  = document.getElementById('leadsDetailView');
    const navHome          = document.getElementById('navHome');
    const backToHistoryBtn = document.getElementById('backToHistoryBtn');

    // KPIs
    const dashTotalSessions = document.getElementById('dashTotalSessions');
    const dashTotalLeads    = document.getElementById('dashTotalLeads');
    const dashTotalNiches   = document.getElementById('dashTotalNiches');
    const dashTotalPhones   = document.getElementById('dashTotalPhones');

    // History
    const historyTableBody  = document.getElementById('historyTableBody');
    const emptyHistoryRow   = document.getElementById('emptyHistoryRow');
    const historySearchInput= document.getElementById('historySearchInput');
    const historyCountInfo  = document.getElementById('historyCountInfo');
    const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

    // Detail view
    const detailNicheTitle      = document.getElementById('detailNicheTitle');
    const detailSubTitle        = document.getElementById('detailSubTitle');
    const detailLeadsCountBadge = document.getElementById('detailLeadsCountBadge');
    const detailFilterInput     = document.getElementById('detailFilterInput');
    const detailTableBody       = document.getElementById('detailTableBody');
    const detailFooterInfo      = document.getElementById('detailFooterInfo');
    const detailExportCsvBtn    = document.getElementById('detailExportCsvBtn');
    const detailExportExcelBtn  = document.getElementById('detailExportExcelBtn');
    const detailExportPdfBtn    = document.getElementById('detailExportPdfBtn');

    // Modal
    const extractionModal  = document.getElementById('extractionModal');
    const openNewBtn       = document.getElementById('openNewExtractionBtn');
    const closeModalBtn    = document.getElementById('closeModalBtn');
    const cancelModalBtn   = document.getElementById('cancelModalBtn');
    const modalExtractForm = document.getElementById('modalExtractForm');
    const modalNicheInput  = document.getElementById('modalNicheInput');
    const modalLocationInput = document.getElementById('modalLocationInput');
    const modalMaxSelect   = document.getElementById('modalMaxSelect');
    const modalStartBtn    = document.getElementById('modalStartBtn');
    const modalStopBtn     = document.getElementById('modalStopBtn');
    const modalStatusBanner= document.getElementById('modalStatusBanner');
    const modalStatusText  = document.getElementById('modalStatusText');
    const modalNewCount    = document.getElementById('modalNewCount');
    const modalSkippedCount= document.getElementById('modalSkippedCount');

    // Toast
    const toast    = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    const toastIcon= document.getElementById('toastIcon');

    // ── Init ─────────────────────────────────────────────────
    loadDashboard();
    initSSE();

    // ── Modal open/close ─────────────────────────────────────
    openNewBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    cancelModalBtn.addEventListener('click', closeModal);

    function openModal() {
        extractionModal.style.display = 'flex';
        modalNicheInput.focus();
        // Reset state
        modalStatusBanner.classList.add('hidden');
        modalNewCount.innerText    = '0';
        modalSkippedCount.innerText= '0';
        modalStatusText.innerText  = 'Starting...';
        setModalExtracting(false);
    }

    function closeModal() {
        extractionModal.style.display = 'none';
    }

    // Close on backdrop click
    extractionModal.addEventListener('click', (e) => {
        if (e.target === extractionModal) closeModal();
    });

    // ── Quick chips ──────────────────────────────────────────
    document.querySelectorAll('.quick-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const txt = chip.innerText.trim();
            if (txt.includes(' in ')) {
                const [niche, loc] = txt.split(' in ');
                modalNicheInput.value   = niche.trim();
                modalLocationInput.value= loc.trim();
            } else {
                modalNicheInput.value   = txt;
                modalLocationInput.value= '';
            }
        });
    });

    // ── Start Extraction ─────────────────────────────────────
    modalExtractForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const niche       = modalNicheInput.value.trim();
        const location    = modalLocationInput.value.trim();
        const max_results = parseInt(modalMaxSelect.value, 10);
        if (!niche) { showToast('Please enter a niche/keyword', 'error'); return; }

        setModalExtracting(true);
        modalStatusBanner.classList.remove('hidden');
        modalStatusText.innerText = `Starting extraction for "${niche}"...`;

        try {
            const resp = await fetch('/api/extract/start', {
                method : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body   : JSON.stringify({ niche, location, max_results })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Failed to start');
            currentSessionId = data.session_id;
            showToast('Extraction started! Duplicates will be auto-skipped.');
        } catch (err) {
            setModalExtracting(false);
            showToast(err.message, 'error');
        }
    });

    // ── Stop Extraction ──────────────────────────────────────
    modalStopBtn.addEventListener('click', async () => {
        modalStopBtn.disabled = true;
        modalStatusText.innerText = 'Stopping...';
        await fetch('/api/extract/stop', { method: 'POST' });
        showToast('Stop request sent.');
    });

    function setModalExtracting(on) {
        isExtracting           = on;
        modalStartBtn.disabled = on;
        modalStopBtn.disabled  = !on;
        if (on) {
            modalStartBtn.classList.add('opacity-50', 'pointer-events-none');
        } else {
            modalStartBtn.classList.remove('opacity-50', 'pointer-events-none');
        }
    }

    // ── SSE Live Feed ─────────────────────────────────────────
    function initSSE() {
        if (eventSource) eventSource.close();
        eventSource = new EventSource('/api/extract/stream');
        eventSource.onmessage = (e) => {
            try { handleEvent(JSON.parse(e.data)); } catch(_) {}
        };
    }

    function handleEvent(msg) {
        if (!msg || !msg.event) return;

        if (msg.event === 'new_lead') {
            modalNewCount.innerText   = msg.new_count    || 0;
            modalStatusText.innerText = `Extracted: ${msg.data?.name || ''}`;

        } else if (msg.event === 'lead_skipped') {
            modalSkippedCount.innerText = msg.skipped_count || 0;
            modalStatusText.innerText   = `Skipped: ${msg.data?.name || ''}`;

        } else if (msg.event === 'extracting_lead') {
            modalStatusText.innerText = `Checking: ${msg.data?.name || ''}`;

        } else if (msg.event === 'completed' || msg.event === 'stopped') {
            setModalExtracting(false);
            modalStatusText.innerText = `Extraction ${msg.event}!`;
            showToast(`Extraction ${msg.event} — ${modalNewCount.innerText} new leads saved.`);

            // Auto: close modal after 1.5s, refresh dashboard, open the new session
            setTimeout(async () => {
                closeModal();
                await loadDashboard();
                // open the just-completed session
                if (currentSessionId) {
                    const resp = await fetch('/api/sessions/' + currentSessionId);
                    if (resp.ok) {
                        const d = await resp.json();
                        if (d.session) openSessionLeads(d.session);
                    }
                }
            }, 1500);

        } else if (msg.event === 'error') {
            setModalExtracting(false);
            showToast(msg.data?.error || 'Extraction error', 'error');
        }
    }

    // ── Dashboard Loader ─────────────────────────────────────
    async function loadDashboard() {
        try {
            const [statsResp, sessResp] = await Promise.all([
                fetch('/api/stats'),
                fetch('/api/sessions?limit=100')
            ]);
            const stats    = await statsResp.json();
            const sessData = await sessResp.json();

            dashTotalSessions.innerText = stats.total_sessions  || 0;
            dashTotalLeads.innerText    = stats.total_leads     || 0;
            dashTotalNiches.innerText   = stats.total_niches    || 0;
            dashTotalPhones.innerText   = stats.leads_with_phone|| 0;

            allSessions = sessData.sessions || [];
            renderHistory(allSessions);
        } catch (e) {
            showToast('Could not load dashboard', 'error');
        }
    }

    // ── History Table ─────────────────────────────────────────
    function renderHistory(sessions) {
        historyTableBody.innerHTML = '';
        historyCountInfo.innerText = `Showing ${sessions.length} extraction${sessions.length !== 1 ? 's' : ''}`;

        if (!sessions.length) {
            historyTableBody.appendChild(emptyHistoryRow);
            return;
        }

        sessions.forEach(sess => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-indigo-50/40 cursor-pointer transition-colors';

            // Format date
            let dateStr = sess.created_at || '—';
            try {
                const d = new Date(sess.created_at);
                if (!isNaN(d)) {
                    dateStr = d.toLocaleString('en-IN', {
                        day:'2-digit', month:'short', year:'numeric',
                        hour:'2-digit', minute:'2-digit', hour12:true
                    });
                }
            } catch(_) {}

            // Status badge
            const statusColors = {
                completed: 'bg-emerald-100 text-emerald-800',
                running  : 'bg-indigo-100 text-indigo-800',
                stopped  : 'bg-amber-100 text-amber-700',
                error    : 'bg-rose-100 text-rose-700'
            };
            const sClass = statusColors[sess.status] || 'bg-slate-100 text-slate-600';
            const sLabel = (sess.status || 'unknown').charAt(0).toUpperCase() + (sess.status || '').slice(1);

            tr.innerHTML = `
                <td class="py-3.5 px-4 text-sm font-medium text-slate-800 whitespace-nowrap">${dateStr}</td>
                <td class="py-3.5 px-4 font-semibold text-indigo-700">${sess.niche || '—'}</td>
                <td class="py-3.5 px-4 text-slate-500 text-sm">${sess.location || '<span class="text-slate-300">—</span>'}</td>
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
                    <button class="view-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all">
                        <i data-lucide="eye" class="w-3 h-3"></i> View Leads
                    </button>
                </td>
            `;

            tr.addEventListener('click', () => openSessionLeads(sess));
            historyTableBody.appendChild(tr);
        });

        lucide.createIcons();
    }

    // Search
    historySearchInput.addEventListener('input', () => {
        const q = historySearchInput.value.toLowerCase();
        if (!q) { renderHistory(allSessions); return; }
        renderHistory(allSessions.filter(s =>
            (s.niche     || '').toLowerCase().includes(q) ||
            (s.location  || '').toLowerCase().includes(q) ||
            (s.created_at|| '').toLowerCase().includes(q)
        ));
    });

    refreshHistoryBtn.addEventListener('click', () => { loadDashboard(); showToast('Refreshed!'); });
    navHome.addEventListener('click', () => { showDashboard(); loadDashboard(); });
    backToHistoryBtn.addEventListener('click', () => { showDashboard(); loadDashboard(); });

    function showDashboard() {
        dashboardView.classList.remove('hidden');
        leadsDetailView.classList.add('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ── Session Drill-Down ────────────────────────────────────
    async function openSessionLeads(session) {
        currentSessionId   = session.session_id;
        currentSessionData = session;

        dashboardView.classList.add('hidden');
        leadsDetailView.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Header info
        detailNicheTitle.innerText = session.niche || '—';
        let dateStr = session.created_at || '';
        try {
            const d = new Date(session.created_at);
            if (!isNaN(d)) dateStr = d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
        } catch(_) {}
        detailSubTitle.innerText = `${dateStr}  •  Location: ${session.location || 'All'}  •  New: ${session.new_count || 0}  •  Skipped: ${session.skipped_count || 0}`;

        // Load leads
        detailTableBody.innerHTML = `
            <tr><td colspan="8" class="py-12 text-center text-slate-400">
                <div class="flex items-center justify-center gap-2">
                    <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    Loading leads...
                </div>
            </td></tr>`;

        try {
            const resp = await fetch('/api/leads?session_id=' + encodeURIComponent(session.session_id));
            const data = await resp.json();
            sessionLeads = data.leads || [];
            detailLeadsCountBadge.innerText = sessionLeads.length;
            renderLeadsTable(sessionLeads);
        } catch (e) {
            showToast('Could not load leads', 'error');
        }
    }

    // ── Leads Table ───────────────────────────────────────────
    function renderLeadsTable(leads) {
        detailTableBody.innerHTML = '';
        detailFooterInfo.innerText = `${leads.length} entries`;

        if (!leads.length) {
            detailTableBody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-slate-400">No leads found.</td></tr>`;
            return;
        }

        leads.forEach((lead, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 transition-colors';

            // WhatsApp
            let waHtml = '<span class="text-slate-300">—</span>';
            const rawNum = (lead.whatsapp || lead.phone || '').replace(/\D/g, '');
            if (rawNum.length >= 10) {
                const waNum = rawNum.length === 10 ? '91' + rawNum : rawNum;
                const waUrl = `https://api.whatsapp.com/send?phone=${waNum}&text=${encodeURIComponent('Hello, I found your business on Google Maps.')}`;
                waHtml = `
                    <a href="${waUrl}" target="_blank"
                        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                        <i data-lucide="message-circle" class="w-3.5 h-3.5"></i> +${waNum}
                    </a>`;
            }

            // Email
            let emailHtml = '<span class="text-slate-300">—</span>';
            if (lead.email) {
                emailHtml = `
                    <div class="flex items-center gap-1">
                        <a href="mailto:${lead.email}" class="text-xs text-indigo-600 hover:underline truncate max-w-[150px]">${lead.email}</a>
                        <button onclick="copyText('${lead.email}')" class="text-slate-300 hover:text-slate-500 p-0.5"><i data-lucide="copy" class="w-3 h-3"></i></button>
                    </div>`;
            }

            // Phone
            let phoneHtml = '<span class="text-slate-300">—</span>';
            if (lead.phone) {
                phoneHtml = `
                    <div class="flex items-center gap-1">
                        <a href="tel:${lead.phone}" class="text-xs font-medium text-slate-700 hover:text-indigo-600">${lead.phone}</a>
                        <button onclick="copyText('${lead.phone}')" class="text-slate-300 hover:text-slate-500 p-0.5"><i data-lucide="copy" class="w-3 h-3"></i></button>
                    </div>`;
            }

            // Website
            let webHtml = '<span class="text-slate-300">—</span>';
            if (lead.website) {
                const domain = lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 25);
                webHtml = `<a href="${lead.website}" target="_blank" rel="noopener" class="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                    <i data-lucide="globe" class="w-3 h-3 flex-shrink-0"></i>${domain}</a>`;
            }

            // Rating
            let ratingHtml = '<span class="text-slate-300">—</span>';
            if (lead.rating > 0) {
                ratingHtml = `<span class="text-xs font-bold text-amber-600">★ ${parseFloat(lead.rating).toFixed(1)}</span>
                              <span class="text-[11px] text-slate-400 ml-1">(${lead.reviews_count || 0})</span>`;
            }

            tr.innerHTML = `
                <td class="py-3 px-3 text-center text-xs text-slate-400">${idx + 1}</td>
                <td class="py-3 px-4">
                    <div class="font-semibold text-slate-900 text-sm flex items-center gap-1">
                        ${lead.name || '—'}
                        ${lead.map_url ? `<a href="${lead.map_url}" target="_blank" class="text-slate-300 hover:text-indigo-500"><i data-lucide="external-link" class="w-3 h-3"></i></a>` : ''}
                    </div>
                    <div class="text-[11px] text-slate-400">${lead.niche || ''}</div>
                </td>
                <td class="py-3 px-3">${ratingHtml}</td>
                <td class="py-3 px-4">${phoneHtml}</td>
                <td class="py-3 px-4">${waHtml}</td>
                <td class="py-3 px-4">${emailHtml}</td>
                <td class="py-3 px-4">${webHtml}</td>
                <td class="py-3 px-4">
                    <div class="text-xs text-slate-500 line-clamp-2">${lead.address || '<span class="text-slate-300">—</span>'}</div>
                </td>`;

            detailTableBody.appendChild(tr);
        });

        lucide.createIcons();
    }

    // Filter
    detailFilterInput.addEventListener('input', () => {
        const q = detailFilterInput.value.toLowerCase();
        if (!q) { renderLeadsTable(sessionLeads); return; }
        renderLeadsTable(sessionLeads.filter(l =>
            (l.name   || '').toLowerCase().includes(q) ||
            (l.phone  || '').toLowerCase().includes(q) ||
            (l.email  || '').toLowerCase().includes(q) ||
            (l.address|| '').toLowerCase().includes(q)
        ));
    });

    // ── Exports ───────────────────────────────────────────────
    detailExportCsvBtn.addEventListener('click', () => {
        if (!currentSessionId) return;
        window.location.href = '/api/export/csv?session_id=' + encodeURIComponent(currentSessionId);
    });
    detailExportExcelBtn.addEventListener('click', () => {
        if (!currentSessionId) return;
        window.location.href = '/api/export/excel?session_id=' + encodeURIComponent(currentSessionId);
    });
    detailExportPdfBtn.addEventListener('click', () => {
        if (!currentSessionId) return;
        if (currentSessionData?.pdf_cloudinary_url) {
            window.open(currentSessionData.pdf_cloudinary_url, '_blank');
        } else {
            window.location.href = '/api/export/pdf?session_id=' + encodeURIComponent(currentSessionId);
        }
    });

    // ── Utilities ─────────────────────────────────────────────
    window.copyText = (text) => {
        navigator.clipboard.writeText(text).then(() => showToast('Copied!')).catch(() => showToast('Copy failed', 'error'));
    };

    function showToast(msg, type = 'success') {
        toastMsg.innerText = msg;
        toastIcon.setAttribute('data-lucide', type === 'error' ? 'alert-circle' : 'check-circle');
        toastIcon.className = `w-4 h-4 ${type === 'error' ? 'text-rose-400' : 'text-emerald-400'}`;
        lucide.createIcons();
        toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
        toast.classList.add('opacity-100', 'translate-y-0');
        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
            toast.classList.remove('opacity-100', 'translate-y-0');
        }, 3000);
    }

});
