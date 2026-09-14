import nodemailer from "nodemailer";

export const CAMPUSES = Object.freeze([
  {
    id: "usc",
    name: "University of Southern California",
    shortName: "USC",
    lat: 34.0224,
    lng: -118.2851,
    domain: "usc.edu",
  },
  {
    id: "ucla",
    name: "University of California, Los Angeles",
    shortName: "UCLA",
    lat: 34.0689,
    lng: -118.4452,
    domain: "ucla.edu",
  },
  {
    id: "lmu",
    name: "Loyola Marymount University",
    shortName: "LMU",
    lat: 33.9701,
    lng: -118.4165,
    domain: "lmu.edu",
  },
  {
    id: "csulb",
    name: "California State University, Long Beach",
    shortName: "CSULB",
    lat: 33.7838,
    lng: -118.1141,
    domain: "csulb.edu",
  },
]);

export function configuredMailTransport(env = process.env) {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null;
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "true",
    requireTLS: env.SMTP_SECURE !== "true",
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  });
}
