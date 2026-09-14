import { configuredMailTransport } from "../server/config.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// This operator script has one approved recipient. It creates no application account or token.
const recipient = "nguyendongvinh2306@gmail.com";
const subject = "Handoff email setup confirmation";
const mode = process.argv[2] || "--check";
if (!["--check", "--send"].includes(mode) || process.argv.length > 3) {
  console.error("Usage: node scripts/smtp-smoke.mjs [--check|--send]");
  process.exit(1);
}

try {
  process.loadEnvFile("/etc/handoff/app.env");
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      stage: "configuration",
      error: "Cannot read the existing Handoff VPS environment file.",
    }),
  );
  process.exit(1);
}

const transport = configuredMailTransport();
if (!transport || !process.env.MAIL_FROM) {
  console.error(
    JSON.stringify({
      ok: false,
      stage: "configuration",
      error: "SMTP delivery is not fully configured.",
    }),
  );
  process.exit(1);
}

const message = {
  from: process.env.MAIL_FROM,
  to: recipient,
  subject,
  text: `Hi David,\n\nThis is a one-time SMTP delivery test for Handoff's new app at https://app.handofflease.com.\n\nThis setup message checks the configured transactional email service. It is not a student signup, verification, or password reset message. No Handoff account was created by this test.\n\nHandoff\nhttps://app.handofflease.com`,
  html: `<!doctype html><html lang="en"><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#182238"><div style="max-width:520px;margin:40px auto;padding:32px;background:#fff;border:1px solid #e5e9f0;border-radius:16px"><div style="font-size:25px;font-weight:700;color:#275fe9">Handoff</div><h1 style="font-size:21px;margin:28px 0 16px">Email setup confirmation</h1><p style="line-height:1.6">Hi David,</p><p style="line-height:1.6">This is a one-time SMTP delivery test for Handoff's new app.</p><p style="line-height:1.6">This setup message checks the configured transactional email service. It is not a student signup, verification, or password reset message. No Handoff account was created by this test.</p><p style="margin-top:28px"><a href="https://app.handofflease.com" style="color:#275fe9">Open the Handoff app</a></p></div></body></html>`,
};

if (mode === "--check") {
  console.log(
    JSON.stringify({
      ok: true,
      mode: "check",
      sent: false,
      recipient,
      subject,
      message:
        "Configuration is present. No SMTP connection or email delivery was attempted. Run with --send for the one approved setup message.",
    }),
  );
  transport.close();
  process.exit(0);
}

const receiptPath = join(
  process.env.HANDOFF_DATA_DIR || "/var/lib/handoff",
  "smtp-setup-smoke.json",
);
const receipt = {
  recipient,
  subject,
  attemptedAt: new Date().toISOString(),
  state: "attempted",
};
try {
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
} catch {
  transport.close();
  console.error(
    JSON.stringify({
      ok: false,
      stage: "one-time-guard",
      error:
        "A setup attempt already exists or its receipt cannot be saved. Inspect the receipt and Resend before attempting any further delivery.",
    }),
  );
  process.exit(1);
}

try {
  // SMTP connection and socket timeouts are bounded by configuredMailTransport.
  const result = await transport.sendMail(message);
  const accepted =
    Array.isArray(result.accepted) &&
    result.accepted.some(
      (address) => String(address).toLowerCase() === recipient,
    );
  if (!accepted || result.rejected?.length) {
    console.error(
      JSON.stringify({
        ok: false,
        stage: "delivery",
        error: "The provider did not accept the approved recipient.",
      }),
    );
    process.exitCode = 1;
  } else {
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...receipt, state: "accepted", messageId: result.messageId }, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        ok: true,
        sent: true,
        recipient,
        subject,
        messageId: result.messageId,
        status:
          "Accepted by SMTP provider. Confirm delivery separately in Resend.",
      }),
    );
  }
} catch (error) {
  // Provider messages can contain connection or authentication details. Print only known status codes.
  const knownCodes = new Set([
    "EAUTH",
    "ECONNECTION",
    "ETIMEDOUT",
    "ESOCKET",
    "EENVELOPE",
    "EMESSAGE",
    "EDNS",
  ]);
  console.error(
    JSON.stringify({
      ok: false,
      stage: "delivery",
      code: knownCodes.has(error.code) ? error.code : "DELIVERY_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  transport.close();
}
