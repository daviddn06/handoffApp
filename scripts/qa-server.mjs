// Local browser QA only. An isolated temporary database, never production data.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
if (process.env.NODE_ENV === "production")
  throw new Error("QA server cannot run in production.");
const dataDir = await mkdtemp(join(tmpdir(), "handoff-browser-qa-"));
await mkdir(new URL("../qa/", import.meta.url), { recursive: true });
const messages = [];
const origin = "http://127.0.0.1:4741";
const app = createApp({
  dataDir,
  origin,
  mailTransport: {
    sendMail: async (message) => {
      messages.push(message);
      return { accepted: [message.to], rejected: [] };
    },
  },
});
const server = app.listen(4742, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const password = "Handoff QA only 927!";
async function call(path, body, cookie, method = "POST") {
  const form = body instanceof FormData;
  const r = await fetch("http://127.0.0.1:4742" + path, {
    method,
    headers: {
      Origin: origin,
      ...(!form ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form ? body : JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(result));
  return { result, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
for (const [email, name] of [
  ["owner-qa@usc.edu", "Alex Chen"],
  ["renter-qa@usc.edu", "Jordan Lee"],
]) {
  await call("/api/auth/signup", { name, email, password, campusId: "usc" });
  const token = new URL(
    messages
      .filter((m) => m.to === email)
      .at(-1)
      .text.split("\n")
      .find((l) => l.startsWith("http")),
  ).searchParams.get("token");
  const { cookie } = await call("/api/auth/verify", { token });
  if (email.startsWith("owner")) {
    const photo = await readFile(
      new URL("../qa/room.jpg", import.meta.url),
    ).catch(() =>
      sharp({
        create: {
          width: 1200,
          height: 800,
          channels: 3,
          background: "#d9e2ed",
        },
      })
        .jpeg()
        .toBuffer(),
    );
    const form = new FormData();
    form.append(
      "photos",
      new Blob([photo], { type: "image/jpeg" }),
      "room.jpg",
    );
    const uploaded = await call("/api/uploads", form, cookie);
    const examples = [
      ["A sunny room on West 30th", 1150, "private", 34.027, -118.29],
      ["Your own place near the Village", 1850, "entire", 34.03, -118.281],
      ["A shared room, an easy walk", 850, "shared", 34.025, -118.278],
      [
        "A quiet corner of North University Park",
        1250,
        "private",
        34.032,
        -118.286,
      ],
    ];
    for (const [title, price, roomType, lat, lng] of examples) {
      await call(
        "/api/listings",
        {
          title,
          price,
          roomType,
          lat,
          lng,
          description:
            "Local QA example only. A furnished room with plenty of natural light, a shared kitchen, and laundry. Used to verify the Handoff browsing and request experience.",
          address: "North University Park, Los Angeles",
          deposit: 500,
          bedrooms: 1,
          bathrooms: 1,
          availableFrom: "2026-09-15",
          availableTo: "2027-08-31",
          amenities: ["Furnished", "Laundry"],
          photos: uploaded.result.photos,
          status: "active",
        },
        cookie,
      );
    }
  }
}
await writeFile(
  new URL("../qa/session.json", import.meta.url),
  JSON.stringify({
    dataDir,
    accounts: ["owner-qa@usc.edu", "renter-qa@usc.edu"],
    password,
  }),
  { mode: 0o600 },
);
console.log(
  "Local QA server ready on 4742. Captured mail stays in memory; no mail is sent.",
);
process.on("SIGINT", () =>
  server.close(() => {
    app.locals.close();
    process.exit(0);
  }),
);
