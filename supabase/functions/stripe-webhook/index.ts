// ════════════════════════════════════════════════════════════════
// Supabase Edge Function: stripe-webhook
// Stripe posts here on checkout.session.completed.
// Inserts a row into completion_requests so it shows in admin + user UI.
//
// Env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET      (from Stripe Dashboard → Developers → Webhooks)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Deploy (webhook must run WITHOUT JWT verification so Stripe can reach it):
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Wire the endpoint URL in Stripe Dashboard:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   Event to listen for: checkout.session.completed
// ════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient()
});

const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const sbAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Tier label → numeric amount (matches request-kari.js PRODUCTS)
const TIER_AMOUNT: Record<string, number> = {
  prep_worksheet: 49,
  tax_reference: 79,
  bundle_single: 129,
  bundle_unlimited: 199
};

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err);
    return new Response(`Invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }
    // Add more event types here later if needed (invoice.paid for renewals, etc.)
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Handler failed', err);
    return new Response(`Handler error: ${(err as Error).message}`, { status: 500 });
  }
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const md = session.metadata ?? {};
  const userId      = md.user_id;
  const userEmail   = md.user_email || session.customer_email || '';
  const reportType  = md.report_type;
  const tradeCode   = md.trade_code;
  const notes       = md.notes || '';
  const tierPaid    = TIER_AMOUNT[reportType ?? ''] ?? 0;
  // years_ordered was stored as comma-joined string in metadata (Stripe
  // metadata values must be strings). Split it back to an array for Postgres.
  const yearsOrdered = (md.years_ordered || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!userId || !reportType || !tradeCode) {
    console.warn('Skipping — missing metadata', md);
    return;
  }

  // Upsert on stripe_session_id so re-delivered events don't dupe.
  const { error } = await sbAdmin
    .from('completion_requests')
    .upsert({
      user_id: userId,
      user_email: userEmail,
      trade_code: tradeCode,
      report_type: reportType,
      tier_paid: tierPaid,
      years_ordered: yearsOrdered,
      stripe_session_id: session.id,
      notes,
      status: 'pending',
      requested_at: new Date().toISOString()
    }, { onConflict: 'stripe_session_id' });

  if (error) {
    console.error('Insert failed', error);
    throw error;
  }

  // Bump profile tier.
  const tierMap: Record<string, string> = {
    prep_worksheet:   'paid_single',
    tax_reference:    'paid_single',
    bundle_single:    'paid_bundle',
    bundle_unlimited: 'paid_unlimited'
  };
  await sbAdmin
    .from('profiles')
    .update({ tier: tierMap[reportType] || 'paid_single' })
    .eq('id', userId);

  console.log('Completion request recorded', { userId, tradeCode, reportType });
}
