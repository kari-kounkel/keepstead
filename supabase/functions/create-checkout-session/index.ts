// ════════════════════════════════════════════════════════════════
// Supabase Edge Function: create-checkout-session
// Called by request-kari.js when user clicks "Continue to Payment"
// Returns a Stripe Checkout URL the browser redirects to.
//
// Env vars (set in Supabase dashboard → Project Settings → Edge Functions):
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_PREP_WORKSHEET      ($49/yr Preparer Worksheet)
//   STRIPE_PRICE_TAX_REFERENCE       ($79/yr Tax Reference Doc)
//   STRIPE_PRICE_BUNDLE_SINGLE       ($129/yr Bundle single trade)
//   STRIPE_PRICE_BUNDLE_UNLIMITED    ($199/yr Bundle unlimited)
//   ADMIN_NOTIFY_EMAIL               (optional — kari@karikounkel.com)
//
// Deploy:
//   supabase functions deploy create-checkout-session
// ════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient()
});

const PRICE_IDS: Record<string, string | undefined> = {
  prep_worksheet:    Deno.env.get('STRIPE_PRICE_PREP_WORKSHEET'),
  tax_reference:     Deno.env.get('STRIPE_PRICE_TAX_REFERENCE'),
  bundle_single:     Deno.env.get('STRIPE_PRICE_BUNDLE_SINGLE'),
  bundle_unlimited:  Deno.env.get('STRIPE_PRICE_BUNDLE_UNLIMITED')
};

const TIER_AMOUNT: Record<string, number> = {
  prep_worksheet: 49,
  tax_reference: 79,
  bundle_single: 129,
  bundle_unlimited: 199
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── Auth: validate caller's JWT ──
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Missing auth' }, 401);

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: userData, error: userErr } = await sbAdmin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid auth' }, 401);
    const user = userData.user;

    // ── Inputs ──
    const body = await req.json().catch(() => ({}));
    const reportType  = String(body.report_type || '');
    const tradeCode   = String(body.trade_code  || '');
    const notes       = String(body.notes       || '').slice(0, 2000);
    const returnUrl   = String(body.return_url  || '');

    const priceId = PRICE_IDS[reportType];
    if (!priceId) return json({ error: `Unknown report_type: ${reportType}` }, 400);
    if (!tradeCode) return json({ error: 'Missing trade_code' }, 400);
    if (!/^https?:\/\//.test(returnUrl)) return json({ error: 'Invalid return_url' }, 400);

    // ── Stripe Checkout ──
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${returnUrl}?kari_req=success`,
      cancel_url:  `${returnUrl}?kari_req=cancelled`,
      metadata: {
        user_id: user.id,
        user_email: user.email || '',
        report_type: reportType,
        trade_code: tradeCode,
        tier_paid: String(TIER_AMOUNT[reportType] ?? 0),
        notes
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          report_type: reportType,
          trade_code: tradeCode
        }
      }
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    return json({ error: (err as Error).message || 'Unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
