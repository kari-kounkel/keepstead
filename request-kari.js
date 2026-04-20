/* ════════════════════════════════════════════════════════════════
 * Keepstead — "Request Kari to Complete" widget
 * Drop into every trade organizer:
 *   <script>window.KEEPSTEAD_TRADE_CODE = 'pm';</script>
 *   <script src="request-kari.js" defer></script>
 * Relies on `sb` (the Supabase client) already being defined on the page.
 * Calls Supabase Edge Function `create-checkout-session` to produce a
 * Stripe Checkout URL, then redirects.
 * ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Wait until page + sb are ready
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  const PRODUCTS = [
    {
      key: 'prep_worksheet',
      name: 'Preparer Worksheet',
      price: 49,
      blurb: 'Clean one-page preparer-ready worksheet for this single trade. Great if you already have a preparer.'
    },
    {
      key: 'tax_reference',
      name: 'Tax Reference Doc',
      price: 79,
      blurb: 'Deep tax-reference doc for this trade — deductions, categorizations, nuance notes Kari would have flagged.'
    },
    {
      key: 'bundle_single',
      name: 'Bundle (single trade)',
      price: 129,
      blurb: 'Both the Preparer Worksheet and the Tax Reference Doc for this trade. Save $0 — priced to move.'
    },
    {
      key: 'bundle_unlimited',
      name: 'Bundle (unlimited trades)',
      price: 199,
      blurb: 'Both docs for every trade you run. Best for multi-business filers.'
    }
  ];

  const STATUS_LABEL = {
    pending: 'Pending',
    in_progress: 'In progress',
    done: 'Complete',
    cancelled: 'Cancelled'
  };

  // ── STYLES ──
  function injectStyles() {
    const css = `
      .kk-req-trigger-wrap { text-align: center; padding: 1.5rem 0 2rem; }
      .kk-req-trigger {
        background: #c84b31; color: white; border: none;
        padding: 0.95rem 1.8rem; border-radius: 999px;
        font-family: 'DM Sans', sans-serif; font-size: 0.95rem; font-weight: 600;
        cursor: pointer; box-shadow: 0 6px 20px rgba(200, 75, 49, 0.25);
        transition: all 0.2s;
      }
      .kk-req-trigger:hover { background: #a83c27; transform: translateY(-1px); }
      .kk-req-sub {
        font-size: 0.82rem; color: #7a6f65; margin-top: 0.6rem; line-height: 1.5;
      }

      .kk-req-overlay {
        display: none;
        position: fixed; inset: 0; background: rgba(26, 26, 46, 0.6);
        z-index: 1500; align-items: center; justify-content: center; padding: 1rem;
      }
      .kk-req-overlay.open { display: flex; }
      .kk-req-modal {
        background: #faf7f2; border-radius: 16px;
        width: 100%; max-width: 620px; max-height: 90vh; overflow-y: auto;
        padding: 2rem 2rem 1.5rem;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        font-family: 'DM Sans', sans-serif; color: #1a1a2e;
      }
      .kk-req-modal h2 {
        font-family: 'DM Serif Display', serif; font-size: 1.5rem; margin-bottom: 0.3rem;
      }
      .kk-req-modal .kk-req-lead {
        color: #7a6f65; font-size: 0.92rem; margin-bottom: 1.25rem; line-height: 1.5;
      }

      .kk-req-products { display: grid; gap: 0.65rem; margin-bottom: 1.25rem; }
      .kk-req-product {
        display: flex; align-items: flex-start; gap: 0.85rem;
        padding: 0.85rem 1rem; border: 2px solid #d9cfc4;
        border-radius: 10px; cursor: pointer; background: white;
        transition: all 0.15s;
      }
      .kk-req-product:hover { border-color: #c84b31; }
      .kk-req-product.selected {
        border-color: #c84b31; background: #fff5f0;
      }
      .kk-req-product input[type="radio"] { margin-top: 0.3rem; accent-color: #c84b31; }
      .kk-req-product-body { flex: 1; font-size: 0.9rem; line-height: 1.45; }
      .kk-req-product-name {
        font-weight: 600; color: #1a1a2e;
        display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 0.2rem;
      }
      .kk-req-product-price { color: #c84b31; font-weight: 700; }
      .kk-req-product-blurb { color: #7a6f65; font-size: 0.83rem; }

      .kk-req-notes-label {
        display: block; font-size: 0.82rem; font-weight: 500;
        color: #7a6f65; margin-bottom: 0.4rem;
      }
      .kk-req-notes {
        width: 100%; padding: 0.7rem 0.85rem; font-family: inherit;
        border: 1.5px solid #d9cfc4; border-radius: 8px; background: white;
        font-size: 0.9rem; min-height: 84px; resize: vertical;
        color: #1a1a2e; margin-bottom: 0.5rem;
      }
      .kk-req-notes:focus { outline: none; border-color: #c84b31; }

      .kk-req-footer {
        display: flex; justify-content: space-between; align-items: center;
        gap: 0.75rem; margin-top: 1.25rem; padding-top: 1rem;
        border-top: 1px solid #d9cfc4; flex-wrap: wrap;
      }
      .kk-req-total {
        font-family: 'DM Serif Display', serif; font-size: 1.2rem;
        color: #1a1a2e;
      }
      .kk-req-total small { font-family: 'DM Sans', sans-serif; color: #7a6f65; font-size: 0.78rem; display: block; margin-top: 2px; }
      .kk-req-actions { display: flex; gap: 0.6rem; }
      .kk-req-btn {
        padding: 0.7rem 1.4rem; border-radius: 999px; font-family: inherit;
        font-size: 0.9rem; font-weight: 600; cursor: pointer; border: none;
      }
      .kk-req-btn-primary { background: #c84b31; color: white; }
      .kk-req-btn-primary:hover:not(:disabled) { background: #a83c27; }
      .kk-req-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      .kk-req-btn-secondary {
        background: transparent; border: 1.5px solid #d9cfc4; color: #7a6f65;
      }
      .kk-req-btn-secondary:hover { border-color: #1a1a2e; color: #1a1a2e; }

      .kk-req-err {
        color: #c84b31; font-size: 0.85rem; margin-top: 0.8rem;
        min-height: 1.2rem; text-align: center;
      }

      .kk-req-banner {
        max-width: 720px; margin: 1rem auto 0;
        padding: 0.85rem 1.2rem; border-radius: 10px;
        font-size: 0.9rem; background: #d3e4d6; color: #2e5030;
        border-left: 4px solid #5a7a5e; display: none;
      }
      .kk-req-banner.open { display: block; }
      .kk-req-banner a { color: #2e5030; font-weight: 600; }
    `;
    const style = document.createElement('style');
    style.id = 'kk-req-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── RENDER TRIGGER + MODAL ──
  function injectTriggerAndModal() {
    const tradeCode = window.KEEPSTEAD_TRADE_CODE || 'unknown';

    // Trigger — placed after the main .container or at bottom of body
    const host = document.querySelector('.container') || document.body;
    const trigger = document.createElement('div');
    trigger.className = 'kk-req-trigger-wrap';
    trigger.id = 'kk-req-trigger-wrap';
    trigger.innerHTML = `
      <button class="kk-req-trigger" type="button" onclick="window.__kkReq.open()">
        ✨ Request Kari to Complete This For Me
      </button>
      <div class="kk-req-sub">
        Kari builds your Preparer Worksheet or Tax Reference Doc using what you've entered here.
      </div>`;
    host.appendChild(trigger);

    // Banner (shown after successful checkout return)
    const banner = document.createElement('div');
    banner.className = 'kk-req-banner';
    banner.id = 'kk-req-banner';
    banner.innerHTML = `✓ Payment received — Kari will get started. You'll see status updates on the Keepstead home screen.`;
    host.appendChild(banner);

    // Modal
    const overlay = document.createElement('div');
    overlay.className = 'kk-req-overlay';
    overlay.id = 'kk-req-overlay';
    overlay.innerHTML = `
      <div class="kk-req-modal" role="dialog" aria-labelledby="kk-req-title">
        <h2 id="kk-req-title">Request Kari to Complete This For You</h2>
        <p class="kk-req-lead">
          Kari reviews what you've saved in this organizer and delivers a finished,
          preparer-ready document you can hand off at filing time.
        </p>
        <div class="kk-req-products" id="kk-req-products"></div>
        <label class="kk-req-notes-label" for="kk-req-notes-input">
          Anything you want Kari to know? (optional)
        </label>
        <textarea class="kk-req-notes" id="kk-req-notes-input" placeholder="e.g. 'Focus on the 2024 year, I'm filing an extension.'"></textarea>
        <div class="kk-req-err" id="kk-req-err"></div>
        <div class="kk-req-footer">
          <div class="kk-req-total">
            <span id="kk-req-total-amount">$49</span>
            <small id="kk-req-total-sub">per year · billed annually</small>
          </div>
          <div class="kk-req-actions">
            <button class="kk-req-btn kk-req-btn-secondary" type="button" onclick="window.__kkReq.close()">Cancel</button>
            <button class="kk-req-btn kk-req-btn-primary" type="button" id="kk-req-continue" onclick="window.__kkReq.continueToPayment()">Continue to Payment →</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Populate products
    const productsEl = document.getElementById('kk-req-products');
    productsEl.innerHTML = PRODUCTS.map((p, i) => `
      <label class="kk-req-product ${i === 0 ? 'selected' : ''}" data-key="${p.key}">
        <input type="radio" name="kk-req-product" value="${p.key}" ${i === 0 ? 'checked' : ''}>
        <div class="kk-req-product-body">
          <div class="kk-req-product-name">
            <span>${p.name}</span>
            <span class="kk-req-product-price">$${p.price}/yr</span>
          </div>
          <div class="kk-req-product-blurb">${p.blurb}</div>
        </div>
      </label>
    `).join('');
    productsEl.addEventListener('change', (e) => {
      if (e.target.name !== 'kk-req-product') return;
      productsEl.querySelectorAll('.kk-req-product').forEach(el =>
        el.classList.toggle('selected', el.dataset.key === e.target.value)
      );
      const p = PRODUCTS.find(x => x.key === e.target.value);
      document.getElementById('kk-req-total-amount').textContent = '$' + p.price;
    });

    // Close on overlay click (but not inside modal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Stash API
    window.__kkReq = { open, close, continueToPayment };
  }

  function open() {
    document.getElementById('kk-req-err').textContent = '';
    document.getElementById('kk-req-overlay').classList.add('open');
  }
  function close() {
    document.getElementById('kk-req-overlay').classList.remove('open');
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

      const picked = document.querySelector('input[name="kk-req-product"]:checked');
      const reportType = picked ? picked.value : 'prep_worksheet';
      const notes = document.getElementById('kk-req-notes-input').value.trim();
      const tradeCode = window.KEEPSTEAD_TRADE_CODE || 'unknown';

      // Call the Supabase Edge Function `create-checkout-session`.
      // It returns { url } for Stripe Checkout.
      const { data, error: fnErr } = await sb.functions.invoke('create-checkout-session', {
        body: {
          report_type: reportType,
          trade_code: tradeCode,
          notes,
          return_url: window.location.href.split('?')[0]
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

  // ── SUCCESS BANNER ──
  function maybeShowBanner() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kari_req') === 'success') {
      const banner = document.getElementById('kk-req-banner');
      if (banner) banner.classList.add('open');
      // Clean up the URL so a refresh doesn't re-show it.
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, clean);
    }
  }

  // ── BOOTSTRAP ──
  onReady(() => {
    injectStyles();
    injectTriggerAndModal();
    maybeShowBanner();
  });
})();
