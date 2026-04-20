/* ════════════════════════════════════════════════════════════════
 * Keepstead — "Complete Return(s)" workflow
 *
 * Injects a "Complete Return(s)" button at the bottom of every
 * organizer. Clicking it hides the organizer view and shows a
 * dedicated full-page screen where the filer picks a completion
 * package, leaves optional notes, and proceeds to Stripe Checkout.
 *
 * Drop into every organizer:
 *   <script>window.KEEPSTEAD_TRADE_CODE = 'pm'; window.sb = sb;</script>
 *   <script src="request-kari.js" defer></script>
 * ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  const PRODUCTS = [
    {
      key: 'prep_worksheet',
      name: 'Preparer Worksheet',
      price: 49,
      blurb: 'A clean, one-page preparer-ready worksheet for this trade. Print it to file yourself, or hand it to your own tax preparer.'
    },
    {
      key: 'tax_reference',
      name: 'Tax Reference Doc',
      price: 79,
      blurb: 'A deeper tax reference for this trade — deductions, categorizations, and the nuance notes a seasoned preparer would flag.'
    },
    {
      key: 'bundle_single',
      name: 'Bundle — Single Trade',
      price: 109,
      blurb: 'Both the Preparer Worksheet and the Tax Reference Doc for this one trade. Save $19 vs buying them separately.',
      recommended: true
    },
    {
      key: 'bundle_unlimited',
      name: 'Bundle — Unlimited Trades',
      price: 159,
      blurb: 'Both docs for every trade you run. Best for multi-business filers with more than one Schedule C or mixed income.'
    }
  ];

  // ── STYLES ──
  function injectStyles() {
    if (document.getElementById('kk-req-styles')) return;
    const css = `
      /* Bottom-of-organizer CTA */
      .kk-req-trigger-wrap { text-align: center; padding: 2rem 0 2.5rem; }
      .kk-req-trigger {
        background: #c84b31; color: white; border: none;
        padding: 1rem 2.4rem; border-radius: 999px;
        font-family: 'DM Sans', sans-serif; font-size: 1rem; font-weight: 600;
        cursor: pointer; box-shadow: 0 8px 24px rgba(200, 75, 49, 0.25);
        transition: all 0.2s; letter-spacing: 0.01em;
      }
      .kk-req-trigger:hover { background: #a83c27; transform: translateY(-1px); }
      .kk-req-sub {
        font-size: 0.82rem; color: #7a6f65; margin-top: 0.7rem; line-height: 1.5;
      }

      /* Success banner — shown when user returns from Stripe */
      .kk-req-banner {
        max-width: 720px; margin: 1rem auto 0;
        padding: 0.85rem 1.2rem; border-radius: 10px;
        font-size: 0.9rem; background: #d3e4d6; color: #2e5030;
        border-left: 4px solid #5a7a5e; display: none;
      }
      .kk-req-banner.open { display: block; }

      /* Full-page screen (replaces the organizer view while choosing) */
      #kk-req-screen {
        display: none;
        min-height: 100vh;
        background: #faf7f2;
        font-family: 'DM Sans', sans-serif;
        color: #1a1a2e;
      }
      #kk-req-screen.open { display: block; }

      #kk-req-screen .kk-req-topbar {
        background: #1a1a2e; color: #faf7f2;
        padding: 1.2rem 2rem;
        display: flex; justify-content: space-between; align-items: center;
        flex-wrap: wrap; gap: 1rem;
      }
      #kk-req-screen .kk-req-back {
        background: transparent; border: 1px solid rgba(255,255,255,0.2);
        color: #a89e94; padding: 0.45rem 1rem; border-radius: 999px;
        font-family: inherit; font-size: 0.85rem; cursor: pointer;
      }
      #kk-req-screen .kk-req-back:hover { border-color: white; color: white; }
      #kk-req-screen .kk-req-brand {
        font-family: 'DM Serif Display', serif; font-size: 1.4rem;
      }
      #kk-req-screen .kk-req-brand small {
        font-family: 'DM Sans', sans-serif; font-size: 0.7rem;
        color: #d4a843; letter-spacing: 0.15em; margin-left: 0.5rem;
        text-transform: uppercase;
      }

      #kk-req-screen .kk-req-main {
        max-width: 1080px; margin: 0 auto; padding: 3rem 1.5rem 4rem;
      }
      #kk-req-screen .kk-req-hero h1 {
        font-family: 'DM Serif Display', serif;
        font-size: clamp(1.8rem, 4vw, 2.6rem);
        line-height: 1.1; margin-bottom: 0.6rem;
      }
      #kk-req-screen .kk-req-hero p {
        font-size: 1rem; color: #7a6f65; max-width: 640px;
        line-height: 1.6; margin-bottom: 2.5rem;
      }

      #kk-req-screen .kk-req-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 1rem;
        margin-bottom: 2rem;
      }
      #kk-req-screen .kk-req-card {
        position: relative;
        background: white;
        border: 2px solid #d9cfc4;
        border-radius: 14px;
        padding: 1.5rem 1.4rem 1.6rem;
        cursor: pointer;
        transition: all 0.15s;
        display: flex; flex-direction: column; gap: 0.6rem;
      }
      #kk-req-screen .kk-req-card:hover { border-color: #c84b31; transform: translateY(-2px); box-shadow: 0 10px 30px rgba(26, 26, 46, 0.08); }
      #kk-req-screen .kk-req-card.selected {
        border-color: #c84b31; background: #fff5f0;
        box-shadow: 0 10px 30px rgba(200, 75, 49, 0.12);
      }
      #kk-req-screen .kk-req-card input[type="radio"] {
        position: absolute; opacity: 0; pointer-events: none;
      }
      #kk-req-screen .kk-req-card .kk-req-recommend {
        position: absolute; top: -10px; right: 14px;
        background: #d4a843; color: #1a1a2e;
        font-size: 0.65rem; font-weight: 700;
        letter-spacing: 0.12em; text-transform: uppercase;
        padding: 0.25rem 0.7rem; border-radius: 999px;
      }
      #kk-req-screen .kk-req-card-name {
        font-family: 'DM Serif Display', serif; font-size: 1.2rem;
        color: #1a1a2e;
      }
      #kk-req-screen .kk-req-card-price {
        font-family: 'DM Serif Display', serif; font-size: 1.8rem;
        color: #c84b31; font-weight: 400;
      }
      #kk-req-screen .kk-req-card-price small {
        font-family: 'DM Sans', sans-serif; font-size: 0.78rem;
        color: #7a6f65; font-weight: 500; margin-left: 0.25rem;
      }
      #kk-req-screen .kk-req-card-blurb {
        font-size: 0.88rem; color: #7a6f65; line-height: 1.55; flex: 1;
      }
      #kk-req-screen .kk-req-card-select {
        margin-top: auto;
        font-size: 0.82rem; color: #c84b31; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      #kk-req-screen .kk-req-card:not(.selected) .kk-req-card-select { color: #7a6f65; }
      #kk-req-screen .kk-req-card.selected .kk-req-card-select::before { content: '✓ '; }

      #kk-req-screen .kk-req-notes-label {
        display: block; font-size: 0.82rem; font-weight: 500;
        color: #7a6f65; margin-bottom: 0.4rem;
      }
      #kk-req-screen .kk-req-notes {
        width: 100%; padding: 0.75rem 0.95rem; font-family: inherit;
        border: 1.5px solid #d9cfc4; border-radius: 10px; background: white;
        font-size: 0.92rem; min-height: 96px; resize: vertical;
        color: #1a1a2e; margin-bottom: 1.5rem;
      }
      #kk-req-screen .kk-req-notes:focus { outline: none; border-color: #c84b31; }

      #kk-req-screen .kk-req-footer {
        display: flex; justify-content: space-between; align-items: center;
        gap: 1rem; padding-top: 1.5rem; border-top: 1px solid #d9cfc4;
        flex-wrap: wrap;
      }
      #kk-req-screen .kk-req-total {
        font-family: 'DM Serif Display', serif; font-size: 1.4rem; color: #1a1a2e;
      }
      #kk-req-screen .kk-req-total small {
        font-family: 'DM Sans', sans-serif; font-size: 0.8rem; color: #7a6f65;
        display: block; margin-top: 2px;
      }
      #kk-req-screen .kk-req-actions { display: flex; gap: 0.6rem; }
      #kk-req-screen .kk-req-btn {
        padding: 0.85rem 1.8rem; border-radius: 999px; font-family: inherit;
        font-size: 0.95rem; font-weight: 600; cursor: pointer; border: none;
      }
      #kk-req-screen .kk-req-btn-primary { background: #c84b31; color: white; }
      #kk-req-screen .kk-req-btn-primary:hover:not(:disabled) { background: #a83c27; }
      #kk-req-screen .kk-req-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      #kk-req-screen .kk-req-btn-secondary {
        background: transparent; border: 1.5px solid #d9cfc4; color: #7a6f65;
      }
      #kk-req-screen .kk-req-btn-secondary:hover { border-color: #1a1a2e; color: #1a1a2e; }
      #kk-req-screen .kk-req-err {
        color: #c84b31; font-size: 0.88rem; margin-top: 0.6rem;
        min-height: 1.2rem; text-align: right;
      }

      #kk-req-screen .kk-req-section-label {
        font-size: 0.72rem; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.18em;
        color: #7a6f65; margin-bottom: 0.85rem;
      }

      #kk-req-screen .kk-req-years-hint {
        font-size: 0.85rem; color: #7a6f65; line-height: 1.5;
        margin-bottom: 0.85rem; margin-top: -0.3rem;
      }
      #kk-req-screen .kk-req-years {
        display: flex; flex-wrap: wrap; gap: 0.5rem;
        margin-bottom: 2rem;
      }
      #kk-req-screen .kk-req-year-chip {
        padding: 0.5rem 1rem; border: 2px solid #d9cfc4;
        border-radius: 999px; background: white; color: #7a6f65;
        font-family: inherit; font-size: 0.9rem; font-weight: 500;
        cursor: pointer; transition: all 0.15s; user-select: none;
      }
      #kk-req-screen .kk-req-year-chip:hover { border-color: #c84b31; color: #c84b31; }
      #kk-req-screen .kk-req-year-chip.selected {
        background: #c84b31; border-color: #c84b31; color: white;
      }
      #kk-req-screen .kk-req-year-chip.selected::before { content: '✓ '; }

      #kk-req-screen .kk-req-kari-block {
        margin-top: 3rem; padding: 2rem 1.8rem;
        background: #1a1a2e; color: #faf7f2;
        border-radius: 14px; border-left: 4px solid #d4a843;
      }
      #kk-req-screen .kk-req-kari-tag {
        font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em;
        text-transform: uppercase; color: #d4a843; margin-bottom: 0.75rem;
      }
      #kk-req-screen .kk-req-kari-block h2 {
        font-family: 'DM Serif Display', serif; font-size: 1.5rem;
        margin-bottom: 0.75rem; color: #faf7f2;
      }
      #kk-req-screen .kk-req-kari-block p {
        font-size: 0.92rem; line-height: 1.6; color: #d4cec3;
        margin-bottom: 0.75rem;
      }
      #kk-req-screen .kk-req-kari-block strong { color: #faf7f2; }
      #kk-req-screen .kk-req-kari-note {
        font-size: 0.82rem !important; color: #a89e94 !important;
        margin-bottom: 1.25rem !important;
      }
      #kk-req-screen .kk-req-kari-btn {
        display: inline-block; padding: 0.75rem 1.6rem;
        background: #d4a843; color: #1a1a2e;
        border-radius: 999px; font-family: inherit; font-size: 0.92rem;
        font-weight: 600; text-decoration: none;
        transition: all 0.2s;
      }
      #kk-req-screen .kk-req-kari-btn:hover {
        background: #e4b953; transform: translateY(-1px);
      }
    `;
    const style = document.createElement('style');
    style.id = 'kk-req-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── RENDER ──
  function injectTriggerAndScreen() {
    const host = document.querySelector('.container') || document.body;

    // Bottom-of-organizer trigger
    const trigger = document.createElement('div');
    trigger.className = 'kk-req-trigger-wrap';
    trigger.id = 'kk-req-trigger-wrap';
    trigger.innerHTML = `
      <button class="kk-req-trigger" type="button" onclick="window.__kkReq.open()">
        Complete Return(s)
      </button>
      <div class="kk-req-sub">
        Turn your organizer entries into preparer-ready documents you can file yourself or hand to your preparer.
      </div>`;
    host.appendChild(trigger);

    // Success banner (shown after Stripe success redirect)
    const banner = document.createElement('div');
    banner.className = 'kk-req-banner';
    banner.id = 'kk-req-banner';
    banner.innerHTML = `✓ Payment received — your documents are being generated. You'll see them on the Keepstead home screen when they're ready.`;
    host.appendChild(banner);

    // Full-page screen
    const screen = document.createElement('div');
    screen.id = 'kk-req-screen';
    screen.innerHTML = `
      <div class="kk-req-topbar">
        <button class="kk-req-back" type="button" onclick="window.__kkReq.close()">← Back to organizer</button>
        <div class="kk-req-brand">Keepstead™ <small>Complete Return(s)</small></div>
      </div>

      <div class="kk-req-main">
        <div class="kk-req-hero">
          <h1>Finish your return.</h1>
          <p>
            Keepstead turns your organizer entries into preparer-ready documents.
            Print them to file yourself, or email them to your own tax preparer.
            You stay in control.
          </p>
        </div>

        <div class="kk-req-section-label">Document Packages</div>

        <div class="kk-req-grid" id="kk-req-grid"></div>

        <div class="kk-req-section-label" style="margin-top:2rem;">Which tax years do you need docs for?</div>
        <div class="kk-req-years-hint">
          Pick one or more. Pricing is per year ordered — four years of docs costs 4× the package price,
          paid once at checkout.
        </div>
        <div class="kk-req-years" id="kk-req-years"></div>

        <label class="kk-req-notes-label" for="kk-req-notes-input">
          Anything your preparer (or you) should know about this return? (optional)
        </label>
        <textarea class="kk-req-notes" id="kk-req-notes-input"
          placeholder="e.g. &quot;Focus on 2024 — I'm filing an extension.&quot;"></textarea>

        <div class="kk-req-footer">
          <div class="kk-req-total">
            <span id="kk-req-total-amount">$109</span>
            <small id="kk-req-total-sub">$109 × 1 year · one-time charge</small>
          </div>
          <div class="kk-req-actions">
            <button class="kk-req-btn kk-req-btn-secondary" type="button" onclick="window.__kkReq.close()">Cancel</button>
            <button class="kk-req-btn kk-req-btn-primary" type="button" id="kk-req-continue" onclick="window.__kkReq.continueToPayment()">Continue to Payment →</button>
          </div>
        </div>
        <div class="kk-req-err" id="kk-req-err"></div>

        <div class="kk-req-kari-block">
          <div class="kk-req-kari-tag">Full-Service Option</div>
          <h2>Prefer a CPA to prepare and file the return for you?</h2>
          <p>
            <strong>Kari Hoglund Kounkel</strong> of <strong>CARES Consulting, Inc.</strong>
            can take your Keepstead organizer, prepare the return end-to-end, and
            file it on your behalf — reviewed, e-signed, submitted.
          </p>
          <p class="kk-req-kari-note">
            Pricing depends on complexity (number of trades, state, years). Reach out for a quote.
          </p>
          <a class="kk-req-kari-btn"
             href="mailto:kari@karikounkel.com?subject=Keepstead%20%E2%80%94%20Full-Service%20Return%20Request"
             target="_blank" rel="noopener">
            Contact Kari →
          </a>
        </div>
      </div>`;
    document.body.appendChild(screen);

    // Cards — default-select the recommended one, else the first
    const defaultKey = (PRODUCTS.find(p => p.recommended) || PRODUCTS[0]).key;
    const grid = document.getElementById('kk-req-grid');
    grid.innerHTML = PRODUCTS.map(p => `
      <label class="kk-req-card ${p.key === defaultKey ? 'selected' : ''}" data-key="${p.key}">
        ${p.recommended ? '<span class="kk-req-recommend">Most popular</span>' : ''}
        <input type="radio" name="kk-req-product" value="${p.key}" ${p.key === defaultKey ? 'checked' : ''}>
        <div class="kk-req-card-name">${p.name}</div>
        <div class="kk-req-card-price">$${p.price}<small>/yr</small></div>
        <div class="kk-req-card-blurb">${p.blurb}</div>
        <div class="kk-req-card-select">${p.key === defaultKey ? 'Selected' : 'Select this plan'}</div>
      </label>
    `).join('');

    grid.addEventListener('change', (e) => {
      if (e.target.name !== 'kk-req-product') return;
      grid.querySelectorAll('.kk-req-card').forEach(el => {
        const isSelected = el.dataset.key === e.target.value;
        el.classList.toggle('selected', isSelected);
        el.querySelector('.kk-req-card-select').textContent =
          isSelected ? 'Selected' : 'Select this plan';
      });
      recomputeTotal();
    });

    // Year chips — 10-year rolling window, newest first. Current year pre-selected.
    const CURRENT_YEAR = new Date().getFullYear();
    const YEAR_WINDOW_SIZE = 10;
    const yearsHost = document.getElementById('kk-req-years');
    for (let y = CURRENT_YEAR; y > CURRENT_YEAR - YEAR_WINDOW_SIZE; y--) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'kk-req-year-chip' + (y === CURRENT_YEAR ? ' selected' : '');
      chip.dataset.year = String(y);
      chip.textContent = String(y);
      chip.onclick = () => { chip.classList.toggle('selected'); recomputeTotal(); };
      yearsHost.appendChild(chip);
    }

    // Initial total
    recomputeTotal();

    // API
    window.__kkReq = { open, close, continueToPayment };
  }

  function getSelectedYears() {
    return Array.from(document.querySelectorAll('#kk-req-years .kk-req-year-chip.selected'))
      .map(el => el.dataset.year)
      .sort();  // ascending for storage tidiness
  }

  function getSelectedProduct() {
    const picked = document.querySelector('input[name="kk-req-product"]:checked');
    const key = picked ? picked.value : PRODUCTS[0].key;
    return PRODUCTS.find(p => p.key === key) || PRODUCTS[0];
  }

  function recomputeTotal() {
    const p = getSelectedProduct();
    const n = getSelectedYears().length;
    const total = p.price * n;
    document.getElementById('kk-req-total-amount').textContent =
      n === 0 ? '—' : '$' + total.toLocaleString();
    document.getElementById('kk-req-total-sub').textContent =
      n === 0
        ? 'pick at least one year'
        : `$${p.price} × ${n} year${n === 1 ? '' : 's'} · one-time charge`;
  }

  // ── OPEN / CLOSE — hide .app, show screen (and reverse) ──
  let previousScroll = 0;

  function open() {
    document.getElementById('kk-req-err').textContent = '';
    const app = document.getElementById('app');
    const authScreen = document.getElementById('auth-screen');
    previousScroll = window.scrollY || 0;
    if (app) app.style.display = 'none';
    if (authScreen) authScreen.style.display = 'none';
    document.getElementById('kk-req-screen').classList.add('open');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function close() {
    document.getElementById('kk-req-screen').classList.remove('open');
    const app = document.getElementById('app');
    if (app) app.style.display = '';
    window.scrollTo({ top: previousScroll, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  async function continueToPayment() {
    const btn = document.getElementById('kk-req-continue');
    const err = document.getElementById('kk-req-err');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Redirecting…';

    try {
      const sb = window.sb;
      if (!sb) throw new Error('Supabase client not loaded on this page.');

      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        err.textContent = 'Please sign in first, then try again.';
        return;
      }

      const yearsOrdered = getSelectedYears();
      if (!yearsOrdered.length) {
        err.textContent = 'Pick at least one tax year before continuing.';
        return;
      }
      const product = getSelectedProduct();
      const notes = document.getElementById('kk-req-notes-input').value.trim();
      const tradeCode = window.KEEPSTEAD_TRADE_CODE || 'unknown';

      const { data, error: fnErr } = await sb.functions.invoke('create-checkout-session', {
        body: {
          report_type: product.key,
          trade_code: tradeCode,
          years_ordered: yearsOrdered,
          notes,
          return_url: window.location.href.split('?')[0],
          user_email: session.user.email,
          user_id: session.user.id
        }
      });
      if (fnErr) throw fnErr;
      if (!data?.url) throw new Error('No checkout URL returned.');
      window.location.href = data.url;
    } catch (e) {
      err.textContent = 'Could not start checkout: ' + (e.message || e);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Continue to Payment →';
    }
  }

  // ── SUCCESS BANNER (after Stripe success redirect) ──
  function maybeShowBanner() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kari_req') === 'success') {
      const banner = document.getElementById('kk-req-banner');
      if (banner) banner.classList.add('open');
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, clean);
    }
  }

  // ── BOOTSTRAP ──
  onReady(() => {
    injectStyles();
    injectTriggerAndScreen();
    maybeShowBanner();
  });
})();
