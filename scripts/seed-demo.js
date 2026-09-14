#!/usr/bin/env node
// Seeds a LOCAL development database with demo users, listings, photos and requests.
// Never run this against a production data directory.
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { openDatabase } from "../server/database.js";
import { hashPassword } from "../server/security.js";

const DEMO_PASSWORD = "Demo password 2026!";
const TODAY = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Los_Angeles",
});
const iso = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

/* ---------------------------------------------------------------- guards */

const dataDir = resolve(process.env.HANDOFF_DATA_DIR || "./data");
console.log(`Handoff demo seed`);
console.log(`Data directory: ${dataDir}`);
if (!process.env.HANDOFF_DATA_DIR)
  console.log(`HANDOFF_DATA_DIR was not set, defaulting to ./data`);

const forbidden = ["/var/lib/handoff", "/var/backups/handoff", "/opt/handoff"];
const blocked = forbidden.some(
  (root) => dataDir === root || dataDir.startsWith(root + sep),
);
if (blocked) {
  console.error(
    `Refusing to seed ${dataDir}. That path is a production location. Set HANDOFF_DATA_DIR to a local directory such as ./data.`,
  );
  process.exit(1);
}

/* ------------------------------------------------------------- demo data */

const users = [
  {
    key: "owner",
    name: "Maya Chen",
    email: "demo.owner@usc.edu",
    campusId: "usc",
    bio: "Third year business major. Subletting my place near campus while I am away for a co-op.",
  },
  {
    key: "jordan",
    name: "Jordan Alvarez",
    email: "demo.jordan@usc.edu",
    campusId: "usc",
    bio: "Viterbi junior, quiet, clean, and usually in the library past midnight.",
  },
  {
    key: "priya",
    name: "Priya Raman",
    email: "demo.priya@usc.edu",
    campusId: "usc",
    bio: "Annenberg grad student looking for a spring sublease close to campus.",
  },
  {
    key: "marcus",
    name: "Marcus Webb",
    email: "demo.marcus@usc.edu",
    campusId: "usc",
    bio: "Senior, plays intramural soccer, easy to reach by text.",
  },
  {
    key: "sofia",
    name: "Sofia Delgado",
    email: "demo.sofia@ucla.edu",
    campusId: "ucla",
    bio: "Second year in Westwood, studying abroad next term.",
  },
  {
    key: "ethan",
    name: "Ethan Nakamura",
    email: "demo.ethan@ucla.edu",
    campusId: "ucla",
    bio: "Grad student, north campus, keeps a very tidy kitchen.",
  },
  {
    key: "alina",
    name: "Alina Moreau",
    email: "demo.alina@lmu.edu",
    campusId: "lmu",
    bio: "Film major on the bluff, subletting for the summer session.",
  },
];

const AMENITIES = [
  "Furnished",
  "Wi-Fi",
  "Air conditioning",
  "Laundry",
  "Parking",
  "Pet friendly",
  "Private bathroom",
  "Utilities included",
];

// Terms. Every availableTo is on or after today so listings stay discoverable.
const SPRING = ["2027-01-10", "2027-05-15"];
const SUMMER = ["2027-05-20", "2027-08-15"];
const NOW_YEAR = ["2026-10-01", "2027-05-31"];
const NOW_SPRING = ["2026-11-01", "2027-05-15"];
const SHORT = ["2026-10-15", "2027-01-31"];

const listings = [
  // Dense cluster, roughly within 0.8 km of the USC campus center.
  {
    owner: "owner",
    title: "Private room on West 30th, 5 min walk to Leavey",
    description:
      "Front bedroom in a four bedroom house on West 30th between Hoover and Orchard. It is a five minute walk to Leavey and about eight to Marshall. My three roommates are all juniors, quiet on weeknights, and the street parking is manageable if you get the permit.",
    address: "1245 W 30th St, Los Angeles, CA 90007",
    lat: 34.0264,
    lng: -118.2873,
    price: 1150,
    deposit: 1150,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Utilities included"],
    photos: 3,
    palette: "beige",
  },
  {
    owner: "jordan",
    title: "Lorenzo studio with parking, spring sublease",
    description:
      "Studio at the Lorenzo with a full kitchen and in unit laundry. The gym and pool are included and the shuttle stops right out front, so I have not driven to campus all semester. Parking spot in the garage transfers with the sublease.",
    address: "1140 W 30th St, Los Angeles, CA 90007",
    lat: 34.0272,
    lng: -118.2794,
    price: 1850,
    deposit: 900,
    bedrooms: 0,
    bathrooms: 1,
    roomType: "entire",
    term: SPRING,
    amenities: [
      "Furnished",
      "Wi-Fi",
      "Air conditioning",
      "Laundry",
      "Parking",
      "Private bathroom",
    ],
    photos: 4,
    palette: "slate",
  },
  {
    owner: "priya",
    title: "Shared room at University Gateway, steps to campus",
    description:
      "Shared bedroom in a two bed at University Gateway, directly across Figueroa from campus. Trader Joe's is downstairs and the front desk takes packages. My roommate is a senior in Annenberg and keeps normal hours.",
    address: "3335 S Figueroa St, Los Angeles, CA 90007",
    lat: 34.0231,
    lng: -118.2789,
    price: 950,
    deposit: 500,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "shared",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Air conditioning", "Laundry"],
    photos: 3,
    palette: "sky",
  },
  {
    owner: "marcus",
    title: "Icon Plaza one bedroom, furnished and quiet",
    description:
      "One bedroom at Icon Plaza on the seventh floor facing away from Figueroa, so it is genuinely quiet. Comes furnished with a desk, bed and couch. Rooftop deck and study rooms are included in rent.",
    address: "3115 S Figueroa St, Los Angeles, CA 90007",
    lat: 34.0258,
    lng: -118.2782,
    price: 2400,
    deposit: 1200,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "entire",
    term: NOW_YEAR,
    amenities: [
      "Furnished",
      "Wi-Fi",
      "Air conditioning",
      "Laundry",
      "Private bathroom",
      "Utilities included",
    ],
    photos: 4,
    palette: "sage",
  },
  {
    owner: "owner",
    title: "Room in a house on Ellendale Pl, backyard included",
    description:
      "Large upstairs bedroom in a craftsman on Ellendale with a real backyard and a lemon tree. Two other students live here and we split utilities four ways. Ten minute walk to the Village and about twelve to Bovard.",
    address: "1218 Ellendale Pl, Los Angeles, CA 90007",
    lat: 34.0281,
    lng: -118.2911,
    price: 1050,
    deposit: 800,
    bedrooms: 1,
    bathrooms: 1.5,
    roomType: "private",
    term: NOW_SPRING,
    amenities: ["Wi-Fi", "Laundry", "Pet friendly", "Parking"],
    photos: 3,
    palette: "terracotta",
  },
  {
    owner: "jordan",
    title: "Menlo Ave two bedroom, whole unit for spring",
    description:
      "Entire two bedroom on Menlo just south of Jefferson. Both bedrooms are furnished and the living room gets good afternoon light. The building is small, six units, and the landlord actually answers the phone.",
    address: "1325 Menlo Ave, Los Angeles, CA 90006",
    lat: 34.0301,
    lng: -118.2962,
    price: 2250,
    deposit: 2250,
    bedrooms: 2,
    bathrooms: 1,
    roomType: "entire",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Parking"],
    photos: 3,
    palette: "beige",
  },
  {
    owner: "priya",
    title: "Tuscany single, all utilities included",
    description:
      "Single bedroom in a four bed four bath at Tuscany. Private bathroom, so no negotiating a shower schedule. Rent covers water, electric and internet, and the shuttle runs to campus every fifteen minutes.",
    address: "3025 Royal St, Los Angeles, CA 90007",
    lat: 34.0289,
    lng: -118.2762,
    price: 1400,
    deposit: 600,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: SPRING,
    amenities: [
      "Furnished",
      "Wi-Fi",
      "Air conditioning",
      "Laundry",
      "Private bathroom",
      "Utilities included",
    ],
    photos: 2,
    palette: "sky",
  },
  {
    owner: "marcus",
    title: "Hoover St room, one block from Village",
    description:
      "Bedroom in a three bed apartment on Hoover near 30th. You can walk to the Village in about four minutes for groceries and the gym. Furnished with a full bed, dresser and desk that all stay.",
    address: "2925 S Hoover St, Los Angeles, CA 90007",
    lat: 34.0277,
    lng: -118.2828,
    price: 1250,
    deposit: 1250,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: NOW_YEAR,
    amenities: ["Furnished", "Wi-Fi", "Air conditioning", "Laundry"],
    photos: 3,
    palette: "sage",
  },
  {
    owner: "owner",
    title: "Orchard Ave room for summer session",
    description:
      "Summer sublease in a five bedroom on Orchard. It is a short walk to Fertitta and the RTCC, and the house has a washer and dryer that actually work. Bike storage in the garage if you ride.",
    address: "2831 Orchard Ave, Los Angeles, CA 90007",
    lat: 34.0301,
    lng: -118.2851,
    price: 850,
    deposit: 400,
    bedrooms: 1,
    bathrooms: 2,
    roomType: "private",
    term: SUMMER,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Parking"],
    photos: 2,
    palette: "terracotta",
  },
  {
    owner: "jordan",
    title: "Severance St apartment, entire one bedroom",
    description:
      "Whole one bedroom on Severance near 36th. Recently repainted, new fridge, and the block is quiet compared to Hoover. About a twelve minute walk to the Exposition side of campus.",
    address: "3612 Severance St, Los Angeles, CA 90007",
    lat: 34.0192,
    lng: -118.2889,
    price: 1750,
    deposit: 1750,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "entire",
    term: NOW_SPRING,
    amenities: ["Wi-Fi", "Air conditioning", "Laundry", "Private bathroom"],
    photos: 3,
    palette: "slate",
  },
  {
    owner: "priya",
    title: "West 27th St room near Greek row",
    description:
      "Bedroom in a house on 27th just west of Hoover. Walk to campus in seven minutes and to the Coliseum in about fifteen. Fair warning, it is lively on football weekends, which some people consider a feature.",
    address: "1046 W 27th St, Los Angeles, CA 90007",
    lat: 34.0295,
    lng: -118.2796,
    price: 1100,
    deposit: 700,
    bedrooms: 1,
    bathrooms: 1.5,
    roomType: "private",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Pet friendly"],
    photos: 3,
    palette: "beige",
  },
  {
    owner: "marcus",
    title: "Portland St two bedroom, furnished",
    description:
      "Two bedroom on Portland near 28th, both rooms furnished, kitchen fully stocked. Street parking with a permit is usually easy on this block. Ten minutes to campus on foot, five on a bike.",
    address: "2810 Portland St, Los Angeles, CA 90007",
    lat: 34.0312,
    lng: -118.2782,
    price: 2050,
    deposit: 1000,
    bedrooms: 2,
    bathrooms: 1,
    roomType: "entire",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Parking", "Pet friendly"],
    photos: 4,
    palette: "sage",
  },
  {
    owner: "owner",
    title: "Shared room on West 32nd, cheapest near campus",
    description:
      "Shared bedroom in a four bed on 32nd, which is why it is this cheap. Bunk setup with a desk each, and the living room is big enough to actually use. Eight minute walk to Tommy Trojan.",
    address: "1142 W 32nd St, Los Angeles, CA 90007",
    lat: 34.0241,
    lng: -118.2857,
    price: 650,
    deposit: 300,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "shared",
    term: NOW_YEAR,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Utilities included"],
    photos: 2,
    palette: "sky",
  },
  {
    owner: "jordan",
    title: "West 36th Pl studio, quiet block",
    description:
      "Small studio on 36th Place with its own entrance off the driveway. Good for someone who wants their own door and no roommates. The Expo Line at Vermont is a ten minute walk if you commute downtown.",
    address: "1425 W 36th Pl, Los Angeles, CA 90007",
    lat: 34.0207,
    lng: -118.2937,
    price: 1350,
    deposit: 1350,
    bedrooms: 0,
    bathrooms: 1,
    roomType: "entire",
    term: SUMMER,
    amenities: ["Furnished", "Wi-Fi", "Private bathroom", "Utilities included"],
    photos: 2,
    palette: "terracotta",
  },
  {
    owner: "priya",
    title: "University Park three bedroom, whole house",
    description:
      "Entire three bedroom house in University Park with a porch and a driveway that fits two cars. We are handing off the whole lease for spring, so bring roommates. Dog friendly, ours lived here two years.",
    address: "2723 Menlo Ave, Los Angeles, CA 90007",
    lat: 34.0327,
    lng: -118.2956,
    price: 3400,
    deposit: 3400,
    bedrooms: 3,
    bathrooms: 2,
    roomType: "entire",
    term: SPRING,
    amenities: ["Wi-Fi", "Laundry", "Parking", "Pet friendly"],
    photos: 4,
    palette: "sage",
  },
  {
    owner: "marcus",
    title: "Jefferson Blvd room, walk to Expo Park",
    description:
      "Bedroom in a two bed on Jefferson east of Vermont. Exposition Park, the rose garden and the science center are all a short walk, and campus is about fifteen minutes. Bus stops at the corner.",
    address: "1720 W Jefferson Blvd, Los Angeles, CA 90018",
    lat: 34.0258,
    lng: -118.2993,
    price: 975,
    deposit: 500,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: NOW_SPRING,
    amenities: ["Wi-Fi", "Air conditioning", "Laundry"],
    photos: 3,
    palette: "beige",
  },
  {
    owner: "owner",
    title: "Adams-Normandie one bedroom, garden unit",
    description:
      "Ground floor one bedroom in Adams-Normandie with a small shared garden. It is further out, about a twenty minute walk or a short bus ride, but you get much more space for the money. Laundry is on site.",
    address: "1533 W Adams Blvd, Los Angeles, CA 90007",
    lat: 34.0331,
    lng: -118.2998,
    price: 1500,
    deposit: 1500,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "entire",
    term: SPRING,
    amenities: ["Wi-Fi", "Laundry", "Parking", "Pet friendly"],
    photos: 3,
    palette: "slate",
  },
  {
    owner: "jordan",
    title: "Four bedroom on West 37th, whole lease",
    description:
      "The whole four bedroom on 37th Street is available for spring. Two bathrooms, big kitchen, and enough parking for three cars behind the gate. We are all graduating, so the entire lease hands off at once.",
    address: "1330 W 37th St, Los Angeles, CA 90007",
    lat: 34.0184,
    lng: -118.2921,
    price: 3200,
    deposit: 2400,
    bedrooms: 4,
    bathrooms: 2,
    roomType: "entire",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Parking"],
    photos: 3,
    palette: "terracotta",
  },
  {
    owner: "priya",
    title: "Figueroa high rise room, pool and gym",
    description:
      "Private room in a three bed on Figueroa with a pool, gym and rooftop. The walk to campus is about fifteen minutes north, or you take the shuttle. Utilities and internet are bundled into rent.",
    address: "3900 S Figueroa St, Los Angeles, CA 90037",
    lat: 34.0151,
    lng: -118.2818,
    price: 1650,
    deposit: 800,
    bedrooms: 1,
    bathrooms: 2.5,
    roomType: "private",
    term: NOW_YEAR,
    amenities: [
      "Furnished",
      "Wi-Fi",
      "Air conditioning",
      "Laundry",
      "Private bathroom",
      "Utilities included",
    ],
    photos: 4,
    palette: "sky",
  },
  {
    owner: "marcus",
    title: "Exposition Park area room, short term",
    description:
      "Room available October through January near Exposition Park. Furnished, month to month after the initial term, and the landlord is fine with a short stay. Good if your plans change mid year.",
    address: "3819 Menlo Ave, Los Angeles, CA 90037",
    lat: 34.0172,
    lng: -118.2962,
    price: 800,
    deposit: 400,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: SHORT,
    amenities: ["Furnished", "Wi-Fi", "Laundry"],
    photos: 2,
    palette: "sage",
  },
  {
    owner: "owner",
    title: "South Park loft, downtown adjacent",
    description:
      "Loft in South Park downtown, about a fifteen minute drive or a straight shot on the Expo Line to campus. High ceilings, huge windows, and a doorman. Better for a grad student who wants to be near downtown.",
    address: "1100 S Hope St, Los Angeles, CA 90015",
    lat: 34.0398,
    lng: -118.2657,
    price: 2650,
    deposit: 1300,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "entire",
    term: SPRING,
    amenities: [
      "Wi-Fi",
      "Air conditioning",
      "Laundry",
      "Parking",
      "Private bathroom",
    ],
    photos: 3,
    palette: "slate",
  },
  {
    owner: "jordan",
    title: "Two bedroom near Figueroa and Adams",
    description:
      "Two bedroom near Figueroa and Adams, walkable to both campus and the Expo Line. One room is furnished and the other is empty, so bring your own bed or negotiate with me. Quiet neighbors upstairs.",
    address: "2401 S Figueroa St, Los Angeles, CA 90007",
    lat: 34.0369,
    lng: -118.2703,
    price: 1950,
    deposit: 1000,
    bedrooms: 2,
    bathrooms: 1.5,
    roomType: "entire",
    term: SUMMER,
    amenities: ["Wi-Fi", "Air conditioning", "Parking"],
    photos: 3,
    palette: "beige",
  },
  // UCLA and Westwood.
  {
    owner: "sofia",
    title: "Gayley Ave room, one block from campus",
    description:
      "Room in a two bed on Gayley, which is about as close to UCLA as you can get without living in a dorm. Walk to Bruin Plaza in five minutes and to Westwood Village in three. Furnished and utilities included.",
    address: "515 Gayley Ave, Los Angeles, CA 90024",
    lat: 34.0661,
    lng: -118.4487,
    price: 1600,
    deposit: 800,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: SPRING,
    amenities: [
      "Furnished",
      "Wi-Fi",
      "Air conditioning",
      "Laundry",
      "Utilities included",
    ],
    photos: 3,
    palette: "sky",
  },
  {
    owner: "ethan",
    title: "Landfair Ave shared room, spring quarter",
    description:
      "Shared room on Landfair in a building full of students. Cheap for Westwood and you are five minutes from campus. My roommate is in the same program and keeps to a normal schedule.",
    address: "530 Landfair Ave, Los Angeles, CA 90024",
    lat: 34.0699,
    lng: -118.4503,
    price: 1050,
    deposit: 500,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "shared",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Laundry"],
    photos: 2,
    palette: "sage",
  },
  {
    owner: "sofia",
    title: "Levering Ave one bedroom, summer sublease",
    description:
      "Entire one bedroom on Levering for the summer while I am abroad. Parking spot in the garage, in unit laundry, and a balcony that gets the afternoon sun. Ten minute walk to campus through the village.",
    address: "621 Levering Ave, Los Angeles, CA 90024",
    lat: 34.0645,
    lng: -118.4471,
    price: 2300,
    deposit: 1150,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "entire",
    term: SUMMER,
    amenities: [
      "Furnished",
      "Wi-Fi",
      "Air conditioning",
      "Laundry",
      "Parking",
      "Private bathroom",
    ],
    photos: 4,
    palette: "terracotta",
  },
  {
    owner: "ethan",
    title: "Veteran Ave two bedroom, quiet side",
    description:
      "Two bedroom on Veteran south of Wilshire, quieter than the Landfair blocks and still a fifteen minute walk to campus. Big kitchen and a dining table that seats six. Parking included for one car.",
    address: "1442 Veteran Ave, Los Angeles, CA 90024",
    lat: 34.0572,
    lng: -118.4527,
    price: 2500,
    deposit: 2500,
    bedrooms: 2,
    bathrooms: 2,
    roomType: "entire",
    term: NOW_YEAR,
    amenities: ["Wi-Fi", "Laundry", "Parking", "Pet friendly"],
    photos: 3,
    palette: "slate",
  },
  {
    owner: "sofia",
    title: "Kelton Ave private room with own bathroom",
    description:
      "Private room and private bathroom in a three bed on Kelton. The other two are grad students, so the place is quiet most nights. Walk to campus in about twelve minutes or take the Bruin Bus.",
    address: "633 Kelton Ave, Los Angeles, CA 90024",
    lat: 34.0619,
    lng: -118.4441,
    price: 1750,
    deposit: 900,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: SPRING,
    amenities: [
      "Furnished",
      "Wi-Fi",
      "Laundry",
      "Private bathroom",
      "Utilities included",
    ],
    photos: 3,
    palette: "beige",
  },
  // LMU.
  {
    owner: "alina",
    title: "Room near the bluff, walk to LMU",
    description:
      "Bedroom in a two bed off Lincoln, a short walk up to the LMU campus. Furnished, quiet street, and close enough to Playa del Rey that you can be at the beach in ten minutes.",
    address: "8215 Regis Way, Los Angeles, CA 90045",
    lat: 33.9734,
    lng: -118.4198,
    price: 1300,
    deposit: 650,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: SPRING,
    amenities: ["Furnished", "Wi-Fi", "Laundry", "Parking"],
    photos: 3,
    palette: "sage",
  },
  {
    owner: "alina",
    title: "Westchester one bedroom for summer session",
    description:
      "Whole one bedroom in Westchester, five minutes by car from LMU and walkable to the shops on Sepulveda. Available for the summer session only. Parking is off street behind the building.",
    address: "6420 W 87th St, Los Angeles, CA 90045",
    lat: 33.9556,
    lng: -118.4051,
    price: 1900,
    deposit: 1900,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "entire",
    term: SUMMER,
    amenities: ["Wi-Fi", "Air conditioning", "Laundry", "Parking"],
    photos: 2,
    palette: "sky",
  },
];
// Most students sublease below what they pay. Mark roughly two thirds of the
// listings with the original lease rent so the savings UI has real data.
listings.forEach((item, index) => {
  if (item.originalPrice !== undefined) return;
  if (index % 3 === 1) return;
  const share = 0.1 + (index % 4) * 0.05;
  item.originalPrice = Math.round((item.price * (1 + share)) / 25) * 25;
});


// Demo owner variety for the My Listings page.
const ownerExtras = [
  {
    owner: "owner",
    status: "draft",
    title: "Draft, summer room on Hoover",
    description:
      "Still deciding whether to sublet this one for the summer. Need to confirm with my roommates and take better photos before I publish it.",
    address: "3015 S Hoover St, Los Angeles, CA 90007",
    lat: 34.0253,
    lng: -118.2831,
    price: 1100,
    deposit: 550,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: SUMMER,
    amenities: ["Furnished", "Wi-Fi"],
    photos: 2,
    palette: "terracotta",
  },
  {
    owner: "owner",
    status: "draft",
    title: "Draft, parking space near campus",
    description:
      "Garage spot on 30th that I may list separately once I check the lease terms.",
    address: "1250 W 30th St, Los Angeles, CA 90007",
    lat: 34.0266,
    lng: -118.2878,
    price: 150,
    deposit: 0,
    bedrooms: 0,
    bathrooms: 1,
    roomType: "shared",
    term: NOW_YEAR,
    amenities: ["Parking"],
    photos: 1,
    palette: "slate",
  },
  {
    owner: "owner",
    status: "handed_off",
    title: "Handed off, fall room on Ellendale Pl",
    description:
      "This room went to another student for the fall. Leaving it here so I have the record of the handoff and the messages that went with it.",
    address: "1220 Ellendale Pl, Los Angeles, CA 90007",
    lat: 34.0283,
    lng: -118.2908,
    price: 1000,
    deposit: 1000,
    bedrooms: 1,
    bathrooms: 1,
    roomType: "private",
    term: NOW_YEAR,
    amenities: ["Furnished", "Wi-Fi", "Laundry"],
    photos: 2,
    palette: "beige",
  },
];

/* --------------------------------------------------------------- imagery */

const PALETTES = {
  beige: {
    sky: ["#f6ecdd", "#e8d5bb"],
    wall: "#efe1cc",
    floor: "#c8a179",
    accent: "#8d6a45",
    soft: "#fbf5ec",
    trim: "#a8815a",
  },
  sage: {
    sky: ["#eef3e8", "#cfdcc4"],
    wall: "#e2ebdb",
    floor: "#9fb38d",
    accent: "#5f7a52",
    soft: "#f6faf2",
    trim: "#7d9568",
  },
  sky: {
    sky: ["#eaf2fa", "#c6dcf0"],
    wall: "#e3eef8",
    floor: "#93b2cd",
    accent: "#3f6c96",
    soft: "#f4f9fd",
    trim: "#6a93b8",
  },
  terracotta: {
    sky: ["#fbeee6", "#f0d0bd"],
    wall: "#f3ded1",
    floor: "#c9805e",
    accent: "#9a4e30",
    soft: "#fdf5f0",
    trim: "#b4694a",
  },
  slate: {
    sky: ["#eceef1", "#cdd3da"],
    wall: "#e1e5ea",
    floor: "#8e97a3",
    accent: "#4a535f",
    soft: "#f4f6f8",
    trim: "#6d7684",
  },
};

// Small deterministic generator so a re-seed produces identical images.
function makeRandom(seed) {
  let state = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

const W = 1600;
const H = 1067;

function sceneSvg(paletteName, variant, seed) {
  const p = PALETTES[paletteName] || PALETTES.beige;
  const r = makeRandom(seed);
  const jitter = (base, spread) => Math.round(base + (r() - 0.5) * spread);
  const layers = [];

  // Wall and floor.
  const horizon = jitter(660, 90);
  layers.push(`<rect width="${W}" height="${H}" fill="url(#wall)"/>`);
  layers.push(
    `<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${p.floor}"/>`,
  );
  layers.push(
    `<rect y="${horizon - 14}" width="${W}" height="14" fill="${p.trim}" opacity="0.55"/>`,
  );

  if (variant % 4 === 0) {
    // Window wall with light spill.
    const wx = jitter(760, 160);
    layers.push(
      `<rect x="${wx}" y="${jitter(150, 60)}" width="520" height="400" rx="10" fill="url(#glass)" stroke="${p.trim}" stroke-width="14"/>`,
      `<rect x="${wx + 253}" y="${jitter(150, 60)}" width="14" height="400" fill="${p.trim}"/>`,
      `<polygon points="${wx},${horizon} ${wx + 520},${horizon} ${wx + 700},${H} ${wx - 160},${H}" fill="${p.soft}" opacity="0.32"/>`,
      `<rect x="${jitter(170, 80)}" y="${horizon - 230}" width="420" height="230" rx="16" fill="${p.accent}" opacity="0.85"/>`,
      `<rect x="${jitter(210, 80)}" y="${horizon - 268}" width="150" height="40" rx="18" fill="${p.soft}" opacity="0.9"/>`,
    );
  } else if (variant % 4 === 1) {
    // Bed corner.
    const bx = jitter(300, 120);
    layers.push(
      `<rect x="${bx}" y="${horizon - 300}" width="760" height="300" rx="18" fill="${p.soft}"/>`,
      `<rect x="${bx}" y="${horizon - 120}" width="760" height="120" rx="14" fill="${p.accent}" opacity="0.75"/>`,
      `<rect x="${bx + 40}" y="${horizon - 372}" width="230" height="86" rx="26" fill="${p.soft}"/>`,
      `<rect x="${bx + 290}" y="${horizon - 372}" width="230" height="86" rx="26" fill="${p.soft}" opacity="0.85"/>`,
      `<rect x="${bx - 10}" y="${horizon - 420}" width="800" height="52" rx="14" fill="${p.trim}" opacity="0.7"/>`,
      `<circle cx="${bx + 900}" cy="${horizon - 260}" r="54" fill="${p.soft}" opacity="0.95"/>`,
      `<rect x="${bx + 884}" y="${horizon - 210}" width="32" height="210" fill="${p.trim}" opacity="0.8"/>`,
    );
  } else if (variant % 4 === 2) {
    // Kitchen counter.
    const cy = horizon - 210;
    layers.push(
      `<rect x="${jitter(120, 60)}" y="${cy}" width="1120" height="42" rx="12" fill="${p.soft}"/>`,
      `<rect x="${jitter(140, 60)}" y="${cy + 42}" width="1080" height="${horizon - cy - 42}" fill="${p.accent}" opacity="0.72"/>`,
      `<rect x="${jitter(240, 60)}" y="${jitter(180, 50)}" width="620" height="180" rx="10" fill="${p.trim}" opacity="0.55"/>`,
      `<circle cx="${jitter(1010, 80)}" cy="${cy - 46}" r="46" fill="${p.trim}" opacity="0.8"/>`,
      `<rect x="${jitter(430, 60)}" y="${cy - 96}" width="70" height="96" rx="12" fill="${p.soft}"/>`,
      `<rect x="${jitter(540, 60)}" y="${cy - 68}" width="52" height="68" rx="10" fill="${p.soft}" opacity="0.85"/>`,
    );
  } else {
    // Desk, chair and plant.
    const dx = jitter(420, 140);
    layers.push(
      `<rect x="${dx}" y="${horizon - 230}" width="700" height="28" rx="10" fill="${p.soft}"/>`,
      `<rect x="${dx + 30}" y="${horizon - 202}" width="26" height="202" fill="${p.trim}"/>`,
      `<rect x="${dx + 644}" y="${horizon - 202}" width="26" height="202" fill="${p.trim}"/>`,
      `<rect x="${dx + 190}" y="${horizon - 366}" width="330" height="136" rx="12" fill="${p.accent}" opacity="0.85"/>`,
      `<circle cx="${jitter(1290, 70)}" cy="${horizon - 130}" r="96" fill="${p.accent}" opacity="0.5"/>`,
      `<rect x="${jitter(1256, 70)}" y="${horizon - 110}" width="72" height="110" rx="14" fill="${p.trim}"/>`,
      `<circle cx="${jitter(230, 60)}" cy="${jitter(260, 60)}" r="120" fill="${p.soft}" opacity="0.6"/>`,
    );
  }

  // Soft foreground wash so cards do not look flat.
  layers.push(
    `<rect width="${W}" height="${H}" fill="url(#vignette)"/>`,
    `<circle cx="${jitter(1380, 200)}" cy="${jitter(200, 120)}" r="260" fill="${p.soft}" opacity="0.22"/>`,
  );

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${p.sky[0]}"/>
      <stop offset="1" stop-color="${p.wall}"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${p.sky[0]}"/>
      <stop offset="1" stop-color="${p.sky[1]}"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.78">
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="${p.accent}" stop-opacity="0.18"/>
    </radialGradient>
  </defs>
  ${layers.join("\n  ")}
</svg>`,
  );
}

// Matches the /api/uploads pipeline. One WebP file per photo, no thumbnail.
async function renderPhoto(paletteName, variant, seed) {
  return sharp(sceneSvg(paletteName, variant, seed))
    .rotate()
    .resize({
      width: 1800,
      height: 1800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 84 })
    .toBuffer();
}

/* ------------------------------------------------------------------ seed */

const db = openDatabase(dataDir);
const uploadDir = join(dataDir, "uploads");
const demoEmails = users.map((user) => user.email);
const placeholders = demoEmails.map(() => "?").join(",");

const existing = db
  .prepare(`SELECT id, email FROM users WHERE email IN (${placeholders})`)
  .all(...demoEmails);

if (existing.length) {
  console.log(`Found ${existing.length} existing demo users, re-seeding clean.`);
  const ids = existing.map((row) => row.id);
  const idHoles = ids.map(() => "?").join(",");
  const files = db
    .prepare(`SELECT filename FROM uploads WHERE owner_id IN (${idHoles})`)
    .all(...ids)
    .map((row) => row.filename);
  db.transaction(() => {
    db.prepare(
      `DELETE FROM handoff_requests WHERE requester_id IN (${idHoles}) OR listing_id IN (SELECT id FROM listings WHERE owner_id IN (${idHoles}))`,
    ).run(...ids, ...ids);
    db.prepare(
      `DELETE FROM reports WHERE reporter_id IN (${idHoles}) OR listing_id IN (SELECT id FROM listings WHERE owner_id IN (${idHoles}))`,
    ).run(...ids, ...ids);
    db.prepare(
      `DELETE FROM saved_listings WHERE user_id IN (${idHoles}) OR listing_id IN (SELECT id FROM listings WHERE owner_id IN (${idHoles}))`,
    ).run(...ids, ...ids);
    db.prepare(`DELETE FROM listings WHERE owner_id IN (${idHoles})`).run(...ids);
    db.prepare(`DELETE FROM uploads WHERE owner_id IN (${idHoles})`).run(...ids);
    db.prepare(`DELETE FROM sessions WHERE user_id IN (${idHoles})`).run(...ids);
    db.prepare(`DELETE FROM auth_tokens WHERE user_id IN (${idHoles})`).run(...ids);
    db.prepare(`DELETE FROM users WHERE id IN (${idHoles})`).run(...ids);
  })();
  for (const filename of files) {
    const path = join(uploadDir, filename);
    if (existsSync(path)) rmSync(path);
  }
  console.log(`Removed ${files.length} previously seeded photo files.`);
}

const passwordHash = await hashPassword(DEMO_PASSWORD);
const userIds = {};
const now = iso();

db.transaction(() => {
  users.forEach((user, index) => {
    const id = randomUUID();
    userIds[user.key] = id;
    db.prepare(
      "INSERT INTO users(id,name,email,campus_id,password_hash,verified_at,bio,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      user.name,
      user.email,
      user.campusId,
      passwordHash,
      daysAgo(60 - index),
      user.bio,
      daysAgo(60 - index),
      now,
    );
  });
})();
console.log(`Inserted ${users.length} verified demo users.`);

const campusOf = Object.fromEntries(
  users.map((user) => [user.key, user.campusId]),
);
const all = [
  ...listings.map((item) => ({ ...item, status: "active" })),
  ...ownerExtras,
];

let photoCount = 0;
let photoBytes = 0;
const listingIds = [];

for (const [index, item] of all.entries()) {
  const ownerId = userIds[item.owner];
  const paths = [];
  for (let n = 0; n < item.photos; n++) {
    const buffer = await renderPhoto(item.palette, n + index, index * 97 + n * 13 + 7);
    const id = randomUUID();
    const filename = `${id}.webp`;
    await writeFile(join(uploadDir, filename), buffer, {
      flag: "wx",
      mode: 0o600,
    });
    db.prepare(
      "INSERT INTO uploads(id,owner_id,filename,bytes,created_at) VALUES(?,?,?,?,?)",
    ).run(id, ownerId, filename, buffer.length, daysAgo(30 - (index % 25)));
    paths.push(`/uploads/${filename}`);
    photoCount++;
    photoBytes += buffer.length;
  }

  const listingId = randomUUID();
  listingIds.push({ id: listingId, owner: item.owner, status: item.status });
  const created = daysAgo(30 - (index % 25));
  db.prepare(
    `INSERT INTO listings(id,owner_id,campus_id,title,description,address,lat,lng,price,deposit,original_price,bedrooms,bathrooms,room_type,available_from,available_to,amenities,photos,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    listingId,
    ownerId,
    campusOf[item.owner],
    item.title,
    item.description,
    item.address,
    item.lat,
    item.lng,
    item.price,
    item.deposit,
    item.originalPrice ?? null,
    item.bedrooms,
    item.bathrooms,
    item.roomType,
    item.term[0],
    item.term[1],
    JSON.stringify(item.amenities.filter((a) => AMENITIES.includes(a))),
    JSON.stringify(paths),
    item.status,
    created,
    created,
  );
  process.stdout.write(`\rRendered photos for ${index + 1}/${all.length} listings`);
}
process.stdout.write("\n");

const byOwner = (key, status = "active") =>
  listingIds.filter((row) => row.owner === key && row.status === status);

// Saved listings for the demo owner.
const savedTargets = [
  ...byOwner("jordan").slice(0, 2),
  ...byOwner("priya").slice(0, 1),
  ...byOwner("marcus").slice(0, 1),
];
for (const [index, target] of savedTargets.entries())
  db.prepare(
    "INSERT OR IGNORE INTO saved_listings(user_id,listing_id,created_at) VALUES(?,?,?)",
  ).run(userIds.owner, target.id, daysAgo(10 - index));

// Handoff requests. The unique index allows one pending or accepted request
// per listing per requester, so each live pair uses a distinct listing.
const requestPlan = [
  // Demo owner as requester.
  {
    listing: byOwner("jordan")[0],
    requester: "owner",
    status: "pending",
    message:
      "Hi, I am looking for a spring sublease and this looks like a great fit. I am a junior, quiet, and can move in the week classes start. Would you be open to a quick call this week?",
  },
  {
    listing: byOwner("priya")[0],
    requester: "owner",
    status: "accepted",
    message:
      "This is exactly what I need for spring. I can put down the deposit as soon as you confirm, and I am happy to meet in person first.",
  },
  {
    listing: byOwner("marcus")[0],
    requester: "owner",
    status: "declined",
    message:
      "Hello, is this still available for the spring term? I am flexible on the exact move in date if that helps.",
  },
  {
    listing: byOwner("jordan")[1],
    requester: "owner",
    status: "withdrawn",
    message:
      "I was interested in this one, though I have since found something closer to campus. Thank you for the quick reply either way.",
  },
  // Demo owner as listing owner.
  {
    listing: byOwner("owner")[0],
    requester: "priya",
    status: "pending",
    message:
      "Hi Maya, I am a grad student in Annenberg looking for a spring room. Your place is right in the area I want. Are the utilities really included in the rent?",
  },
  {
    listing: byOwner("owner")[1],
    requester: "marcus",
    status: "accepted",
    message:
      "Hey, I would take this for spring. I have lived on Ellendale before and I am fine with the shared utilities split. Let me know what you need from me.",
  },
  {
    listing: byOwner("owner")[2],
    requester: "jordan",
    status: "declined",
    message:
      "Interested in the summer room. I would only need it through the end of July if that works for your timing.",
  },
  {
    listing: byOwner("owner")[3],
    requester: "priya",
    status: "withdrawn",
    message:
      "I wanted to ask about this listing, but my program schedule changed so I am withdrawing for now. Thanks for your time.",
  },
  // Some traffic between the other students.
  {
    listing: byOwner("marcus")[1],
    requester: "jordan",
    status: "pending",
    message:
      "Is the second bedroom furnished as well? I would be moving in with a roommate at the start of the spring term.",
  },
  {
    listing: byOwner("sofia")[0],
    requester: "ethan",
    status: "accepted",
    message:
      "I am in the same department and looking for spring housing on that side of campus. Happy to sign whenever you are ready.",
  },
];

let requestCount = 0;
for (const [index, plan] of requestPlan.entries()) {
  if (!plan.listing) continue;
  const created = daysAgo(20 - index);
  db.prepare(
    "INSERT INTO handoff_requests(id,listing_id,requester_id,message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    plan.listing.id,
    userIds[plan.requester],
    plan.message,
    plan.status,
    created,
    daysAgo(Math.max(1, 20 - index - 2)),
  );
  requestCount++;
}

/* -------------------------------------------------------------- reporting */

const counts = db
  .prepare(
    `SELECT campus_id, status, COUNT(*) AS n FROM listings GROUP BY campus_id, status ORDER BY campus_id, status`,
  )
  .all();

console.log("");
console.log("Seeded");
console.log(`  users     ${users.length}`);
console.log(`  listings  ${all.length}`);
for (const row of counts)
  console.log(`            ${row.campus_id} ${row.status}: ${row.n}`);
console.log(
  `  photos    ${photoCount} WebP files, ${(photoBytes / 1024 / 1024).toFixed(1)} MB`,
);
console.log(`  saved     ${savedTargets.length}`);
console.log(`  requests  ${requestCount}`);
console.log(`  today     ${TODAY}`);
console.log("");
console.log("Demo credentials, every account uses the same password");
console.log(`  password  ${DEMO_PASSWORD}`);
for (const user of users)
  console.log(`  ${user.email.padEnd(24)} ${user.name} (${user.campusId})`);
console.log("");
console.log("Sign in as demo.owner@usc.edu to see saved listings, drafts, a handed off listing, and requests in both directions.");

db.close();
