import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { resolveAuthContext } from "../lib/auth";
import { db } from "../lib/firebase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

// Same pricing formula as the frontend Plans page
function pricePerUnit(qty: number): number {
  const p = 20 - (17 * Math.log(qty)) / Math.log(1000);
  return Math.max(3, p);
}

const router = Router();

// POST /api/billing/checkout — Create Stripe subscription checkout
router.post("/checkout", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const qty = Math.max(1, Math.min(1000, Math.round(Number(req.body.qty) || 1)));
    const ppu = pricePerUnit(qty);
    const totalCents = Math.round(qty * ppu * 100);

    console.log(`💳 Checkout — team ${ctx.teamId}, qty: ${qty}, ppu: $${ppu.toFixed(2)}, total: $${(totalCents / 100).toFixed(2)}/mo`);

    // Check if team already has an active subscription
    const teamDoc = await db.collection("teams").doc(ctx.teamId).get();
    const team = teamDoc.data();
    if (team?.stripeSubscriptionId && team?.subscriptionStatus === "active") {
      res.status(400).json({ error: "Already subscribed. Cancel current plan first." });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${qty} AI Floor Plan Generation${qty !== 1 ? "s" : ""}/mo`,
              description: `${qty} floor plan rendering${qty !== 1 ? "s" : ""} per month`,
            },
            unit_amount: totalCents,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      metadata: {
        teamId: ctx.teamId,
        qty: String(qty),
        uid: ctx.uid,
      },
      subscription_data: {
        metadata: {
          teamId: ctx.teamId,
          qty: String(qty),
          uid: ctx.uid,
        },
      },
      success_url: `${FRONTEND_URL}/plans?success=1`,
      cancel_url: `${FRONTEND_URL}/plans?canceled=1`,
    });

    console.log(`💳 Stripe subscription session created — ${session.id}`);
    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// POST /api/billing/webhook — Stripe webhook handler
router.post("/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`❌ Webhook signature verification failed: ${message}`);
    res.status(400).json({ error: `Webhook Error: ${message}` });
    return;
  }

  console.log(`📩 Webhook received: ${event.type}`);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const teamId = session.metadata?.teamId;
    const qty = parseInt(session.metadata?.qty || "0", 10);

    if (!teamId || !qty) {
      console.error("❌ Webhook — missing teamId or qty in metadata");
      res.status(400).json({ error: "Missing metadata" });
      return;
    }

    console.log(`💳 Subscription created — team ${teamId}, ${qty} generations/mo`);

    const subscriptionId = session.subscription as string;

    // Calculate period end: 1 month from now
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const teamRef = db.collection("teams").doc(teamId);
    await teamRef.update({
      credits: qty,
      creditsUsed: 0,
      stripeSubscriptionId: subscriptionId || null,
      stripeCustomerId: (session.customer as string) || null,
      subscriptionStatus: "active",
      subscriptionQty: qty,
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: false,
    });

    console.log(`💳 Team ${teamId} subscription activated — ${qty} credits/mo`);
  }

  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    // Skip the first invoice (handled by checkout.session.completed)
    if (invoice.billing_reason === "subscription_create") {
      console.log("💳 Skipping initial invoice (handled by checkout.session.completed)");
      res.json({ received: true });
      return;
    }

    // Get subscription details from invoice parent
    const subDetails = invoice.parent?.subscription_details;
    if (!subDetails) {
      console.log("💳 Invoice has no subscription details, skipping");
      res.json({ received: true });
      return;
    }

    const subId = typeof subDetails.subscription === "string"
      ? subDetails.subscription
      : subDetails.subscription?.id;

    const teamId = subDetails.metadata?.teamId;
    const qty = parseInt(subDetails.metadata?.qty || "0", 10);

    if (!teamId || !qty) {
      console.error("❌ Webhook invoice — missing teamId or qty in subscription metadata");
      res.json({ received: true });
      return;
    }

    console.log(`💳 Monthly renewal — team ${teamId}, resetting to ${qty} credits`);

    // Use invoice period_end as the next billing date
    const periodEnd = new Date(invoice.period_end * 1000).toISOString();

    const teamRef = db.collection("teams").doc(teamId);
    await teamRef.update({
      credits: qty,
      creditsUsed: 0,
      currentPeriodEnd: periodEnd,
      subscriptionStatus: "active",
      stripeSubscriptionId: subId || null,
    });

    console.log(`💳 Team ${teamId} credits reset — ${qty} fresh credits`);
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const teamId = sub.metadata?.teamId;

    if (!teamId) {
      console.error("❌ Webhook subscription.deleted — missing teamId in metadata");
      res.json({ received: true });
      return;
    }

    console.log(`💳 Subscription ended — team ${teamId}`);

    const teamRef = db.collection("teams").doc(teamId);
    await teamRef.update({
      credits: 0,
      creditsUsed: 0,
      subscriptionStatus: "canceled",
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
    });

    console.log(`💳 Team ${teamId} subscription canceled — credits removed`);
  }

  res.json({ received: true });
});

// POST /api/billing/cancel-subscription — Cancel at end of period
router.post("/cancel-subscription", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const teamDoc = await db.collection("teams").doc(ctx.teamId).get();
    const team = teamDoc.data();

    if (!team?.stripeSubscriptionId) {
      res.status(400).json({ error: "No active subscription" });
      return;
    }

    await stripe.subscriptions.update(team.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await db.collection("teams").doc(ctx.teamId).update({
      cancelAtPeriodEnd: true,
    });

    console.log(`💳 Subscription cancellation scheduled — team ${ctx.teamId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Cancel subscription error:", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// POST /api/billing/reactivate-subscription — Undo cancellation
router.post("/reactivate-subscription", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const teamDoc = await db.collection("teams").doc(ctx.teamId).get();
    const team = teamDoc.data();

    if (!team?.stripeSubscriptionId) {
      res.status(400).json({ error: "No active subscription" });
      return;
    }

    await stripe.subscriptions.update(team.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await db.collection("teams").doc(ctx.teamId).update({
      cancelAtPeriodEnd: false,
    });

    console.log(`💳 Subscription reactivated — team ${ctx.teamId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Reactivate subscription error:", err);
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
});

// GET /api/billing/credits — Get team credit balance + subscription info
router.get("/credits", async (req: Request, res: Response) => {
  const ctx = await resolveAuthContext(req);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const teamDoc = await db.collection("teams").doc(ctx.teamId).get();
    const team = teamDoc.data();
    const credits = team?.credits ?? 0;
    const creditsUsed = team?.creditsUsed ?? 0;

    res.json({
      credits,
      creditsUsed,
      remaining: credits - creditsUsed,
      subscription: team?.stripeSubscriptionId
        ? {
            status: team.subscriptionStatus || null,
            qty: team.subscriptionQty || credits,
            currentPeriodEnd: team.currentPeriodEnd || null,
            cancelAtPeriodEnd: team.cancelAtPeriodEnd || false,
          }
        : null,
    });
  } catch (err) {
    console.error("❌ Credits fetch error:", err);
    res.status(500).json({ error: "Failed to fetch credits" });
  }
});

export default router;
