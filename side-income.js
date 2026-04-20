/* ════════════════════════════════════════════════════════════════
 * Keepstead — Shared Wages / 1099s / IRS Transcripts module
 *
 * Injects a "Wages & 1099s" tab into every organizer — structured W-2
 * slots, structured 1099 slots (each with file upload), IRS Wage &
 * Income transcript upload, and a "missed deductions" banner when
 * self-employment 1099 income is detected.
 *
 * Data is user-scoped (not trade-scoped) and lives in
 * public.side_income_submissions keyed by user_id. Files go to the
 * 'irs-docs' Storage bucket.
 *
 * Drop into any organizer:
 *   <script>window.KEEPSTEAD_TRADE_CODE = 'xx'; window.sb = sb;</script>
 *   <script src="side-income.js" defer></script>
 * ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const WINDOW_SIZE = 10;
  const CURRENT_YEAR = new Date().getFullYear();
  const YEARS = [];
  for (let y = CURRENT_YEAR - WINDOW_SIZE + 1; y <= CURRENT_YEAR; y++) YEARS.push(String(y));

  const W2_SLOTS   = 3;
  const N1099_SLOTS = 5;

  const FORMS_1099 = [
    '1099-NEC (contractor income)',
    '1099-MISC (other income, rents, prizes)',
    '1099-K (payment platform: Venmo, PayPal, Etsy, eBay)',
    '1099-INT (interest)',
    '1099-DIV (dividends)',
    '1099-B (brokerage — stock / crypto sales)',
    '1099-R (retirement / IRA / pension distributions)',
    '1099-G (unemployment, state tax refund)',
    '1099-SA (HSA distributions)',
    'SSA-1099 (Social Security)',
    'Other 1099'
  ];
  const SELF_EMP_TYPES = ['1099-NEC', '1099-MISC', '1099-K'];

  // Trades that are NOT Schedule C (so the "did you log expenses?" nudge
  // needs to point elsewhere). w2 = no business at all.
  const NON_SCHED_C = { pm: true, w2: true };

  // ── STYLES ──
  function injectStyles() {
    if (document.getElementById('kk-si-styles')) return;
    const css = `
      #kk-si-section .kk-si-sub {
        font-size: 0.9rem; color: #7a6f65; margin-bottom: 1rem; line-height: 1.5;
      }
      #kk-si-section .kk-si-yearbar {
        display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 1rem;
      }
      #kk-si-section .kk-si-year-btn {
        padding: 0.35rem 0.85rem; border: 1.5px solid #d9cfc4; border-radius: 999px;
        background: transparent; font-family: inherit; font-size: 0.82rem;
        color: #7a6f65; cursor: pointer;
      }
      #kk-si-section .kk-si-year-btn.active { background: #c84b31; border-color: #c84b31; color: white; }

      #kk-si-section .kk-si-year-panel { display: none; }
      #kk-si-section .kk-si-year-panel.active { display: block; }

      #kk-si-section .kk-si-slot {
        border: 1px dashed #d9cfc4; border-radius: 8px;
        padding: 0.85rem 1rem; margin-bottom: 0.75rem; background: #faf7f2;
      }
      #kk-si-section .kk-si-slot-title {
        font-size: 0.78rem; font-weight: 600; color: #7a6f65;
        text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.6rem;
      }

      #kk-si-section .kk-si-upload {
        display: flex; gap: 0.6rem; align-items: center;
        font-size: 0.82rem; margin-top: 0.5rem;
      }
      #kk-si-section .kk-si-upload-btn {
        padding: 0.4rem 0.85rem; border: 1.5px dashed #7a6f65;
        border-radius: 6px; background: transparent; color: #7a6f65;
        cursor: pointer; font-family: inherit; font-size: 0.82rem;
      }
      #kk-si-section .kk-si-upload-btn:hover { border-color: #c84b31; color: #c84b31; }
      #kk-si-section .kk-si-upload-link {
        color: #5a7a5e; text-decoration: none; font-weight: 500;
        word-break: break-all;
      }
      #kk-si-section .kk-si-upload-link:hover { text-decoration: underline; }
      #kk-si-section .kk-si-upload-clear {
        background: transparent; border: none; color: #c84b31;
        font-size: 0.8rem; cursor: pointer; padding: 0 0.3rem;
      }

      #kk-si-section .kk-si-banner {
        background: #fff4e6; border: 1px solid #f4c04a;
        border-left: 4px solid #d4a843; border-radius: 0 8px 8px 0;
        padding: 0.85rem 1.1rem; margin-bottom: 1rem;
        font-size: 0.88rem; color: #6b5c3e; line-height: 1.5;
        display: none;
      }
      #kk-si-section .kk-si-banner.open { display: block; }
      #kk-si-section .kk-si-banner strong { color: #1a1a2e; }
      #kk-si-section .kk-si-banner a { color: #c84b31; font-weight: 600; text-decoration: none; }

      #kk-si-section .kk-si-savebar {
        display: flex; justify-content: space-between; align-items: center;
        margin-top: 1rem; font-size: 0.82rem; color: #7a6f65;
      }
      #kk-si-section .kk-si-savebtn {
        padding: 0.5rem 1.2rem; border: none; background: #5a7a5e;
        color: white; border-radius: 999px; font-family: inherit;
        font-size: 0.85rem; font-weight: 600; cursor: pointer;
      }
      #kk-si-section .kk-si-savebtn:hover { background: #486347; }
    `;
    const style = document.createElement('style');
    style.id = 'kk-si-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── HTML BUILDERS ──
  function money(id, label) {
    return `<div class="field"><label>${label}</label><div class="money-field"><input type="number" step="0.01" id="${id}"></div></div>`;
  }
  function txt(id, label, ph) {
    return `<div class="field"><label>${label}</label><input type="text" id="${id}" placeholder="${ph || ''}"></div>`;
  }

  function yearPanelHtml(year) {
    const w2 = Array.from({ length: W2_SLOTS }, (_, i) => {
      const k = `kk-si-${year}-w2-${i}`;
      return `
        <div class="kk-si-slot">
          <div class="kk-si-slot-title">W-2 #${i + 1}</div>
          <div class="form-row">
            ${txt(`${k}-employer`, 'Employer name')}
            ${txt(`${k}-ein`, 'Employer EIN', 'XX-XXXXXXX')}
          </div>
          <div class="form-row four">
            ${money(`${k}-box1`, 'Box 1 — Wages')}
            ${money(`${k}-box2`, 'Box 2 — Fed W/H')}
            ${money(`${k}-box3`, 'Box 3 — SS wages')}
            ${money(`${k}-box4`, 'Box 4 — SS tax')}
          </div>
          <div class="form-row four">
            ${money(`${k}-box5`, 'Box 5 — Medicare wages')}
            ${money(`${k}-box6`, 'Box 6 — Medicare tax')}
            ${money(`${k}-box12d`, 'Box 12 — 401(k) (D)')}
            ${money(`${k}-box14`, 'Box 14 — Other')}
          </div>
          <div class="form-row three">
            ${money(`${k}-state-wages`, 'State wages (Box 16)')}
            ${money(`${k}-state-tax`, 'State tax (Box 17)')}
            ${txt(`${k}-state`, 'State', '2-letter')}
          </div>
          ${uploadSlotHtml(`${k}-file`, 'w2', year)}
        </div>`;
    }).join('');

    const n1099 = Array.from({ length: N1099_SLOTS }, (_, i) => {
      const k = `kk-si-${year}-1099-${i}`;
      const typeOptions = FORMS_1099.map(t => `<option>${t}</option>`).join('');
      return `
        <div class="kk-si-slot">
          <div class="kk-si-slot-title">1099 #${i + 1}</div>
          <div class="form-row">
            <div class="field">
              <label>Form type</label>
              <select id="${k}-type"><option value="">Select...</option>${typeOptions}</select>
            </div>
            ${txt(`${k}-payer`, 'Payer name')}
          </div>
          <div class="form-row three">
            ${money(`${k}-gross`, 'Gross / Box 1')}
            ${money(`${k}-fed-wh`, 'Federal withheld')}
            ${money(`${k}-state-wh`, 'State withheld')}
          </div>
          <div class="form-row single">
            ${txt(`${k}-notes`, 'Notes', 'Anything odd about this form')}
          </div>
          ${uploadSlotHtml(`${k}-file`, '1099', year)}
        </div>`;
    }).join('');

    return `
      <div class="kk-si-year-panel" id="kk-si-panel-${year}">

        <div class="kk-si-banner" id="kk-si-banner-${year}">
          <strong>Heads up — this looks like self-employment income.</strong>
          If any 1099-NEC, 1099-MISC, or 1099-K here is from work you did yourself
          (contracting, side gigs, platform sales), you can deduct expenses against it —
          mileage, supplies, phone, home office, software, fees, etc.
          <br><br>
          Before you request a report, make sure you've filled in the Schedule C
          worktable on this page. No business organizer active? Add a General Small Biz
          organizer from the Keepstead home screen.
        </div>

        <div class="card" style="margin-bottom:1rem;">
          <div class="section-label">W-2 Wages (${year})</div>
          ${w2}
        </div>

        <div class="card" style="margin-bottom:1rem;">
          <div class="section-label">1099s Received (${year})</div>
          ${n1099}
        </div>

        <div class="card" style="margin-bottom:1rem;">
          <div class="section-label">IRS Wage &amp; Income Transcript (${year})</div>
          <div style="font-size:.85rem;color:#7a6f65;line-height:1.5;margin-bottom:.6rem;">
            Upload your IRS transcript PDF so your preparer can cross-check everything
            reported to the IRS under your SSN. Get it free at
            <strong>irs.gov/individuals/get-transcript</strong> →
            Wage &amp; Income Transcript for ${year}.
          </div>
          ${uploadSlotHtml(`kk-si-${year}-transcript`, 'transcript', year)}
        </div>

      </div>`;
  }

  function uploadSlotHtml(fieldId, kind, year) {
    return `
      <div class="kk-si-upload" data-kind="${kind}" data-year="${year}">
        <button type="button" class="kk-si-upload-btn" onclick="window.__kkSi.pickFile('${fieldId}','${kind}','${year}')">
          📎 Attach file
        </button>
        <input type="hidden" id="${fieldId}">
        <span id="${fieldId}-label" style="font-size:.82rem;color:#7a6f65;">No file attached</span>
      </div>`;
  }

  // ── INSERTION ──
  function mount() {
    const container = document.querySelector('.container');
    if (!container) {
      console.warn('[side-income] no .container found on page — skipping');
      return;
    }

    // Build section
    const sec = document.createElement('div');
    sec.className = 'year-section';
    sec.id = 'section-wages';
    sec.innerHTML = `
      <div class="client-card" id="kk-si-section">
        <div class="section-label">Wages, 1099s &amp; IRS Transcripts</div>
        <div class="kk-si-sub">
          Your W-2s, 1099s, and IRS Wage &amp; Income transcripts live here — shared
          across every Keepstead organizer for the same filer. Fill these even if
          your main income is from the business above, so your preparer sees the
          whole return.
        </div>
        <div class="kk-si-yearbar" id="kk-si-yearbar"></div>
        ${YEARS.slice().reverse().map(yearPanelHtml).join('')}
        <div class="kk-si-savebar">
          <span id="kk-si-status">Ready.</span>
          <button class="kk-si-savebtn" onclick="window.__kkSi.save()">💾 Save wages &amp; 1099s</button>
        </div>
      </div>`;

    // Insert before summary if present, else at end
    const summarySec = container.querySelector('#section-summary');
    if (summarySec) container.insertBefore(sec, summarySec);
    else container.appendChild(sec);

    // Year bar
    const bar = document.getElementById('kk-si-yearbar');
    YEARS.slice().reverse().forEach((y, idx) => {
      const btn = document.createElement('button');
      btn.className = 'kk-si-year-btn' + (idx === 0 ? ' active' : '');
      btn.type = 'button';
      btn.textContent = y;
      btn.onclick = () => switchYear(y);
      bar.appendChild(btn);
    });
    // Show newest year
    switchYear(YEARS[YEARS.length - 1]);

    // Add a tab to the years-nav so existing showSection() picks it up
    addNavTab();

    // Wire change listeners for missed-deductions banner
    wireBannerListeners();
  }

  function addNavTab() {
    const nav = document.getElementById('years-nav') || document.querySelector('.years-nav');
    if (!nav) return;
    // Find Summary button — insert our tab before it.
    const summaryBtn = Array.from(nav.querySelectorAll('button'))
      .find(b => /summary/i.test(b.textContent));
    const tab = document.createElement('button');
    tab.className = 'year-tab';
    tab.type = 'button';
    tab.textContent = 'Wages & 1099s';
    tab.setAttribute('onclick', "showSection('wages')");
    if (summaryBtn) nav.insertBefore(tab, summaryBtn);
    else nav.appendChild(tab);
  }

  function switchYear(year) {
    document.querySelectorAll('#kk-si-section .kk-si-year-panel').forEach(p =>
      p.classList.toggle('active', p.id === 'kk-si-panel-' + year)
    );
    document.querySelectorAll('#kk-si-section .kk-si-year-btn').forEach(b =>
      b.classList.toggle('active', b.textContent.trim() === year)
    );
  }

  function wireBannerListeners() {
    YEARS.forEach(year => {
      for (let i = 0; i < N1099_SLOTS; i++) {
        const typeEl  = document.getElementById(`kk-si-${year}-1099-${i}-type`);
        const grossEl = document.getElementById(`kk-si-${year}-1099-${i}-gross`);
        const recheck = () => checkBanner(year);
        if (typeEl)  typeEl.addEventListener('change', recheck);
        if (grossEl) grossEl.addEventListener('input', recheck);
      }
    });
  }

  function checkBanner(year) {
    const trade = (window.KEEPSTEAD_TRADE_CODE || '').toLowerCase();
    // pm = Schedule E; w2 = no business. Trade organizers (gn, dc, etc.) use Sched C
    // and users can fill expenses right there — banner still useful as a nudge.
    let selfEmpDetected = false;
    for (let i = 0; i < N1099_SLOTS; i++) {
      const type = (document.getElementById(`kk-si-${year}-1099-${i}-type`)?.value || '');
      const gross = parseFloat(document.getElementById(`kk-si-${year}-1099-${i}-gross`)?.value) || 0;
      if (gross > 0 && SELF_EMP_TYPES.some(t => type.includes(t))) {
        selfEmpDetected = true;
        break;
      }
    }
    const banner = document.getElementById('kk-si-banner-' + year);
    if (banner) banner.classList.toggle('open', selfEmpDetected);
  }

  // ── STATE COLLECTION ──
  function collect() {
    const blob = { years: {} };
    YEARS.forEach(year => {
      const y = { w2: [], forms_1099: [], transcript: '' };
      for (let i = 0; i < W2_SLOTS; i++) {
        const k = `kk-si-${year}-w2-${i}`;
        y.w2.push({
          employer:   val(`${k}-employer`),
          ein:        val(`${k}-ein`),
          box1:       val(`${k}-box1`),
          box2:       val(`${k}-box2`),
          box3:       val(`${k}-box3`),
          box4:       val(`${k}-box4`),
          box5:       val(`${k}-box5`),
          box6:       val(`${k}-box6`),
          box12d:     val(`${k}-box12d`),
          box14:      val(`${k}-box14`),
          state_wages: val(`${k}-state-wages`),
          state_tax:  val(`${k}-state-tax`),
          state:      val(`${k}-state`),
          file_path:  val(`${k}-file`)
        });
      }
      for (let i = 0; i < N1099_SLOTS; i++) {
        const k = `kk-si-${year}-1099-${i}`;
        y.forms_1099.push({
          type:       val(`${k}-type`),
          payer:      val(`${k}-payer`),
          gross:      val(`${k}-gross`),
          fed_wh:     val(`${k}-fed-wh`),
          state_wh:   val(`${k}-state-wh`),
          notes:      val(`${k}-notes`),
          file_path:  val(`${k}-file`)
        });
      }
      y.transcript = val(`kk-si-${year}-transcript`);
      blob.years[year] = y;
    });
    return blob;
  }

  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

  function hydrate(blob) {
    const yearsBlob = (blob && blob.years) || {};
    YEARS.forEach(year => {
      const y = yearsBlob[year] || {};
      (y.w2 || []).forEach((row, i) => {
        const k = `kk-si-${year}-w2-${i}`;
        setVal(`${k}-employer`, row.employer);
        setVal(`${k}-ein`, row.ein);
        setVal(`${k}-box1`, row.box1);
        setVal(`${k}-box2`, row.box2);
        setVal(`${k}-box3`, row.box3);
        setVal(`${k}-box4`, row.box4);
        setVal(`${k}-box5`, row.box5);
        setVal(`${k}-box6`, row.box6);
        setVal(`${k}-box12d`, row.box12d);
        setVal(`${k}-box14`, row.box14);
        setVal(`${k}-state-wages`, row.state_wages);
        setVal(`${k}-state-tax`, row.state_tax);
        setVal(`${k}-state`, row.state);
        setVal(`${k}-file`, row.file_path);
        updateUploadLabel(`${k}-file`, row.file_path);
      });
      (y.forms_1099 || []).forEach((row, i) => {
        const k = `kk-si-${year}-1099-${i}`;
        setVal(`${k}-type`, row.type);
        setVal(`${k}-payer`, row.payer);
        setVal(`${k}-gross`, row.gross);
        setVal(`${k}-fed-wh`, row.fed_wh);
        setVal(`${k}-state-wh`, row.state_wh);
        setVal(`${k}-notes`, row.notes);
        setVal(`${k}-file`, row.file_path);
        updateUploadLabel(`${k}-file`, row.file_path);
      });
      setVal(`kk-si-${year}-transcript`, y.transcript);
      updateUploadLabel(`kk-si-${year}-transcript`, y.transcript);
      checkBanner(year);
    });
  }

  function updateUploadLabel(fieldId, pathOrEmpty) {
    const labelEl = document.getElementById(fieldId + '-label');
    if (!labelEl) return;
    if (!pathOrEmpty) {
      labelEl.textContent = 'No file attached';
      labelEl.innerHTML = 'No file attached';
      return;
    }
    const basename = String(pathOrEmpty).split('/').pop();
    labelEl.innerHTML =
      `<a href="#" class="kk-si-upload-link" onclick="window.__kkSi.view('${pathOrEmpty}'); return false;">${basename}</a>
       <button class="kk-si-upload-clear" type="button" onclick="window.__kkSi.clearFile('${fieldId}')">✕</button>`;
  }

  // ── FILE PICK + UPLOAD ──
  async function pickFile(fieldId, kind, year) {
    const sb = window.sb;
    if (!sb) { status('Supabase client not ready.'); return; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { status('Sign in to attach files.'); return; }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/png,image/jpeg,image/heic';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_');
      const path = `${session.user.id}/${year}/${kind}/${Date.now()}_${safeName}`;
      status('Uploading ' + file.name + '…');
      try {
        const { error: upErr } = await sb.storage.from('irs-docs').upload(path, file, {
          upsert: false,
          contentType: file.type || 'application/octet-stream'
        });
        if (upErr) throw upErr;
        setVal(fieldId, path);
        updateUploadLabel(fieldId, path);
        status('Attached ✓');
        // Auto-save after a successful upload so path isn't lost.
        save(true);
      } catch (e) {
        status('Upload failed: ' + e.message);
      }
    };
    input.click();
  }

  async function view(path) {
    const sb = window.sb;
    if (!sb) return;
    const { data, error } = await sb.storage.from('irs-docs').createSignedUrl(path, 60 * 60);
    if (error) { status('Could not open: ' + error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function clearFile(fieldId) {
    if (!confirm('Remove this attachment? (The file stays in storage until Save.)')) return;
    setVal(fieldId, '');
    updateUploadLabel(fieldId, '');
    save(true);
  }

  // ── SAVE / LOAD ──
  async function save(silent) {
    const sb = window.sb;
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { status('Sign in to save.'); return; }
    if (!silent) status('Saving…');
    const payload = {
      user_id: session.user.id,
      data: collect(),
      updated_at: new Date().toISOString()
    };
    const { error } = await sb
      .from('side_income_submissions')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) status('Save failed: ' + error.message);
    else status('Saved ✓ ' + new Date().toLocaleTimeString());
  }

  async function load() {
    const sb = window.sb;
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    status('Loading…');
    const { data, error } = await sb
      .from('side_income_submissions')
      .select('data,updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) { status('Load failed: ' + error.message); return; }
    if (!data) { status('Empty — fill in what applies.'); return; }
    hydrate(data.data || {});
    status('Loaded ✓ ' + (data.updated_at ? new Date(data.updated_at).toLocaleString() : ''));
  }

  function status(msg) {
    const el = document.getElementById('kk-si-status');
    if (el) el.textContent = msg;
  }

  // ── LIFECYCLE ──
  function init() {
    injectStyles();
    mount();
    window.__kkSi = { save, load, pickFile, view, clearFile, switchYear };

    // Hook auth state so load/clear tracks sessions.
    const sb = window.sb;
    if (!sb) return;
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) load();
    });
    sb.auth.onAuthStateChange((_ev, session) => {
      if (session) load();
      else {
        // Wipe our inputs on sign-out — privacy.
        hydrate({});
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
