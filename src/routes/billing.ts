import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
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

// POST /api/billing/checkout — Create Stripe Checkout session
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

    console.log(`💳 Checkout — team ${ctx.teamId}, qty: ${qty}, ppu: $${ppu.toFixed(2)}, total: $${(totalCents / 100).toFixed(2)}`);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${qty} AI Floor Plan Generation${qty !== 1 ? "s" : ""}`,
              description: `${qty} floor plan rendering credit${qty !== 1 ? "s" : ""} — never expires`,
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        teamId: ctx.teamId,
        qty: String(qty),
        uid: ctx.uid,
      },
      success_url: `${FRONTEND_URL}/plans?success=1`,
      cancel_url: `${FRONTEND_URL}/plans?canceled=1`,
    });

    console.log(`💳 Stripe session created — ${session.id}`);
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const teamId = session.metadata?.teamId;
    const qty = parseInt(session.metadata?.qty || "0", 10);

    if (!teamId || !qty) {
      console.error("❌ Webhook — missing teamId or qty in metadata");
      res.status(400).json({ error: "Missing metadata" });
      return;
    }

    console.log(`💳 Payment completed — team ${teamId}, adding ${qty} credits`);

    // Add credits to team
    const teamRef = db.collection("teams").doc(teamId);
    await teamRef.update({
      credits: FieldValue.increment(qty),
    });

    // Store purchase record
    await teamRef.collection("purchases").doc(session.id).set({
      qty,
      amountCents: session.amount_total,
      stripeSessionId: session.id,
      uid: session.metadata?.uid || "",
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`💳 Credits added — team ${teamId} now has +${qty} credits`);
  }

  res.json({ received: true });
});

// GET /api/billing/credits — Get team credit balance
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
    });
  } catch (err) {
    console.error("❌ Credits fetch error:", err);
    res.status(500).json({ error: "Failed to fetch credits" });
  }
});

export default router;
