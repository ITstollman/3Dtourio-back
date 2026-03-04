import { Router, Request, Response } from "express";
import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const RECIPIENTS = [
  "itamar.stollnman@gmail.com",
  "hollander.omri@gmail.com",
];

const router = Router();

// POST /api/contact — Send contact form email
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      res.status(400).json({ error: "Name, email, and message are required" });
      return;
    }

    await sgMail.send({
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
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ SendGrid error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
