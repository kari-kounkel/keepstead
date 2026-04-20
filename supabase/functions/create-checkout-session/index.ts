// ════════════════════════════════════════════════════════════════
// Supabase Edge Function: create-checkout-session
// Called by request-kari.js when user clicks "Continue to Payment"
// Returns a Stripe Checkout URL the browser redirects to.
// ════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient()
});

const PRICE_IDS: Record<string, string | undefined> = {
  prep_worksheet:   Deno.env.get('STRIPE_PRICE_PREP_WORKSHEET'),
  tax_reference:    Deno.env.get('STRIPE_PRICE_TAX_REFERENCE'),
  bundle_single:    Deno.env.get('STRIPE_PRICE_BUNDLE_SINGLE'),
  bundle_unlimited: Deno.env.get('STRIPE_PRICE_BUNDLE_UNLIMITED')
};

const TIER_AMOUNT: Record<string, number> = {
  prep_worksheet: 49,
  tax_reference: 79,
  bundle_single: 109,
  bundle_unlimited: 159
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const reportType   = String(body.report_type  || '');
    const tradeCode    = String(body.trade_code   || '');
    const notes        = String(body.notes        || '').slice(0, 2000);
    const returnUrl    = String(body.return_url   || '');
    const userEmail    = String(body.user_email   || '');
    const userId       = String(body.user_id      || '');
    const yearsOrdered = Array.isArray(body.years_ordered)
      ? body.years_ordered.map((y: unknown) => String(y)).filter(y => /^\d{4}$/.test(y))
      : [];

    const priceId = PRICE_IDS[reportType];
    if (!priceId)           return json({ error: 'Unknown report_type: ' + reportType }, 400);
    if (!tradeCode)         return json({ error: 'Missing trade_code' }, 400);
    if (!userEmail)         return json({ error: 'Missing user_email' }, 400);
    if (!/^https?:\/\//.test(returnUrl)) return json({ error: 'Invalid return_url' }, 400);
    if (!yearsOrdered.length) return json({ error: 'Pick at least one tax year' }, 400);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: yearsOrdered.length }],
      customer_email: userEmail,
      client_reference_id: userId || undefined,
      allow_promotion_codes: true,
      success_url: returnUrl + '?kari_req=success',
      cancel_url:  returnUrl + '?kari_req=cancelled',
      metadata: {
        user_id: userId,
        user_email: userEmail,
        report_type: reportType,
        trade_code: tradeCode,
        tier_paid: String(TIER_AMOUNT[reportType] ?? 0),
        years_ordered: yearsOrdered.join(','),
        years_count: String(yearsOrdered.length),
        notes
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
