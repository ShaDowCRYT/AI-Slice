import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

// Security rule default: Ethereal for local dev. If the human provides real
// SMTP credentials in .env (SMTP_HOST etc.), those take precedence so the flow
// works against a reachable server. Chosen against hard-coding Ethereal only:
// Ethereal was unreachable from this network (see problems.md).
async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  // Fail fast when the mail server is down — otherwise the default 2-minute
  // Nodemailer timeout hangs the request for the user.
  const timeouts = {
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  };

  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
      },
      ...timeouts,
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
      ...timeouts,
    });
  }

  return transporter;
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<string | false> {
  const transport = await getTransporter();
  const info = await transport.sendMail({
    from: process.env.SMTP_FROM ?? "AuthSlice <noreply@authslice.dev>",
    to,
    subject,
    text,
    html,
  });
  return nodemailer.getTestMessageUrl(info) ?? null;
}