import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "./lib/context";
import { Layout, RequireAuth } from "./components/Layout";
import { EmptyState, Loading } from "./components/ui";
import Browse from "./pages/Browse";
const Auth = lazy(() => import("./pages/Auth"));
const ListingDetail = lazy(() => import("./pages/ListingDetail"));
const ListingEditor = lazy(() => import("./pages/ListingEditor"));
const Saved = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.Saved })),
);
const MyListings = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.MyListings })),
);
const Requests = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.Requests })),
);
const Profile = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.Profile })),
);
export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/browse" replace />} />
              <Route path="browse" element={<Browse />} />
              <Route path="listings/:id" element={<ListingDetail />} />
              {(
                [
                  "sign-in",
                  "sign-up",
                  "forgot-password",
                  "reset-password",
                  "verify",
                ] as const
              ).map((mode) => (
                <Route key={mode} path={mode} element={<Auth mode={mode} />} />
              ))}
              <Route element={<RequireAuth />}>
                <Route path="listings/new" element={<ListingEditor />} />
                <Route path="listings/:id/edit" element={<ListingEditor />} />
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
                      title="This page has moved on."
                      description="Let’s get you back to finding your next place."
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
