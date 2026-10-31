import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Crown,
  KeyRound,
  LoaderCircle,
} from "lucide-react";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import "./ClientGate.css";

type ClientGateProps = {
  children?: ReactNode;
};

function loginErrorMessage(error: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "Tu sembles hors ligne. Vérifie ta connexion Internet et réessaie.";
  }

  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { code?: string; httpStatus?: number } }).data
      : undefined;
  if (data?.code === "TOO_MANY_REQUESTS" || data?.httpStatus === 429) {
    return "Trop de tentatives ont été faites. Attends un moment avant de réessayer.";
  }

  return "Le code n’a pas été reconnu. Vérifie-le puis réessaie.";
}

export default function ClientGate({ children }: ClientGateProps) {
  const utils = trpc.useUtils();
  const loginMutation = trpc.clients.login.useMutation();
  const leaveClientMutation = trpc.clients.logout.useMutation();
  const [stage, setStage] = useState<"welcome" | "code">("welcome");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  if (children) return <>{children}</>;

  const resetIdentityCaches = async () => {
    utils.auth.me.setData(undefined, null);
    await Promise.all([
      utils.auth.me.reset(),
      utils.clients.me.reset(),
      utils.clients.adminList.reset(),
      utils.content.catalog.reset(),
      utils.content.adminList.reset(),
      utils.content.adminGet.reset(),
      utils.video.get.reset(),
    ]);
  };

  const enterCodeStep = () => {
    setError(null);
    setAdminError(null);
    setStage("code");
  };

  const returnToWelcome = () => {
    if (loginMutation.isPending) return;
    setCode("");
    setError(null);
    setStage("welcome");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedCode = code.trim();
    if (!submittedCode) {
      setError("Entre ton code personnel pour continuer.");
      return;
    }

    setError(null);
    setAdminError(null);
    try {
      await loginMutation.mutateAsync({ code: submittedCode });
      // The code is never retained after the request, including during reload.
      setCode("");
      await resetIdentityCaches();
      window.location.assign("/");
    } catch (caught) {
      setError(loginErrorMessage(caught));
    }
  };

  const openAdminAccess = async () => {
    setAdminError(null);
    setError(null);
    try {
      // A client cookie deliberately wins over Preview OAuth. Clear only the
      // code-client mode before entering the existing administrator OAuth flow.
      await leaveClientMutation.mutateAsync(undefined);
      await resetIdentityCaches();
      startLogin();
    } catch {
      setAdminError(
        "Impossible de préparer l’accès administrateur. Réessaie dans un instant."
      );
    }
  };

  const busy = loginMutation.isPending || leaveClientMutation.isPending;

  return (
    <main className="client-gate" aria-labelledby="client-gate-title">
      <div
        className="client-gate-halo client-gate-halo-one"
        aria-hidden="true"
      />
      <div
        className="client-gate-halo client-gate-halo-two"
        aria-hidden="true"
      />
      <section className={`client-gate-content is-${stage}`}>
        {stage === "welcome" ? (
          <div className="client-gate-welcome">
            <div className="client-gate-monogram" aria-label="EJ Coaching">
              <span>E</span>
              <span>J</span>
            </div>
            <h1 id="client-gate-title">Bienvenue chez</h1>
            <p className="client-gate-brand-name">EJ Coaching</p>
            <p className="client-gate-subtitle">
              Ton espace privé pour apprendre et progresser.
            </p>
            <button
              type="button"
              className="client-gate-entry"
              onClick={enterCodeStep}
              disabled={busy}
            >
              <Crown size={15} aria-hidden="true" />
              Entrer dans mon espace
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="client-gate-code-step">
            <button
              type="button"
              className="client-gate-back"
              onClick={returnToWelcome}
              disabled={loginMutation.isPending}
            >
              <ArrowLeft size={14} aria-hidden="true" /> Retour
            </button>
            <div className="client-gate-key-icon" aria-hidden="true">
              <KeyRound size={27} strokeWidth={1.8} />
            </div>
            <h1 id="client-gate-title">Entre ton code personnel</h1>
            <p className="client-gate-subtitle">
              Ton code t’a été remis par EJ Coaching.
            </p>
            <form className="client-gate-form" onSubmit={submit}>
              <label className="sr-only" htmlFor="client-access-code">
                Ton code personnel
              </label>
              <input
                id="client-access-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={event => setCode(event.target.value.toUpperCase())}
                placeholder="EJ-XXXX-XXXX-XXXX"
                aria-describedby={error ? "client-code-error" : undefined}
                aria-invalid={Boolean(error)}
                disabled={busy}
                autoFocus
              />
              {error && (
                <p
                  id="client-code-error"
                  className="client-gate-error"
                  role="alert"
                >
                  <AlertCircle size={16} aria-hidden="true" /> {error}
                </p>
              )}
              <button
                type="submit"
                className="client-gate-entry"
                disabled={busy}
              >
                {loginMutation.isPending ? (
                  <LoaderCircle
                    size={17}
                    className="client-gate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <KeyRound size={16} aria-hidden="true" />
                )}
                {loginMutation.isPending
                  ? "Vérification…"
                  : "Entrer dans mon espace"}
                {!loginMutation.isPending && (
                  <ArrowRight size={15} aria-hidden="true" />
                )}
              </button>
            </form>
          </div>
        )}

        <div className="client-gate-admin">
          <span>Tu gères EJ Coaching?</span>
          <button
            type="button"
            onClick={() => void openAdminAccess()}
            disabled={busy}
          >
            Accès administrateur <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
        {adminError && (
          <p className="client-gate-admin-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" /> {adminError}
          </p>
        )}
      </section>
      <p className="client-gate-footer">
        EJ Coaching © {new Date().getFullYear()}
      </p>
    </main>
  );
}
