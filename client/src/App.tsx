import { Route, Switch, useParams } from 'wouter';
import { AlertCircle, Loader2 } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import LearningShell from './components/LearningShell';
import AdminGate from './components/AdminGate';
import { CatalogBoundary, CatalogProvider } from './contexts/CatalogContext';
import { LearningProvider } from './contexts/LearningContext';
import { trpc } from './lib/trpc';
import Home from './pages/Home';
import Library from './pages/Library';
import CourseDetail from './pages/CourseDetail';
import Lesson from './pages/Lesson';
import MyLearning from './pages/MyLearning';
import Resources from './pages/Resources';
import NotFound from './pages/NotFound';
import AdminCourses from './pages/admin/AdminCourses';
import AdminEditor from './pages/admin/AdminEditor';

function AdminPreviewContent({ lesson = false }: { lesson?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const query = trpc.content.adminGet.useQuery({ id }, { retry: false });
  if (query.isPending) return <section className="panel catalog-status" role="status"><Loader2 className="catalog-spinner" size={28} /><h1>Chargement de l’aperçu…</h1></section>;
  if (query.error) {
    if (query.error.data?.code === 'NOT_FOUND') return <NotFound />;
    return <section className="panel catalog-status" role="alert"><AlertCircle size={28} /><h1>L’aperçu n’a pas pu être chargé.</h1><p>{query.error.message}</p><button className="btn primary" onClick={() => void query.refetch()}>Réessayer</button></section>;
  }
  return <CatalogProvider override={[query.data]} isAdminPreview><LearningProvider>{lesson ? <Lesson /> : <CourseDetail />}</LearningProvider></CatalogProvider>;
}
function AdminPreview({ lesson = false }: { lesson?: boolean }) {
  return <AdminGate><AdminPreviewContent lesson={lesson} /></AdminGate>;
}
function ClientPage({ children }: { children: React.ReactNode }) {
  return <CatalogBoundary>{children}</CatalogBoundary>;
}
export default function App() {
  return (
    <ErrorBoundary>
      <CatalogProvider>
        <LearningProvider>
          <LearningShell>
            <Switch>
              <Route path="/admin" component={AdminCourses} />
              <Route path="/admin/courses/:id" component={AdminEditor} />
              <Route path="/admin/preview/:id/lesson/:lessonId">{() => <AdminPreview lesson />}</Route>
              <Route path="/admin/preview/:id">{() => <AdminPreview />}</Route>
              <Route path="/">{() => <ClientPage><Home /></ClientPage>}</Route>
              <Route path="/courses">{() => <ClientPage><Library /></ClientPage>}</Route>
              <Route path="/courses/:courseId">{() => <ClientPage><CourseDetail /></ClientPage>}</Route>
              <Route path="/learn/:courseId/:lessonId">{() => <ClientPage><Lesson /></ClientPage>}</Route>
              <Route path="/my-learning">{() => <ClientPage><MyLearning /></ClientPage>}</Route>
              <Route path="/resources">{() => <ClientPage><Resources /></ClientPage>}</Route>
              <Route path="/404" component={NotFound} />
              <Route component={NotFound} />
            </Switch>
          </LearningShell>
        </LearningProvider>
      </CatalogProvider>
    </ErrorBoundary>
  );
}
