// Google Maps Data Extractor SaaS - Controller

document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentSessionId = null;
    let currentSessionData = null;
    let allSessions = [];
    let sessionLeads = [];
    let eventSource = null;
    let pollInterval = null;
    let isExtracting = false;

    // Views
    const dashboardView = document.getElementById('dashboardView');
    const leadsDetailView = document.getElementById('leadsDetailView');
    const navHome = document.getElementById('navHome');
    const backToHistoryBtn = document.getElementById('backToHistoryBtn');

    // System Status Badges
    const dbStatusBadge = document.getElementById('dbStatusBadge');
    const dbName = document.getElementById('dbName');
    const cloudinaryStatusBadge = document.getElementById('cloudinaryStatusBadge');
    const cloudinaryStatus = document.getElementById('cloudinaryStatus');

    // KPI Metrics
    const dashTotalSessions = document.getElementById('dashTotalSessions');
    const dashTotalLeads = document.getElementById('dashTotalLeads');
    const dashTotalNiches = document.getElementById('dashTotalNiches');
    const dashTotalPhones = document.getElementById('dashTotalPhones');

    // History Table
    const historyTableBody = document.getElementById('historyTableBody');
    const emptyHistoryRow = document.getElementById('emptyHistoryRow');
    const historySearchInput = document.getElementById('historySearchInput');
    const historyCountInfo = document.getElementById('historyCountInfo');
    const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

    // Detail Leads View Elements
    const detailNicheTitle = document.getElementById('detailNicheTitle');
    const detailDateTime = document.getElementById('detailDateTime');
    const detailSubTitle = document.getElementById('detailSubTitle');
    const detailLeadsCountBadge = document.getElementById('detailLeadsCountBadge');
    const detailFilterInput = document.getElementById('detailFilterInput');
    const detailTableBody = document.getElementById('detailTableBody');
    const detailFooterInfo = document.getElementById('detailFooterInfo');
    const detailExportCsvBtn = document.getElementById('detailExportCsvBtn');
    const detailExportExcelBtn = document.getElementById('detailExportExcelBtn');
    const detailExportPdfBtn = document.getElementById('detailExportPdfBtn');
    const pdfBtnLabel = document.getElementById('pdfBtnLabel');

    // Modal Elements
    const openNewExtractionBtn = document.getElementById('openNewExtractionBtn');
    const extractionModal = document.getElementById('extractionModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const modalExtractForm = document.getElementById('modalExtractForm');
    const modalNicheInput = document.getElementById('modalNicheInput');
    const modalLocationInput = document.getElementById('modalLocationInput');
    const modalMaxSelect = document.getElementById('modalMaxSelect');
    const modalStartBtn = document.getElementById('modalStartBtn');
    const modalStopBtn = document.getElementById('modalStopBtn');
    const modalStatusBanner = document.getElementById('modalStatusBanner');
    const modalStatusText = document.getElementById('modalStatusText');
    const modalNewCount = document.getElementById('modalNewCount');
    const modalSkippedCount = document.getElementById('modalSkippedCount');

    // Toast
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');

    // Initial Load
    checkSystemStatus();
    loadDashboard();
    initSSE();

    // ----------------------------------------------------
    // System Status (Neon Postgres & Cloudinary)
    // ----------------------------------------------------
    async function checkSystemStatus() {
        try {
            const resp = await fetch('/api/system/status');
            const data = await resp.json();
            
            dbName.innerText = data.database || 'Neon Postgres';
            dbStatusBadge.classList.remove('hidden');

            if (data.cloudinary) {
                cloudinaryStatus.innerText = 'Cloudinary Active (PDF CDN)';
                cloudinaryStatus.className = 'text-blue-700 font-semibold';
            } else {
                cloudinaryStatus.innerText = 'Local PDF Mode';
                cloudinaryStatus.className = 'text-slate-500';
            }
            cloudinaryStatusBadge.classList.remove('hidden');

            // Update stats
            if (data.stats) {
                dashTotalLeads.innerText = data.stats.total_leads || 0;
                dashTotalSessions.innerText = data.stats.total_sessions || 0;
                dashTotalNiches.innerText = data.stats.total_niches || 0;
                dashTotalPhones.innerText = data.stats.leads_with_phone || 0;
            }
        } catch (e) {
            console.error('System status error', e);
        }
    }

    // ----------------------------------------------------
    // Dashboard History Loader
    // ----------------------------------------------------
    async function loadDashboard() {
        try {
            const resp = await fetch('/api/sessions?limit=100');
            const data = await resp.json();
            allSessions = data.sessions || [];
            renderHistoryTable(allSessions);
            historyCountInfo.innerText = `Showing ${allSessions.length} extractions`;
        } catch (e) {
            showToast('Failed to load extraction history', 'error');
        }
    }

    function renderHistoryTable(sessions) {
        historyTableBody.innerHTML = '';

        if (!sessions || sessions.length === 0) {
            historyTableBody.appendChild(emptyHistoryRow);
            return;
        }

        sessions.forEach(sess => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-indigo-50/40 cursor-pointer transition-colors border-b border-slate-100';

            // Format date
            let formattedDate = sess.created_at || 'Just now';
            try {
                const d = new Date(sess.created_at);
                if (!isNaN(d)) {
                    formattedDate = d.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            } catch (e) {}

            // Status badge
            let statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">${sess.status || 'unknown'}</span>`;
            if (sess.status === 'completed') {
                statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Completed</span>`;
            } else if (sess.status === 'running') {
                statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse">Running</span>`;
            } else if (sess.status === 'stopped') {
                statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">Stopped</span>`;
            }

            // Cloudinary PDF button if URL exists
            let pdfAction = '';
            if (sess.pdf_cloudinary_url) {
                pdfAction = `
                    <a href="${sess.pdf_cloudinary_url}" target="_blank" onclick="event.stopPropagation()" title="View on Cloudinary CDN"
                        class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors">
                        <i data-lucide="cloud" class="w-3 h-3 text-rose-600"></i>
                        <span>PDF</span>
                    </a>
                `;
            }

            tr.innerHTML = `
                <td class="py-3.5 px-4 font-medium text-slate-900 flex items-center gap-2">
                    <i data-lucide="calendar" class="w-4 h-4 text-slate-400"></i>
                    <span>${formattedDate}</span>
                </td>
                <td class="py-3.5 px-4 font-semibold text-indigo-700">
                    <span class="inline-flex items-center gap-1.5">
                        ${sess.niche}
                    </span>
                </td>
                <td class="py-3.5 px-4 text-slate-600 text-xs">
                    ${sess.location || '<span class="text-slate-400">All Locations</span>'}
                </td>
                <td class="py-3.5 px-4 text-center">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                        +${sess.new_count || 0}
                    </span>
                </td>
                <td class="py-3.5 px-4 text-center">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800" title="Deduplicated duplicates skipped">
                        ${sess.skipped_count || 0}
                    </span>
                </td>
                <td class="py-3.5 px-4 text-center">${statusBadge}</td>
                <td class="py-3.5 px-4 text-right">
                    <div class="flex items-center justify-end space-x-2">
                        ${pdfAction}
                        <button type="button" class="view-session-btn inline-flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all">
                            <i data-lucide="eye" class="w-3 h-3"></i>
                            <span>View Leads</span>
                        </button>
                    </div>
                </td>
            `;

            // Click entire row to view session leads
            tr.addEventListener('click', () => {
                openSessionLeads(sess);
            });

            historyTableBody.appendChild(tr);
        });

        lucide.createIcons();
    }

    // Search within history
    historySearchInput.addEventListener('input', () => {
        const q = historySearchInput.value.toLowerCase().trim();
        if (!q) {
            renderHistoryTable(allSessions);
            return;
        }
        const filtered = allSessions.filter(s => {
            return (s.niche && s.niche.toLowerCase().includes(q)) ||
                   (s.location && s.location.toLowerCase().includes(q)) ||
                   (s.created_at && s.created_at.toLowerCase().includes(q));
        });
        renderHistoryTable(filtered);
    });

    refreshHistoryBtn.addEventListener('click', () => {
        loadDashboard();
        checkSystemStatus();
        showToast('History refreshed');
    });

    // ----------------------------------------------------
    // Drill-Down: Open Extracted Leads for a Session
    // ----------------------------------------------------
    async function openSessionLeads(session) {
        currentSessionId = session.session_id;
        currentSessionData = session;

        // Switch view
        dashboardView.classList.add('hidden');
        leadsDetailView.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Update header
        detailNicheTitle.innerText = session.niche;
        let formattedDate = session.created_at || '';
        try {
            formattedDate = new Date(session.created_at).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch (e) {}
        detailDateTime.innerText = `• Extracted on ${formattedDate}`;
        detailSubTitle.innerText = `Location: ${session.location || 'Not specified'} • New Leads: ${session.new_count || 0} • Deduplicated Skipped: ${session.skipped_count || 0}`;

        // Cloudinary label
        if (session.pdf_cloudinary_url) {
            pdfBtnLabel.innerText = 'Cloudinary PDF ☁️';
        } else {
            pdfBtnLabel.innerText = 'Download PDF';
        }

        // Fetch leads for this session
        try {
            detailTableBody.innerHTML = `
                <tr><td colspan="8" class="py-12 text-center text-slate-400">
                    <div class="flex items-center justify-center space-x-2">
                        <div class="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                        <span>Loading extracted leads...</span>
                    </div>
                </td></tr>
            `;
            const resp = await fetch(`/api/leads?session_id=${encodeURIComponent(session.session_id)}`);
            const data = await resp.json();
            sessionLeads = data.leads || [];
            detailLeadsCountBadge.innerText = `${sessionLeads.length} leads`;
            renderLeadsTable(sessionLeads);
        } catch (e) {
            showToast('Failed to load session leads', 'error');
        }
    }

    // Back to dashboard button
    backToHistoryBtn.addEventListener('click', () => {
        leadsDetailView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        loadDashboard();
        checkSystemStatus();
    });

    navHome.addEventListener('click', () => {
        leadsDetailView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        loadDashboard();
    });

    // Render Leads Table
    function renderLeadsTable(leads) {
        detailTableBody.innerHTML = '';

        if (!leads || leads.length === 0) {
            detailTableBody.innerHTML = `
                <tr><td colspan="8" class="py-12 text-center text-slate-400">
                    No leads found for this session.
                </td></tr>
            `;
            detailFooterInfo.innerText = 'Showing 0 entries';
            return;
        }

        detailFooterInfo.innerText = `Showing ${leads.length} entries`;

        leads.forEach((lead, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50/80 transition-colors';

            // WhatsApp link
            let whatsappHtml = '<span class="text-xs text-slate-400">-</span>';
            const rawPhone = lead.whatsapp || lead.phone;
            if (rawPhone) {
                const cleanDigits = rawPhone.replace(/\D/g, '');
                if (cleanDigits.length >= 10) {
                    const waNum = cleanDigits.length === 10 ? '91' + cleanDigits : cleanDigits;
                    const waUrl = `https://api.whatsapp.com/send?phone=${waNum}&text=${encodeURIComponent("Hello, I found your business on Google Maps.")}`;
                    whatsappHtml = `
                        <a href="${waUrl}" target="_blank" class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors">
                            <i data-lucide="message-circle" class="w-3.5 h-3.5 text-emerald-600"></i>
                            <span>+${waNum}</span>
                        </a>
                    `;
                }
            }

            // Email
            let emailHtml = '<span class="text-xs text-slate-400">Not found</span>';
            if (lead.email) {
                emailHtml = `
                    <div class="flex items-center space-x-1.5">
                        <a href="mailto:${lead.email}" class="text-xs text-indigo-600 hover:underline truncate max-w-[140px]" title="${lead.email}">
                            ${lead.email}
                        </a>
                        <button onclick="copyToClipboard('${lead.email}', 'Email copied!')" title="Copy" class="text-slate-400 hover:text-slate-600 p-1">
                            <i data-lucide="copy" class="w-3 h-3"></i>
                        </button>
                    </div>
                `;
            }

            // Phone
            let phoneHtml = '<span class="text-xs text-slate-400">-</span>';
            if (lead.phone) {
                phoneHtml = `
                    <div class="flex items-center space-x-1.5">
                        <a href="tel:${lead.phone}" class="text-xs font-medium text-slate-800 hover:text-indigo-600">${lead.phone}</a>
                        <button onclick="copyToClipboard('${lead.phone}', 'Phone copied!')" title="Copy" class="text-slate-400 hover:text-slate-600 p-1">
                            <i data-lucide="copy" class="w-3 h-3"></i>
                        </button>
                    </div>
                `;
            }

            // Website
            let websiteHtml = '<span class="text-xs text-slate-400">-</span>';
            if (lead.website) {
                websiteHtml = `
                    <a href="${lead.website}" target="_blank" rel="noopener" class="inline-flex items-center space-x-1 text-xs text-indigo-600 hover:text-indigo-800 truncate max-w-[120px]" title="${lead.website}">
                        <i data-lucide="globe" class="w-3 h-3 flex-shrink-0"></i>
                        <span class="truncate">${lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                    </a>
                `;
            }

            // Rating
            let ratingHtml = '<span class="text-xs text-slate-400">No rating</span>';
            if (lead.rating > 0) {
                ratingHtml = `
                    <div class="flex items-center space-x-1 text-xs">
                        <span class="font-bold text-amber-600 flex items-center gap-0.5">
                            ★ ${lead.rating.toFixed(1)}
                        </span>
                        <span class="text-slate-400 text-[11px]">(${lead.reviews_count || 0})</span>
                    </div>
                `;
            }

            tr.innerHTML = `
                <td class="py-3 px-3 text-center text-xs text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-3 px-4">
                    <div class="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                        ${lead.name}
                        ${lead.map_url ? `
                            <a href="${lead.map_url}" target="_blank" title="View on Google Maps" class="text-slate-400 hover:text-indigo-600">
                                <i data-lucide="external-link" class="w-3 h-3"></i>
                            </a>
                        ` : ''}
                    </div>
                    <div class="text-[11px] text-slate-400">${lead.niche || ''}</div>
                </td>
                <td class="py-3 px-3">${ratingHtml}</td>
                <td class="py-3 px-4">${phoneHtml}</td>
                <td class="py-3 px-4">${whatsappHtml}</td>
                <td class="py-3 px-4">${emailHtml}</td>
                <td class="py-3 px-4">${websiteHtml}</td>
                <td class="py-3 px-4">
                    <div class="text-xs text-slate-600 line-clamp-2" title="${lead.address || ''}">
                        ${lead.address || '<span class="text-slate-400">-</span>'}
                    </div>
                </td>
            `;

            detailTableBody.appendChild(tr);
        });

        lucide.createIcons();
    }

    // Filter within session leads
    detailFilterInput.addEventListener('input', () => {
        const query = detailFilterInput.value.toLowerCase().trim();
        if (!query) {
            renderLeadsTable(sessionLeads);
            return;
        }
        const filtered = sessionLeads.filter(l => {
            return (l.name && l.name.toLowerCase().includes(query)) ||
                   (l.phone && l.phone.toLowerCase().includes(query)) ||
                   (l.email && l.email.toLowerCase().includes(query)) ||
                   (l.address && l.address.toLowerCase().includes(query)) ||
                   (l.website && l.website.toLowerCase().includes(query));
        });
        renderLeadsTable(filtered);
    });

    // Detail Exports
    detailExportCsvBtn.addEventListener('click', () => {
        if (!currentSessionId) return;
        window.location.href = `/api/export/csv?session_id=${encodeURIComponent(currentSessionId)}`;
    });

    detailExportExcelBtn.addEventListener('click', () => {
        if (!currentSessionId) return;
        window.location.href = `/api/export/excel?session_id=${encodeURIComponent(currentSessionId)}`;
    });

    detailExportPdfBtn.addEventListener('click', () => {
        if (!currentSessionId) return;
        // If session already has Cloudinary URL, open directly
        if (currentSessionData && currentSessionData.pdf_cloudinary_url) {
            window.open(currentSessionData.pdf_cloudinary_url, '_blank');
        } else {
            // Trigger download or generate and redirect
            window.location.href = `/api/export/pdf?session_id=${encodeURIComponent(currentSessionId)}&redirect=true`;
        }
    });

    // ----------------------------------------------------
    // Modal: New Extraction
    // ----------------------------------------------------
    openNewExtractionBtn.addEventListener('click', () => {
        extractionModal.classList.remove('hidden');
        modalNicheInput.focus();
    });

    closeModalBtn.addEventListener('click', () => extractionModal.classList.add('hidden'));
    cancelModalBtn.addEventListener('click', () => extractionModal.classList.add('hidden'));

    document.querySelectorAll('.quick-chip-modal').forEach(chip => {
        chip.addEventListener('click', () => {
            const text = chip.innerText.trim();
            if (text.includes(' in ')) {
                const parts = text.split(' in ');
                modalNicheInput.value = parts[0];
                modalLocationInput.value = parts[1];
            } else {
                modalNicheInput.value = text;
                modalLocationInput.value = '';
            }
        });
    });

    modalExtractForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const niche = modalNicheInput.value.trim();
        const location = modalLocationInput.value.trim();
        const max_results = parseInt(modalMaxSelect.value, 10);

        if (!niche) return;

        try {
            setModalExtracting(true);
            modalStatusBanner.classList.remove('hidden');
            modalStatusText.innerText = `Starting extraction for "${niche}"...`;
            modalNewCount.innerText = '0';
            modalSkippedCount.innerText = '0';

            const resp = await fetch('/api/extract/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ niche, location, max_results })
            });

            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Extraction failed to start');

            currentSessionId = data.session_id;
            showToast(`Extraction started! Duplicates will be skipped automatically.`);

        } catch (err) {
            setModalExtracting(false);
            showToast(err.message, 'error');
        }
    });

    modalStopBtn.addEventListener('click', async () => {
        modalStopBtn.disabled = true;
        modalStatusText.innerText = 'Stopping extraction...';
        await fetch('/api/extract/stop', { method: 'POST' });
        showToast('Stop request sent');
    });

    function setModalExtracting(extracting) {
        isExtracting = extracting;
        modalStartBtn.disabled = extracting;
        modalStopBtn.disabled = !extracting;
        if (extracting) {
            modalStartBtn.classList.add('opacity-50', 'pointer-events-none');
            modalStopBtn.classList.remove('opacity-40', 'pointer-events-none');
        } else {
            modalStartBtn.classList.remove('opacity-50', 'pointer-events-none');
            modalStopBtn.classList.add('opacity-40', 'pointer-events-none');
        }
    }

    // ----------------------------------------------------
    // Real-Time SSE Listener
    // ----------------------------------------------------
    function initSSE() {
        if (eventSource) eventSource.close();
        eventSource = new EventSource('/api/extract/stream');

        eventSource.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (!msg || !msg.event) return;

                if (msg.event === 'new_lead') {
                    modalNewCount.innerText = msg.new_count || 0;
                    modalStatusText.innerText = `Extracted: ${msg.data?.name || ''}`;
                } else if (msg.event === 'lead_skipped') {
                    modalSkippedCount.innerText = msg.skipped_count || 0;
                    modalStatusText.innerText = `Skipped duplicate: ${msg.data?.name || ''}`;
                } else if (msg.event === 'completed' || msg.event === 'stopped') {
                    setModalExtracting(false);
                    modalStatusText.innerText = `Extraction ${msg.event}!`;
                    showToast(`Extraction ${msg.event}!`);
                    
                    // Reload dashboard and view the new extraction automatically
                    setTimeout(() => {
                        extractionModal.classList.add('hidden');
                        loadDashboard();
                        if (currentSessionId) {
                            openSessionLeads({
                                session_id: currentSessionId,
                                niche: modalNicheInput.value.trim(),
                                location: modalLocationInput.value.trim(),
                                created_at: new Date().toISOString(),
                                new_count: parseInt(modalNewCount.innerText, 10),
                                skipped_count: parseInt(modalSkippedCount.innerText, 10)
                            });
                        }
                    }, 1200);
                } else if (msg.event === 'error') {
                    setModalExtracting(false);
                    showToast(msg.data?.error || 'Extraction error', 'error');
                }
            } catch (err) {
                console.error(err);
            }
        };
    }

    // ----------------------------------------------------
    // Utilities: Toast & Copy
    // ----------------------------------------------------
    window.copyToClipboard = (text, successMsg = 'Copied to clipboard!') => {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMsg);
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    };

    function showToast(msg, type = 'success') {
        toastMsg.innerText = msg;
        const icon = document.getElementById('toastIcon');
        if (type === 'error') {
            icon.setAttribute('data-lucide', 'alert-circle');
            icon.className = 'w-4 h-4 text-rose-400';
        } else {
            icon.setAttribute('data-lucide', 'check-circle');
            icon.className = 'w-4 h-4 text-emerald-400';
        }
        lucide.createIcons();

        toast.classList.add('toast-visible');
        setTimeout(() => {
            toast.classList.remove('toast-visible');
        }, 3200);
    }
});
