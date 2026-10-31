import { createContext, useContext, type ReactNode } from 'react';
import { AlertCircle, BookOpen, Loader2, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import type { Course } from '@shared/content';

export type CatalogState = {
  courses: Course[];
  loading: boolean;
  error: { message: string } | null;
  retry: () => void;
  isAdminPreview: boolean;
};
const CatalogContext = createContext<CatalogState | null>(null);
export function CatalogProvider({ children, override, isAdminPreview = false }: { children: ReactNode; override?: Course[]; isAdminPreview?: boolean }) {
  const query = trpc.content.catalog.useQuery(undefined, { enabled: override === undefined, retry: 1, refetchOnWindowFocus: true, staleTime: 15000 });
  return <CatalogContext.Provider value={{ courses: override ?? query.data ?? [], loading: override === undefined && query.isPending, error: override === undefined ? query.error : null, retry: () => { void query.refetch(); }, isAdminPreview }}>{children}</CatalogContext.Provider>;
}
export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) throw new Error('Le catalogue doit être fourni par CatalogProvider.');
  return context;
}
export function CatalogBoundary({ children }: { children: ReactNode }) {
  const { loading, error, retry } = useCatalog();
  if (loading) return <section className="panel catalog-status" role="status"><Loader2 className="catalog-spinner" size={28} /><h1>Chargement de tes cours…</h1><p>On prépare ton espace d’apprentissage.</p></section>;
  if (error) return <section className="panel catalog-status" role="alert"><AlertCircle size={30} /><h1>Les cours ne sont pas disponibles pour le moment.</h1><p>Le contenu n’a pas pu être chargé. Tes notes et ta progression restent dans ton navigateur.</p><button className="btn primary" onClick={retry}><RefreshCw size={16} /> Réessayer</button></section>;
  return <>{children}</>;
}
