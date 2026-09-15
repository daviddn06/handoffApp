import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useSearchParams,
} from "react-router-dom";
import { AppProvider, useApp } from "./lib/context";
import { isInternalSurface } from "./surface";
import { safeNext } from "./lib/api";
import { Layout, RequireAuth } from "./components/Layout";
import { EmptyState, Loading } from "./components/ui";
import Browse from "./pages/Browse";
const Auth = lazy(() => import("./pages/Auth"));
const ListingDetail = lazy(() => import("./pages/ListingDetail"));
const ListingEditor = lazy(() => import("./pages/ListingEditor"));
const ListingStart = lazy(() => import("./pages/ListingStart"));
const ListingImport = lazy(() => import("./pages/ListingImport"));
const ListingChat = lazy(() => import("./pages/ListingChat"));
const Saved = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.Saved })),
);
const MyListings = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.MyListings })),
);
const Requests = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.Requests })),
);
const Legal = lazy(() => import("./pages/Legal"));
const Profile = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.Profile })),
);
/** The dashboard's own host. The student app never loads on it. */
const Internal = lazy(() => import("./pages/admin/Internal"));
const AdminMoved = lazy(() => import("./pages/admin/Moved"));
/** Signed in students never see sign in or sign up, they go straight in. */
function GuestOnly({ children }: { children: React.ReactElement }) {
  const { user } = useApp();
  const [params] = useSearchParams();
  if (user) return <Navigate to={safeNext(params.get("next"))} replace />;
  return children;
}

/**
 * /listings/new asks how the student wants to list before it opens the six
 * step form. mode=manual is the form, import and chat are the two AI ways in.
 * Editing an existing listing never sees the chooser.
 */
function NewListing() {
  const [params] = useSearchParams();
  const { aiReady } = useApp();
  const mode = params.get("mode");
  // The chooser shows these two as being set up, so the routes behind them
  // are gated the same way rather than opening a screen that cannot finish.
  if ((mode === "import" || mode === "chat") && !aiReady)
    return <ListingStart />;
  if (mode === "import") return <ListingImport />;
  if (mode === "chat") return <ListingChat />;
  if (mode === "manual" || params.get("from") === "import")
    return <ListingEditor />;
  return <ListingStart />;
}

export default function App() {
  // internal.handofflease.com serves this same bundle. There it is the
  // dashboard and nothing else, mounted at the root with its own chrome.
  if (isInternalSurface)
    return (
      <BrowserRouter>
        <AppProvider>
          <Suspense fallback={<Loading />}>
            <Internal />
          </Suspense>
        </AppProvider>
      </BrowserRouter>
    );
  return (
    <BrowserRouter>
      <AppProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/browse" replace />} />
              <Route path="browse" element={<Browse />} />
              <Route path="listings/:id" element={<ListingDetail />} />
              {(["sign-in", "sign-up"] as const).map((mode) => (
                <Route
                  key={mode}
                  path={mode}
                  element={
                    <GuestOnly>
                      <Auth mode={mode} />
                    </GuestOnly>
                  }
                />
              ))}
              {(["forgot-password", "reset-password", "verify"] as const).map(
                (mode) => (
                  <Route key={mode} path={mode} element={<Auth mode={mode} />} />
                ),
              )}
              <Route path="terms" element={<Legal kind="terms" />} />
              <Route path="privacy" element={<Legal kind="privacy" />} />
              <Route element={<RequireAuth to="/sign-up" />}>
                <Route path="listings/new" element={<NewListing />} />
                <Route path="listings/:id/edit" element={<ListingEditor />} />
              </Route>
              {/* The dashboard moved to internal.handofflease.com. */}
              <Route path="admin/*" element={<AdminMoved />} />
              <Route element={<RequireAuth />}>
                <Route path="saved" element={<Saved />} />
                <Route path="my-listings" element={<MyListings />} />
                <Route path="requests" element={<Requests />} />
                <Route path="profile" element={<Profile />} />
              </Route>
              <Route
                path="*"
                element={
                  <div className="page-container">
                    <EmptyState
                      title="We could not find that page."
                      description="The link may be broken or the listing may have been taken down."
                    >
                      <Link className="button primary" to="/browse">
                        Back to browse
                      </Link>
                    </EmptyState>
                  </div>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </AppProvider>
    </BrowserRouter>
  );
}
