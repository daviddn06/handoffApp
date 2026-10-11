/** Shapes returned by /api/admin. Kept beside the dashboard, not in the app types. */
export type Point = { day: string; count: number };
export type Overview = {
  totals: {
    users: number;
    verifiedUsers: number;
    admins: number;
    disabledUsers: number;
    listings: number;
    listingsByStatus: Record<string, number>;
    boostedActive: number;
    requests: number;
    requestsByStatus: Record<string, number>;
    saved: number;
    waitlist: number;
    reportsOpen: number;
    reports: number;
    uploads: number;
    sessionsActive: number;
  };
  usersBySchool: { school: string; count: number }[];
  usersByGender: { gender: string; count: number }[] | null;
  series: {
    signups: Point[];
    listings: Point[];
    requests: Point[];
    views: Point[] | null;
    aiTokens: Point[] | null;
  };
  generatedAt: string;
};
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  school: string;
  schoolDomain: string;
  campusId: string | null;
  verified: boolean;
  verifiedAt: string | null;
  termsAccepted: boolean;
  termsAcceptedAt: string | null;
  gender: string | null;
  isAdmin: boolean;
  disabledAt: string | null;
  bio: string;
  createdAt: string;
  updatedAt: string;
  lastSignIn: string | null;
  listingCount: number;
  requestCount: number;
  savedCount: number;
};
export type AdminListing = {
  id: string;
  title: string;
  status: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  campusId: string;
  address: string;
  price: number;
  originalPrice: number | null;
  deposit: number;
  bedrooms: number;
  bathrooms: number;
  roomType: string;
  availableFrom: string;
  availableTo: string;
  photos: string[];
  moderationLocked: boolean;
  boostUntil: string | null;
  boosted: boolean;
  views: number;
  requests: number;
  createdAt: string;
  updatedAt: string;
};
export type AdminRequest = {
  id: string;
  listingId: string;
  listingTitle: string;
  requesterId: string;
  requesterName: string;
  ownerId: string;
  ownerName: string;
  message: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};
export type AdminReport = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingStatus: string;
  reporterId: string;
  reporterName: string;
  reporterEmail: string;
  reason: string;
  details: string;
  status: string;
  createdAt: string;
};
export type AuditEntry = {
  id: string;
  adminId: string;
  adminName: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
};
export type Paged = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};
export type UsersPage = Paged & {
  users: AdminUser[];
  schools: { school: string; count: number }[];
};
export type ListingsPage = Paged & { listings: AdminListing[] };
export type RequestsPage = Paged & { requests: AdminRequest[] };
export type ReportsPage = Paged & { reports: AdminReport[] };
export type WaitlistPage = Paged & {
  waitlist: {
    id: string;
    email: string;
    school: string;
    domain: string;
    createdAt: string;
  }[];
  bySchool: { school: string; count: number }[];
};
export type AuditPage = Paged & { audit: AuditEntry[] };
export type UserDetail = {
  user: AdminUser;
  listings: {
    id: string;
    title: string;
    status: string;
    price: number;
    campusId: string;
    boostUntil: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  requestsSent: AdminRequest[];
  requestsReceived: AdminRequest[];
  sessions: { createdAt: string; expiresAt: string; active: boolean }[];
  boosts: {
    id: string;
    listingId: string;
    listingTitle: string;
    kind: string;
    priceCents: number;
    startsAt: string;
    endsAt: string;
  }[];
  audit: AuditEntry[];
  aiUsage: { calls: number; tokens: number } | null;
};
export type ListingDetailData = {
  listing: AdminListing;
  requests: AdminRequest[];
  boosts: {
    id: string;
    kind: string;
    priceCents: number;
    startsAt: string;
    endsAt: string;
  }[];
  reports: {
    id: string;
    reason: string;
    details: string;
    status: string;
    createdAt: string;
  }[];
  audit: AuditEntry[];
};
export type AiUsage = {
  available: boolean;
  perDay: Point[];
  perUser: {
    userId: string;
    name: string;
    email: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    lastUsed: string;
  }[];
  totals: { calls: number; input_tokens: number; output_tokens: number } | null;
};
export type SystemInfo = {
  app: {
    release: string;
    nodeVersion: string;
    pid: number;
    uptimeSeconds: number;
    memory: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
    dataDir: string;
    staticDir: string;
    environment: string;
  };
  database: {
    schemaVersion: number;
    file: string;
    bytes: number;
    walBytes: number;
    journalMode: string;
    pageSize: number;
    tables: number;
  };
  host: {
    hostname: string;
    platform: string;
    arch: string;
    osUptimeSeconds: number;
    loadAverage: number[];
    totalMemory: number;
    freeMemory: number;
    cpus: number;
    cpuModel: string;
  };
  storage: {
    uploads: { bytes: number; files: number; available: boolean };
    logos: { bytes: number; files: number; available: boolean };
    disk: {
      available: boolean;
      filesystem?: string;
      totalBytes?: number;
      usedBytes?: number;
      freeBytes?: number;
      usedPercent?: number;
    };
  };
  backups: {
    available: boolean;
    path: string;
    entries: {
      name: string;
      directory: boolean;
      bytes: number;
      modifiedAt: string;
    }[];
  };
  services: {
    mailConfigured: boolean;
    aiConfigured: boolean;
    origin: string;
  };
  journal: { available: boolean; lines: string[] };
  generatedAt: string;
};
