import type { ReactNode } from "react";
import { useState } from "react";
import {
  AlertCircle,
  CircleHelp,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserRoundX,
} from "lucide-react";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAccess } from "@/contexts/AccessContext";
import "./ClientGate.css";

type ClientGateProps = {
  children: ReactNode;
};

function displayActionError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Cette action n’a pas pu être complétée. Réessaie dans un instant.";
}

export default function ClientGate({ children }: ClientGateProps) {
  const { access, error, loading, retry } = useAccess();
  const { logout, loading: authLoading } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);

  const signIn = () => {
    setActionError(null);
    try {
      // startLogin has to be called from this click handler: it creates the
      // one-time Manus OAuth state cookie immediately before navigation.
      startLogin();
    } catch (caught) {
      setActionError(displayActionError(caught));
    }
  };

  const signOut = async () => {
    setActionError(null);
    try {
      await logout();
    } catch (caught) {
      setActionError(displayActionError(caught));
    }
  };

  const useAnotherAccount = async () => {
    setActionError(null);
    try {
      await logout();
      startLogin();
    } catch (caught) {
      setActionError(displayActionError(caught));
    }
  };

  if (loading && !access?.allowed) {
    return (
      <section className="client-gate panel" aria-live="polite">
        <span className="client-gate-spinner" aria-hidden="true" />
        <p className="eyebrow">
          <span className="eyebrow-line" /> ESPACE MEMBRE
        </p>
        <h1>Vérification de ton accès</h1>
        <p className="muted">Un instant, on confirme l’accès à ton espace.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="client-gate panel" role="alert">
        <span className="client-gate-icon is-error">
          <AlertCircle size={23} />
        </span>
        <p className="eyebrow">
          <span className="eyebrow-line" /> ESPACE MEMBRE
        </p>
        <h1>Impossible de vérifier ton accès</h1>
        <p className="muted">
          Ta connexion n’a pas été modifiée. Réessaie dans un instant.
        </p>
        <button type="button" className="btn secondary" onClick={retry}>
          <RefreshCw size={17} /> Réessayer
        </button>
      </section>
    );
  }

  if (access?.allowed) return <>{children}</>;

  const isSignedOut =
    !access || !access.authenticated || access.reason === "signed_out";
  const isRevoked = access?.reason === "revoked";
  const busy = authLoading;

  return (
    <section
      className="client-gate panel"
      role={isSignedOut ? undefined : "alert"}
    >
      <span className={`client-gate-icon ${isRevoked ? "is-error" : ""}`}>
        {isSignedOut ? (
          <LockKeyhole size={23} />
        ) : isRevoked ? (
          <UserRoundX size={23} />
        ) : (
          <CircleHelp size={23} />
        )}
      </span>
      <p className="eyebrow">
        <span className="eyebrow-line" /> ESPACE MEMBRE
      </p>

      {isSignedOut ? (
        <>
          <h1>Connecte-toi à ton espace</h1>
          <p className="muted">
            Utilise ton compte Manus habituel avec l’adresse courriel approuvée
            par EJ Coaching.
          </p>
          <button type="button" className="btn primary" onClick={signIn}>
            <ShieldCheck size={17} /> Se connecter
          </button>
        </>
      ) : isRevoked ? (
        <>
          <h1>Ton accès est actuellement suspendu</h1>
          <p className="muted">
            Cette adresse courriel n’a plus accès aux cours. Communique avec EJ
            Coaching si tu crois qu’il s’agit d’une erreur.
          </p>
          <GateActions
            busy={busy}
            onRetry={retry}
            onSignOut={() => void signOut()}
            onOtherAccount={() => void useAnotherAccount()}
          />
        </>
      ) : (
        <>
          <h1>Ton accès n’est pas encore approuvé</h1>
          <p className="muted">
            EJ Coaching doit approuver l’adresse courriel de ton compte Manus
            avant de te donner accès. Aucune invitation par courriel n’est
            envoyée automatiquement.
          </p>
          <GateActions
            busy={busy}
            onRetry={retry}
            onSignOut={() => void signOut()}
            onOtherAccount={() => void useAnotherAccount()}
          />
        </>
      )}

      {actionError && (
        <p className="client-gate-error" role="alert">
          <AlertCircle size={16} /> {actionError}
        </p>
      )}
    </section>
  );
}

function GateActions({
  busy,
  onRetry,
  onSignOut,
  onOtherAccount,
}: {
  busy: boolean;
  onRetry: () => void;
  onSignOut: () => void;
  onOtherAccount: () => void;
}) {
  return (
    <div className="client-gate-actions">
      <button
        type="button"
        className="btn primary"
        onClick={onOtherAccount}
        disabled={busy}
      >
        <ShieldCheck size={17} /> Utiliser un autre compte
      </button>
      <button
        type="button"
        className="btn secondary"
        onClick={onRetry}
        disabled={busy}
      >
        <RefreshCw size={17} /> Réessayer
      </button>
      <button
        type="button"
        className="client-gate-logout"
        onClick={onSignOut}
        disabled={busy}
      >
        <LogOut size={16} /> Se déconnecter
      </button>
    </div>
  );
}
