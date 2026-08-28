/**
 * Outbound email.
 *
 * Two providers are supported and picked automatically from the environment:
 *
 *   RESEND_API_KEY  - HTTP API, no extra dependency, easiest to set up
 *   SMTP_HOST/...   - any SMTP server (Gmail, Postmark, SES, Mailtrap)
 *
 * With neither configured the mailer reports that it is disabled rather than
 * pretending to send, so the caller can fall back honestly.
 */

import { env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailResult =
  | { sent: true; provider: 'resend' | 'smtp' | 'ethereal'; previewUrl?: string }
  | { sent: false; reason: string };

/**
 * A Resend key is only usable if it looks like one. A placeholder left in .env
 * is worse than nothing: it wins provider selection and then fails, masking a
 * perfectly good SMTP configuration.
 */
function resendKey(): string | null {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (!key.startsWith('re_') || key.length < 20 || /paste|your_key|here|xxx/i.test(key)) {
    return null;
  }
  return key;
}

export function mailerConfigured(): boolean {
  return !!resendKey() || !!env.SMTP_HOST;
}

/** Which provider will be used, for startup logging. */
export function mailerProvider(): 'resend' | 'smtp' | 'none' {
  if (resendKey()) return 'resend';
  if (env.SMTP_HOST) return 'smtp';
  return 'none';
}

async function sendViaResend(msg: MailMessage): Promise<MailResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { sent: false, reason: `Resend rejected the message (${res.status}) ${detail.slice(0, 200)}` };
  }
  return { sent: true, provider: 'resend' };
}

async function sendViaSmtp(msg: MailMessage): Promise<MailResult> {
  // Imported lazily so a deployment using Resend never needs the dependency.
  let nodemailer: typeof import('nodemailer');
  try {
    nodemailer = await import('nodemailer');
  } catch {
    return {
      sent: false,
      reason: 'SMTP is configured but nodemailer is not installed. Run: npm install nodemailer',
    };
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; other ports upgrade with STARTTLS.
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });

  try {
    await transport.sendMail({
      from: env.MAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { sent: true, provider: 'smtp' };
  } catch (err) {
    return { sent: false, reason: `SMTP send failed: ${(err as Error).message}` };
  }
}

/**
 * Last resort with no provider configured: nodemailer creates a disposable
 * mailbox on ethereal.email, really sends the message, and returns a URL where
 * it can be read. Nothing to sign up for, and the whole flow is exercised for
 * real rather than faked. Development only - these messages reach nobody.
 */
let etherealTransport: import('nodemailer').Transporter | null = null;

async function sendViaEthereal(msg: MailMessage): Promise<MailResult> {
  let nodemailer: typeof import('nodemailer');
  try {
    nodemailer = await import('nodemailer');
  } catch {
    return { sent: false, reason: 'nodemailer is not installed. Run: npm install nodemailer' };
  }

  try {
    if (!etherealTransport) {
      const account = await nodemailer.createTestAccount();
      etherealTransport = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
    }

    const info = await etherealTransport.sendMail({
      from: env.MAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
    return { sent: true, provider: 'ethereal', previewUrl: previewUrl || undefined };
  } catch (err) {
    return { sent: false, reason: `Test mailbox unavailable: ${(err as Error).message}` };
  }
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  if (resendKey()) {
    const result = await sendViaResend(msg);
    // A rejected key should not silently sink the message when SMTP is also
    // configured and working.
    if (!result.sent && env.SMTP_HOST) {
      // eslint-disable-next-line no-console
      console.warn(`[mail] Resend failed (${result.reason}); falling back to SMTP`);
      return sendViaSmtp(msg);
    }
    return result;
  }
  if (env.SMTP_HOST) {
    const result = await sendViaSmtp(msg);
    if (result.sent || env.isProd) return result;
    // eslint-disable-next-line no-console
    console.warn(`[mail] SMTP failed (${result.reason}); using a test mailbox instead`);
    return sendViaEthereal(msg);
  }

  // Production must not pretend: a real deployment needs a real provider.
  if (env.isProd) return { sent: false, reason: 'No email provider is configured' };
  return sendViaEthereal(msg);
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export function passwordResetEmail(name: string, url: string, minutes: number): MailMessage {
  const text = [
    `Hello ${name},`,
    '',
    'Someone asked to reset the password on your Policy Prism account.',
    '',
    `Reset it here (the link expires in ${minutes} minutes and works once):`,
    url,
    '',
    'If this was not you, ignore this message. Your password stays as it is.',
    '',
    'Policy Prism',
  ].join('\n');

  const html = `
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;color:#0E1C26">
  <h1 style="font-size:18px;margin:0 0 4px">Reset your password</h1>
  <p style="font-size:13px;color:#72838C;margin:0 0 20px">Policy Prism</p>

  <p style="font-size:14px;line-height:1.6">Hello ${escapeHtml(name)},</p>
  <p style="font-size:14px;line-height:1.6">
    Someone asked to reset the password on your account. Use the button below to choose a new one.
  </p>

  <p style="margin:24px 0">
    <a href="${url}"
       style="display:inline-block;background:#0E1C26;color:#fff;text-decoration:none;
              padding:11px 20px;border-radius:4px;font-size:14px">Choose a new password</a>
  </p>

  <p style="font-size:12.5px;color:#72838C;line-height:1.6">
    The link expires in ${minutes} minutes and can be used once. If it has expired, request a new one
    from the sign-in page.
  </p>
  <p style="font-size:12.5px;color:#72838C;line-height:1.6">
    If you did not ask for this, ignore this message &mdash; your password stays as it is.
  </p>

  <hr style="border:none;border-top:1px solid #E5EBED;margin:22px 0" />
  <p style="font-size:11.5px;color:#8C9BA3;line-height:1.5;word-break:break-all">
    If the button does not work, paste this into your browser:<br />${url}
  </p>
</div>`.trim();

  return {
    to: '',
    subject: 'Reset your Policy Prism password',
    text,
    html,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
