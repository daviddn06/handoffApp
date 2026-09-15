/** Terms of Service and Privacy Policy. Plain language, marketplace only. */
export const LEGAL_UPDATED = "September 14, 2026";
export const LEGAL_CONTACT = "hello@handofflease.com";

export type LegalSection = { title: string; body: string[] };

export const TERMS: LegalSection[] = [
  {
    title: "What Handoff is",
    body: [
      "Handoff is an online bulletin board where students post subleases and other students find them. Handoff is not a landlord, a broker, a property manager, a lender, an escrow agent, or a party to any lease, sublease, or payment.",
      "Handoff does not collect rent, hold deposits, move money between students, or take a fee from any transaction. Any payment you make or receive happens outside Handoff, between you and the other person, on terms you agree to yourselves.",
    ],
  },
  {
    title: "Who can use Handoff",
    body: [
      "You need to be at least 18 years old and a current student at a supported campus with a working school email address. You are responsible for keeping your password private and for everything that happens under your account.",
      "Verification confirms that you control a school email address. It does not verify your identity, enrollment, financial standing, or your right to sublease a place.",
    ],
  },
  {
    title: "Listings and requests are between students",
    body: [
      "When you post a listing you promise that you have the right to sublease the place, that you have any consent your lease or landlord requires, and that everything in the listing is accurate, including the rent you are asking and what you pay on the original lease.",
      "When you request a handoff you are starting a conversation, not signing a contract. Nothing on Handoff creates a binding lease. Whether a sublease happens, and on what terms, is decided by the students involved and, where required, the landlord.",
      "Handoff does not inspect places, screen students, run background or credit checks, or verify photos, prices, dates, or descriptions. Visit in person, read the original lease, put your agreement in writing, and never pay a deposit or rent for a place you have not seen or to a person you have not met.",
    ],
  },
  {
    title: "Your conduct",
    body: [
      "Do not post anything false, misleading, discriminatory, or unlawful. Do not post a place you do not control. Do not use Handoff to harass anyone, to send spam, to scrape data, to collect other students' contact details for any purpose other than a genuine sublease, or to break the law or your school's policies.",
      "Fair housing laws apply to you. Listings and decisions about who you sublease to may not discriminate on the basis of race, color, religion, national origin, sex, familial status, disability, or any other characteristic protected by federal, state, or local law.",
      "Handoff may remove content, pause a listing, or close an account at any time when we believe these terms were broken, when we receive a report, or when we are required to by law.",
    ],
  },
  {
    title: "No guarantees",
    body: [
      "Handoff is provided as is and as available. We do not promise that a listing is real, that a student is who they say they are, that a place is habitable, safe, or as described, that a sublease is permitted under the original lease, or that any handoff will complete.",
      "To the fullest extent permitted by law we disclaim all warranties, express or implied, including fitness for a particular purpose, merchantability, and non infringement.",
    ],
  },
  {
    title: "Limitation of liability",
    body: [
      "To the fullest extent permitted by law, Handoff and the people who run it are not liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of money, housing, data, or goodwill, arising from your use of Handoff or from any dealing with another student, even if we were told it could happen.",
      "If we are found liable for anything connected to Handoff, our total liability to you is limited to one hundred US dollars. Some jurisdictions do not allow these limits, in which case they apply to the extent allowed.",
    ],
  },
  {
    title: "Indemnity",
    body: [
      "You agree to defend and hold harmless Handoff and the people who run it from any claim, loss, or expense, including reasonable legal fees, that arises from your listing, your request, your sublease, your breach of these terms, or your violation of any law or of anyone else's rights.",
    ],
  },
  {
    title: "Boosts",
    body: [
      "A boost is a paid promotion for one listing you own. For seven days that listing sits at the top of the list for the map area it appears in, shows a filled pin on the map, carries a Boosted tag on its card, and shows you views and requests counted from the moment the boost started. A boost costs $9 for the seven days. One boost runs on a listing at a time, and you can boost the same listing again once the current one ends.",
      "During the launch phase Handoff is offering a free launch boost, limited to one per listing. Free boosts carry the same seven days and the same placement, and Handoff can end the launch offer at any time.",
      "Refunds. If your listing had no views during a boost, write to the contact address below within 24 hours of the start and we will refund it in full. Otherwise boosts are not refundable, including when you archive the listing, mark it handed off, or edit it during the boost.",
      "A boost buys placement and nothing else. It does not guarantee views, requests, a handoff, or any outcome, and it does not change anything else in these terms. Handoff may pause or remove a boost, with a refund of the unused days, if the listing breaks these terms or is removed after review.",
    ],
  },
  {
    title: "Disputes",
    body: [
      "These terms are governed by the laws of the State of California. Any dispute that cannot be resolved informally will be brought in the state or federal courts located in Los Angeles County, California, and you consent to their jurisdiction.",
      "Before starting any legal action, you agree to write to us at the contact address below and give us thirty days to try to resolve the issue.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      "We may update these terms. When we do, the date at the top changes and continuing to use Handoff means you accept the new version. Material changes will be announced in the app.",
      "Questions go to the contact address below. This document was written for a student marketplace and is not legal advice for your own sublease. Read your lease and, if in doubt, ask your housing office.",
    ],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    title: "What we collect",
    body: [
      "Account details you give us, your name, school email, campus, password (stored only as a salted hash), and an optional bio. Listings you create, including photos, address, prices, dates, and descriptions. Handoff requests and the messages inside them. Saved places. Reports you file. Waitlist emails for campuses we have not opened yet.",
      "Technical details needed to run the service, a session cookie so you stay signed in, the IP address on requests for rate limiting and abuse prevention, and basic server logs. We do not run advertising trackers or sell data.",
    ],
  },
  {
    title: "How we use it",
    body: [
      "To show your listing to students at your campus, to connect you with a student when a handoff request is accepted, to send verification, password reset, and request notifications by email, to keep the service safe, and to improve Handoff.",
      "We do not use your data for advertising and we do not sell it.",
    ],
  },
  {
    title: "What other students can see",
    body: [
      "Your listing, including photos, address, prices, dates, and your first name and last initial, is visible to signed in students at your campus. Your email address stays private until a handoff request is accepted. At that moment both students see each other's name and school email so they can talk directly. You can withdraw or decline a request at any time before that.",
      "Once your email has been shared with another student, we cannot take it back from them.",
    ],
  },
  {
    title: "Who else sees it",
    body: [
      "Email delivery uses a transactional email provider that processes your address to deliver our messages. Map tiles are loaded from OpenFreeMap, which receives your IP address like any web request. Hosting runs on a virtual server we manage. We share data with authorities only when the law requires it.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "Handoff uses one essential cookie that keeps you signed in. It is not used for tracking. Your browser may also store small preferences such as your chosen campus and the width of the listing panel.",
    ],
  },
  {
    title: "Keeping and deleting data",
    body: [
      "Your account and listings stay until you delete them or ask us to. Archived listings are kept so requests and reports still make sense. Backups are kept for a limited time. To delete your account or anything in it, email the contact address below from your school email and we will confirm within a reasonable time.",
      "You can see and correct your name and bio in your profile at any time.",
    ],
  },
  {
    title: "Security",
    body: [
      "Passwords are hashed, sessions are server managed, connections use HTTPS, and photos are re encoded on upload so they carry no hidden metadata. No system is perfectly secure, so use a unique password and tell us right away if you think your account was misused.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      "We may update this policy. The date at the top shows the current version. Questions or requests go to the contact address below.",
    ],
  },
];
