import type { ReactNode } from "react";
import { AlertCircle, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";

type AdminGateProps = {
  children: ReactNode;
};

export default function AdminGate({ children }: AdminGateProps) {
  const { user, loading, error, refresh } = useAuth();

  if (loading) {
    return (
      <section className="admin-gate panel" aria-live="polite">
        <span className="admin-spinner" aria-hidden="true" />
        <p className="eyebrow">
          <span className="eyebrow-line" /> ACCÈS ADMINISTRATEUR
        </p>
        <h1>Vérification de ton accès</h1>
        <p className="muted">Un instant, on vérifie ta connexion.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="admin-gate panel" role="alert">
        <span className="admin-gate-icon is-error">
          <AlertCircle size={22} />
        </span>
        <p className="eyebrow">
          <span className="eyebrow-line" /> ACCÈS ADMINISTRATEUR
        </p>
        <h1>Impossible de vérifier ton accès</h1>
        <p className="muted">
          Réessaie dans un instant. Si le problème persiste, vérifie ta
          connexion.
        </p>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            void refresh();
          }}
        >
          <RefreshCw size={16} /> Réessayer
        </button>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="admin-gate panel">
        <span className="admin-gate-icon">
          <LockKeyhole size={22} />
        </span>
        <p className="eyebrow">
          <span className="eyebrow-line" /> ACCÈS ADMINISTRATEUR
        </p>
        <h1>Connecte-toi pour gérer le contenu</h1>
        <p className="muted">
          Utilise le compte autorisé à administrer les cours EJ Coaching.
        </p>
        <button type="button" className="btn primary" onClick={startLogin}>
          <ShieldCheck size={16} /> Se connecter
        </button>
      </section>
    );
  }

  if (user.role !== "admin") {
    return (
      <section className="admin-gate panel" role="alert">
        <span className="admin-gate-icon is-error">
          <LockKeyhole size={22} />
        </span>
        <p className="eyebrow">
          <span className="eyebrow-line" /> ACCÈS ADMINISTRATEUR
        </p>
        <h1>Accès refusé</h1>
        <p className="muted">
          Ce compte n’a pas l’autorisation de gérer le contenu. Utilise un
          compte administrateur autorisé.
        </p>
      </section>
    );
  }

  return <>{children}</>;
}
