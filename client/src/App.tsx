import { Route, Switch, useParams, useLocation, Redirect } from "wouter";
import { AlertCircle, Loader2, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import LearningShell from "./components/LearningShell";
import AdminGate from "./components/AdminGate";
import ClientGate from "./components/ClientGate";
import { AccessProvider, useAccess } from "./contexts/AccessContext";
import {
  CatalogBoundary,
  CatalogProvider,
  useCatalog,
} from "./contexts/CatalogContext";
import { LearningProvider } from "./contexts/LearningContext";
import { trpc } from "./lib/trpc";
import { startLogin } from "./const";
import { courseMediaUrl } from "@shared/privateMedia";
import Home from "./pages/Home";
import Library from "./pages/Library";
import CourseDetail from "./pages/CourseDetail";
import Lesson from "./pages/Lesson";
import MyLearning from "./pages/MyLearning";
import Resources from "./pages/Resources";
import NotFound from "./pages/NotFound";
import AdminCourses from "./pages/admin/AdminCourses";
import AdminEditor from "./pages/admin/AdminEditor";
import AdminClients from "./pages/admin/AdminClients";

function AdminPreviewContent({ lesson = false }: { lesson?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const query = trpc.content.adminGet.useQuery({ id }, { retry: false });
  if (query.isPending)
    return (
      <section className="panel catalog-status" role="status">
        <Loader2 className="catalog-spinner" size={28} />
        <h1>Chargement de l’aperçu…</h1>
      </section>
    );
  if (query.error) {
    if (query.error.data?.code === "NOT_FOUND") return <NotFound />;
    return (
      <section className="panel catalog-status" role="alert">
        <AlertCircle size={28} />
        <h1>L’aperçu n’a pas pu être chargé.</h1>
        <p>{query.error.message}</p>
        <button className="btn primary" onClick={() => void query.refetch()}>
          Réessayer
        </button>
      </section>
    );
  }
  const course = {
    ...query.data,
    lessons: query.data.lessons.map(item => ({
      ...item,
      ...(item.videoUrl?.startsWith("/manus-storage/")
        ? { videoUrl: courseMediaUrl(id, item.id, "video") }
        : {}),
      ...(item.videoPosterUrl?.startsWith("/manus-storage/")
        ? { videoPosterUrl: courseMediaUrl(id, item.id, "poster") }
        : {}),
      resources: item.resources?.map(resource => ({
        ...resource,
        ...(resource.url.startsWith("/manus-storage/")
          ? { url: courseMediaUrl(id, item.id, "resource", resource.id) }
          : {}),
      })),
    })),
  };
  return (
    <CatalogProvider override={[course]} isAdminPreview>
      <LearningProvider>
        {lesson ? <Lesson /> : <CourseDetail />}
      </LearningProvider>
    </CatalogProvider>
  );
}
function AdminPreview({ lesson = false }: { lesson?: boolean }) {
  return (
    <AdminGate>
      <AdminPreviewContent lesson={lesson} />
    </AdminGate>
  );
}
function AssignedContent({ children }: { children: ReactNode }) {
  const { courses } = useCatalog();
  const { access } = useAccess();
  if (!access?.isAdmin && !courses.length)
    return (
      <section className="panel catalog-status">
        <LockKeyhole size={28} />
        <h1>Aucun cours attribué pour le moment</h1>
        <p>
          Ton compte est approuvé. EJ Coaching doit maintenant sélectionner les
          cours de ton parcours.
        </p>
      </section>
    );
  return <>{children}</>;
}
function ClientPage({ children }: { children: ReactNode }) {
  return (
    <ClientGate>
      <CatalogBoundary>
        <AssignedContent>{children}</AssignedContent>
      </CatalogBoundary>
    </ClientGate>
  );
}
function DeniedAccess() {
  return (
    <section className="client-gate panel" role="alert">
      <span className="client-gate-icon">
        <LockKeyhole size={23} />
      </span>
      <p className="eyebrow">ESPACE MEMBRE</p>
      <h1>Ce compte n’a pas accès à EJ Coaching</h1>
      <p className="muted">
        Utilise l’adresse courriel approuvée par ton coach. Si ton accès est
        suspendu ou pas encore approuvé, communique avec EJ Coaching.
      </p>
      <button className="btn primary" onClick={() => startLogin()}>
        Réessayer avec mon compte Manus
      </button>
    </section>
  );
}
function ApplicationRoutes() {
  const { access, loading, error } = useAccess();
  const [location] = useLocation();
  if (error || !access?.allowed)
    return (
      <LearningShell>
        {!loading && !error && location === "/access-denied" ? (
          <DeniedAccess />
        ) : (
          <ClientGate>{null}</ClientGate>
        )}
      </LearningShell>
    );
  return (
    <>
      <div
        style={{
          display: "contents",
          visibility: loading ? "hidden" : "visible",
        }}
        aria-hidden={loading}
      >
        <CatalogProvider>
          <LearningProvider key={`account-${access.user?.id}`}>
            <LearningShell>
              <Switch>
                <Route path="/admin" component={AdminCourses} />
                <Route path="/admin/clients" component={AdminClients} />
                <Route path="/admin/courses/:id" component={AdminEditor} />
                <Route path="/admin/preview/:id/lesson/:lessonId">
                  {() => <AdminPreview lesson />}
                </Route>
                <Route path="/admin/preview/:id">
                  {() => <AdminPreview />}
                </Route>
                <Route path="/login">
                  {() => <Redirect to={access.isAdmin ? "/admin" : "/"} />}
                </Route>
                <Route path="/access-denied">
                  {() => <Redirect to={access.isAdmin ? "/admin" : "/"} />}
                </Route>
                <Route path="/">
                  {() => (
                    <ClientPage>
                      <Home />
                    </ClientPage>
                  )}
                </Route>
                <Route path="/courses">
                  {() => (
                    <ClientPage>
                      <Library />
                    </ClientPage>
                  )}
                </Route>
                <Route path="/courses/:courseId">
                  {() => (
                    <ClientPage>
                      <CourseDetail />
                    </ClientPage>
                  )}
                </Route>
                <Route path="/learn/:courseId/:lessonId">
                  {() => (
                    <ClientPage>
                      <Lesson />
                    </ClientPage>
                  )}
                </Route>
                <Route path="/my-learning">
                  {() => (
                    <ClientPage>
                      <MyLearning />
                    </ClientPage>
                  )}
                </Route>
                <Route path="/resources">
                  {() => (
                    <ClientPage>
                      <Resources />
                    </ClientPage>
                  )}
                </Route>
                <Route path="/404" component={NotFound} />
                <Route component={NotFound} />
              </Switch>
            </LearningShell>
          </LearningProvider>
        </CatalogProvider>
      </div>
      {loading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            display: "grid",
            placeItems: "center",
            background: "#10101a",
          }}
          role="status"
        >
          <section className="panel catalog-status">
            <Loader2 className="catalog-spinner" size={28} />
            <h1>Vérification de ton accès</h1>
          </section>
        </div>
      )}
    </>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <AccessProvider>
        <ApplicationRoutes />
      </AccessProvider>
    </ErrorBoundary>
  );
}
