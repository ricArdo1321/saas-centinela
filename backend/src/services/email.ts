/**
 * Email Service
 * 
 * Sends digest emails via SMTP using nodemailer.
 */

import nodemailer from 'nodemailer';
import { sql } from '../db/index.js';

interface EmailConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
}

function getEmailConfig(): EmailConfig {
    return {
        host: process.env['SMTP_HOST'] || 'localhost',
        port: parseInt(process.env['SMTP_PORT'] || '587', 10),
        secure: process.env['SMTP_SECURE'] === 'true',
        user: process.env['SMTP_USER'] || '',
        pass: process.env['SMTP_PASS'] || '',
        from: process.env['SMTP_FROM'] || 'centinela@localhost',
    };
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
    if (!transporter) {
        const config = getEmailConfig();
        transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.user ? {
                user: config.user,
                pass: config.pass,
            } : undefined,
        });
    }
    return transporter;
}

export interface SendEmailResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Send a digest email.
 * 
 * @param digestId - The digest ID to send
 * @param recipientEmail - Email address to send to
 * @returns Result of the send operation
 */
export async function sendDigestEmail(
    digestId: string,
    recipientEmail: string
): Promise<SendEmailResult> {
    // Get digest details
    const digests = await sql`
    SELECT id, tenant_id, subject, body_text, body_html, severity
    FROM digests
    WHERE id = ${digestId}
  `;

    const digest = digests[0];
    if (!digest) {
        return { success: false, error: 'Digest not found' };
    }

    const config = getEmailConfig();
    const transport = getTransporter();

    try {
        const info = await transport.sendMail({
            from: config.from,
            to: recipientEmail,
            subject: digest.subject as string,
            text: digest.body_text as string,
            html: digest.body_html as string || undefined,
        });

        // Record successful delivery
        await sql`
      INSERT INTO email_deliveries (
        digest_id, tenant_id, recipient_email, status, sent_at, smtp_message_id
      ) VALUES (
        ${digestId},
        ${digest.tenant_id},
        ${recipientEmail},
        'sent',
        NOW(),
        ${info.messageId}
      )
    `;

        console.log(`📧 Email sent to ${recipientEmail}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Record failed delivery
        await sql`
      INSERT INTO email_deliveries (
        digest_id, tenant_id, recipient_email, status, error_message
      ) VALUES (
        ${digestId},
        ${digest.tenant_id},
        ${recipientEmail},
        'failed',
        ${errorMessage}
      )
    `;

        console.error(`❌ Email failed to ${recipientEmail}:`, errorMessage);
        return { success: false, error: errorMessage };
    }
}

/**
 * Send all pending digests to configured recipients.
 * For MVP, uses a single recipient from env var.
 * 
 * @returns Number of emails sent successfully
 */
export async function sendPendingDigests(): Promise<number> {
    const recipientEmail = process.env['ALERT_RECIPIENT_EMAIL'];

    if (!recipientEmail) {
        console.warn('⚠️ ALERT_RECIPIENT_EMAIL not set, skipping email send');
        return 0;
    }

    // Get pending digests (not yet sent)
    const pendingDigests = await sql`
    SELECT d.id
    FROM digests d
    WHERE NOT EXISTS (
      SELECT 1 FROM email_deliveries e
      WHERE e.digest_id = d.id AND e.status = 'sent'
    )
    ORDER BY d.created_at ASC
  `;

    let sentCount = 0;

    for (const row of pendingDigests) {
        const result = await sendDigestEmail(row.id as string, recipientEmail);
        if (result.success) {
            sentCount++;
        }
    }

    return sentCount;
}

/**
 * Verify SMTP connection.
 */
export async function verifyEmailConnection(): Promise<boolean> {
    try {
        await getTransporter().verify();
        console.log('✅ SMTP connection verified');
        return true;
    } catch (error) {
        console.error('❌ SMTP connection failed:', error);
        return false;
    }
}
