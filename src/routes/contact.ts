import { Router, Request, Response } from "express";
import sgMail from "@sendgrid/mail";

const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
  console.log(`📧 SendGrid API key loaded (${apiKey.slice(0, 5)}...${apiKey.slice(-4)}, ${apiKey.length} chars)`);
} else {
  console.error("❌ SENDGRID_API_KEY is not set — contact emails will fail");
}

const RECIPIENTS = [
  "itamar.stollnman@gmail.com",
  "hollander.omri@gmail.com",
];

const router = Router();

// POST /api/contact — Send contact form email
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email, message } = req.body;

    console.log(`📧 Contact form received — name: "${name}", email: "${email}", message length: ${message?.length || 0}`);

    if (!name || !email || !message) {
      console.log("📧 Contact form rejected — missing required fields");
      res.status(400).json({ error: "Name, email, and message are required" });
      return;
    }

    const msg = {
      to: RECIPIENTS,
      from: { email: "noreply@code-callfy.com", name: "AI Floor Planner" },
      replyTo: email,
      subject: `AI Floor Planner — New message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px;">
          <h2 style="color: #171717;">New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 16px 0;" />
          <p style="white-space: pre-wrap;">${message}</p>
        </div>
      `,
    };

    console.log(`📧 Sending email via SendGrid — to: [${RECIPIENTS.join(", ")}], from: ${msg.from.email}, replyTo: ${email}, subject: "${msg.subject}"`);

    const [response] = await sgMail.send(msg);

    console.log(`📧 SendGrid response — status: ${response.statusCode}, headers: ${JSON.stringify(response.headers).slice(0, 200)}`);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log(`✅ Email sent successfully to ${RECIPIENTS.join(", ")}`);
    } else {
      console.error(`⚠️ SendGrid returned non-2xx status: ${response.statusCode}, body: ${JSON.stringify(response.body)}`);
    }

    res.json({ success: true });
  } catch (err: unknown) {
    // SendGrid errors have a response property with details
    const sgErr = err as { response?: { statusCode?: number; body?: unknown; headers?: unknown }; message?: string };
    if (sgErr.response) {
      console.error(`❌ SendGrid API error — status: ${sgErr.response.statusCode}, body: ${JSON.stringify(sgErr.response.body)}, headers: ${JSON.stringify(sgErr.response.headers)}`);
    } else {
      console.error("❌ SendGrid error:", sgErr.message || err);
    }
    res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
