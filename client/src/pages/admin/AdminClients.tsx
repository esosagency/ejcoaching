import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  BookOpenCheck,
  CirclePlus,
  Clock3,
  Copy,
  KeyRound,
  LoaderCircle,
  Mail,
  Pencil,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  UserRound,
  X,
} from "lucide-react";
import { useLocation } from "wouter";
import type { Course } from "@shared/content";
import AdminGate from "@/components/AdminGate";
import { trpc } from "@/lib/trpc";
import "./Admin.css";
import "./AdminClients.css";

type ClientStatus = "active" | "revoked";
type ClientRecord = {
  id: string;
  email: string | null;
  name: string;
  status: ClientStatus;
  revision: number;
  courseIds: string[];
  createdAt: string;
  updatedAt: string;
  codeEnabled: boolean;
  codeIssuedAt: string | null;
  lastCodeLoginAt: string | null;
};
type ClientDraft = {
  email: string;
  name: string;
  courseIds: string[];
  revision?: number;
};
type StatusChange = {
  id: string;
  name: string;
  status: ClientStatus;
  revision: number;
};
type CodeAction = {
  id: string;
  name: string;
  revision: number;
  kind: "issue" | "replace" | "disable";
};
type RevealedCode = {
  clientName: string;
  code: string;
};
type StatusFilter = "all" | ClientStatus;

class ClientConflictError extends Error {
  readonly revision?: number;

  constructor(message: string, revision?: number) {
    super(message);
    this.name = "ClientConflictError";
    this.revision = revision;
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !("code" in data)) return false;
  return (data as { code?: unknown }).code === "CONFLICT";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function emptyDraft(): ClientDraft {
  return { email: "", name: "", courseIds: [] };
}

function codeState(client: ClientRecord) {
  if (client.codeEnabled) {
    return { label: "Code actif", className: "is-enabled" };
  }
  if (client.codeIssuedAt) {
    return { label: "Code désactivé", className: "is-disabled" };
  }
  return { label: "Sans code", className: "is-none" };
}

function ClientFormDialog({
  mode,
  client,
  courses,
  coursesLoading,
  coursesError,
  saving,
  onClose,
  onSave,
  onRetryCourses,
}: {
  mode: "create" | "edit";
  client: ClientRecord | null;
  courses: Course[];
  coursesLoading: boolean;
  coursesError: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: ClientDraft) => Promise<void>;
  onRetryCourses: () => void;
}) {
  const [draft, setDraft] = useState<ClientDraft>(() =>
    client
      ? {
          email: client.email ?? "",
          name: client.name,
          courseIds: client.courseIds,
          revision: client.revision,
        }
      : emptyDraft()
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(
      client
        ? {
            email: client.email ?? "",
            name: client.name,
            courseIds: client.courseIds,
            revision: client.revision,
          }
        : emptyDraft()
    );
    setError(null);
    // A background list refetch must not replace unsaved client/course choices.
  }, [client?.id, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const toggleCourse = (courseId: string) => {
    setDraft(current => ({
      ...current,
      courseIds: current.courseIds.includes(courseId)
        ? current.courseIds.filter(id => id !== courseId)
        : [...current.courseIds, courseId],
    }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError("Entre le nom du client avant de continuer.");
      return;
    }
    if (coursesLoading || coursesError) {
      setError("Les cours doivent être chargés avant d’enregistrer le client.");
      return;
    }

    setError(null);
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        // An empty contact is intentionally sent as empty and normalized to
        // null by the contract; it is not a login identity.
        email: draft.email.trim(),
      });
    } catch (caught) {
      if (
        caught instanceof ClientConflictError &&
        caught.revision !== undefined
      ) {
        setDraft(current => ({ ...current, revision: caught.revision }));
      }
      setError(
        getErrorMessage(
          caught,
          mode === "create"
            ? "Le client n’a pas pu être enregistré. Réessaie."
            : "Les modifications n’ont pas pu être enregistrées. Réessaie."
        )
      );
    }
  };

  const title = mode === "create" ? "Créer un client" : "Modifier le client";
  const submitLabel =
    mode === "create" ? "Créer le client" : "Enregistrer les modifications";
  const formId =
    mode === "create" ? "client-create" : `client-edit-${client?.id ?? ""}`;

  return (
    <div
      className="admin-modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="admin-modal panel client-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
      >
        <header className="admin-modal-header">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-line" />
              {mode === "create" ? "NOUVEAU CLIENT" : "CLIENT EJ COACHING"}
            </p>
            <h2 id={`${formId}-title`}>{title}</h2>
            <p>
              {mode === "create"
                ? "Crée le dossier, attribue les cours, puis génère un code personnel à remettre au client."
                : "Les cours attribués restent liés à ce client. Son code personnel se gère séparément."}
            </p>
          </div>
          <button
            type="button"
            className="icon-button admin-modal-close client-icon-button"
            aria-label="Fermer"
            onClick={onClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="admin-form-grid">
            <label className="admin-field is-full">
              <span>Nom du client</span>
              <input
                autoFocus
                autoComplete="name"
                value={draft.name}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Ex. Marie Tremblay"
                required
                disabled={saving}
              />
              <small>
                Le nom sert seulement à reconnaître le client dans
                l’administration.
              </small>
            </label>

            <label className="admin-field is-full">
              <span>
                Courriel de contact <em>(facultatif)</em>
              </span>
              {mode === "create" ? (
                <>
                  <input
                    type="email"
                    autoComplete="email"
                    value={draft.email}
                    onChange={event =>
                      setDraft(current => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="nom@exemple.ca"
                    disabled={saving}
                  />
                  <small>
                    Ce courriel est un contact seulement; il ne sert pas à
                    ouvrir une session et aucun message n’est envoyé
                    automatiquement.
                  </small>
                </>
              ) : (
                <p className="client-readonly-email">
                  <Mail size={16} aria-hidden="true" />
                  {client?.email || "Aucun courriel de contact"}
                </p>
              )}
            </label>

            <fieldset
              className="admin-form-fieldset is-full"
              disabled={saving || coursesLoading}
            >
              <legend className="client-course-legend">
                Cours à attribuer <span>(choix explicites)</span>
              </legend>
              <p className="client-course-help">
                Sélectionne uniquement les cours auxquels ce client doit avoir
                accès. Les brouillons restent invisibles avant leur publication.
              </p>

              {coursesLoading ? (
                <p className="client-course-load" aria-live="polite">
                  <LoaderCircle size={16} className="admin-spin-icon" />{" "}
                  Chargement des cours…
                </p>
              ) : coursesError ? (
                <div className="client-course-load is-error" role="alert">
                  <span>Impossible de charger les choix de cours.</span>
                  <button
                    type="button"
                    onClick={onRetryCourses}
                    disabled={saving}
                  >
                    Réessayer
                  </button>
                </div>
              ) : courses.length ? (
                <div className="client-course-options">
                  {courses.map(course => {
                    const fieldId = `${formId}-course-${course.id}`;
                    const isDraft = course.status !== "published";
                    return (
                      <label
                        className="client-course-choice"
                        key={course.id}
                        htmlFor={fieldId}
                      >
                        <input
                          id={fieldId}
                          type="checkbox"
                          checked={draft.courseIds.includes(course.id)}
                          onChange={() => toggleCourse(course.id)}
                        />
                        <span
                          className="client-course-check"
                          aria-hidden="true"
                        >
                          <BookOpenCheck size={16} />
                        </span>
                        <span className="client-course-choice-copy">
                          <strong>{course.title}</strong>
                          <small>
                            {course.category}
                            {isDraft ? " · Brouillon" : " · Publié"}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="client-course-load">
                  Aucun cours n’est disponible pour l’attribution présentement.
                </p>
              )}
            </fieldset>
          </div>

          {error && (
            <p className="admin-form-error" role="alert">
              <AlertCircle size={16} /> {error}
            </p>
          )}

          <footer className="admin-form-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={onClose}
              disabled={saving}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={saving || coursesLoading || coursesError}
            >
              {saving ? (
                <LoaderCircle size={17} className="admin-spin-icon" />
              ) : mode === "create" ? (
                <CirclePlus size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              {saving ? "Enregistrement…" : submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function StatusConfirmationDialog({
  change,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  change: StatusChange;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isRevoking = change.status === "revoked";
  const firstName = change.name.trim() || "ce client";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section
        className="admin-modal panel client-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-status-title"
        aria-describedby="client-status-description"
      >
        <header className="admin-modal-header">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-line" /> CONFIRMATION REQUISE
            </p>
            <h2 id="client-status-title">
              {isRevoking ? "Révoquer cet accès?" : "Réactiver cet accès?"}
            </h2>
            <p id="client-status-description">
              {isRevoking
                ? `Après confirmation, ${firstName} ne pourra plus ouvrir ses cours. Les sessions existantes seront invalidées.`
                : `Après confirmation, ${firstName} retrouvera seulement l’accès accordé à ses cours et à un code actif.`}
            </p>
          </div>
          <button
            type="button"
            className="icon-button admin-modal-close client-icon-button"
            aria-label="Fermer la confirmation"
            onClick={onClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </header>
        {isRevoking && (
          <p className="client-confirm-note">
            Les attributions de cours sont conservées, mais réactiver le client
            ne réactive pas d’anciennes sessions.
          </p>
        )}
        {error && (
          <p className="admin-form-error" role="alert">
            <AlertCircle size={16} /> {error}
          </p>
        )}
        <footer className="admin-form-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            disabled={saving}
          >
            Annuler
          </button>
          <button
            type="button"
            className={`btn ${isRevoking ? "client-danger-action" : "primary"}`}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle size={17} className="admin-spin-icon" />
            ) : isRevoking ? (
              <ShieldOff size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            {saving
              ? "Enregistrement…"
              : isRevoking
                ? "Oui, révoquer l’accès"
                : "Oui, réactiver l’accès"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function CodeConfirmationDialog({
  action,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  action: CodeAction;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const clientName = action.name.trim() || "ce client";
  const isDisable = action.kind === "disable";
  const isReplace = action.kind === "replace";
  const title = isDisable
    ? "Désactiver ce code?"
    : isReplace
      ? "Remplacer le code personnel?"
      : "Générer un code personnel?";
  const description = isDisable
    ? `Après confirmation, ${clientName} ne pourra plus ouvrir son espace avec ce code et ses sessions seront invalidées.`
    : isReplace
      ? `Le code précédent de ${clientName} cessera immédiatement de fonctionner et ses sessions seront invalidées.`
      : `Le nouveau code de ${clientName} sera affiché une seule fois après la confirmation.`;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section
        className="admin-modal panel client-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-code-action-title"
      >
        <header className="admin-modal-header">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-line" /> CODE PERSONNEL
            </p>
            <h2 id="client-code-action-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button
            type="button"
            className="icon-button admin-modal-close client-icon-button"
            aria-label="Fermer la confirmation"
            onClick={onClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </header>
        {(isReplace || isDisable) && (
          <p className="client-confirm-note">
            Cette action est immédiate. Tu ne peux pas récupérer ni revoir un
            ancien code.
          </p>
        )}
        {error && (
          <p className="admin-form-error" role="alert">
            <AlertCircle size={16} /> {error}
          </p>
        )}
        <footer className="admin-form-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={onClose}
            disabled={saving}
          >
            Annuler
          </button>
          <button
            type="button"
            className={`btn ${isDisable ? "client-danger-action" : "primary"}`}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle size={17} className="admin-spin-icon" />
            ) : isDisable ? (
              <Power size={17} />
            ) : (
              <KeyRound size={17} />
            )}
            {saving
              ? "Enregistrement…"
              : isDisable
                ? "Oui, désactiver le code"
                : isReplace
                  ? "Oui, remplacer le code"
                  : "Générer le code"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RevealedCodeDialog({
  secret,
  onClose,
}: {
  secret: RevealedCode;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copyCode = async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(secret.code);
      setCopied(true);
    } catch {
      setCopyError(
        "La copie automatique est indisponible. Sélectionne le code affiché pour le copier."
      );
    }
  };

  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section
        className="admin-modal panel client-secret-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-secret-title"
      >
        <header className="admin-modal-header">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-line" /> CODE PRÊT À REMETTRE
            </p>
            <h2 id="client-secret-title">
              Code de {secret.clientName || "ce client"}
            </h2>
            <p>
              Copie-le maintenant : il ne sera plus affiché après la fermeture.
            </p>
          </div>
          <button
            type="button"
            className="icon-button admin-modal-close client-icon-button"
            aria-label="Fermer le code"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <output
          className="client-secret-code"
          aria-label="Code personnel généré"
        >
          {secret.code}
        </output>
        <p className="client-secret-warning">
          Ne l’enregistre pas dans la liste de clients. Transmets-le de façon
          sécurisée au client concerné.
        </p>
        {copyError && (
          <p className="admin-form-error" role="alert">
            <AlertCircle size={16} /> {copyError}
          </p>
        )}
        <footer className="admin-form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Fermer
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void copyCode()}
          >
            <Copy size={17} /> {copied ? "Code copié" : "Copier le code"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AdminClientsContent() {
  const [location] = useLocation();
  const clientsQuery = trpc.clients.adminList.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const coursesQuery = trpc.content.adminList.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const approveClient = trpc.clients.approve.useMutation();
  const updateClient = trpc.clients.update.useMutation();
  const setClientStatus = trpc.clients.setStatus.useMutation();
  const issueCode = trpc.clients.issueCode.useMutation();
  const disableCode = trpc.clients.disableCode.useMutation();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<StatusChange | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pendingCodeAction, setPendingCodeAction] = useState<CodeAction | null>(
    null
  );
  const [codeActionError, setCodeActionError] = useState<string | null>(null);
  const [revealedCode, setRevealedCode] = useState<RevealedCode | null>(null);

  // The raw secret has a deliberately short lifetime: navigation immediately
  // removes it from React state, and it is never written to browser storage.
  useEffect(() => {
    setRevealedCode(null);
    setCodeActionError(null);
  }, [location]);

  const clients = (clientsQuery.data ?? []) as unknown as ClientRecord[];
  const courses = (coursesQuery.data ?? []) as Course[];
  const editingClient = clients.find(client => client.id === editingId) ?? null;

  const courseNames = useMemo(
    () => new Map(courses.map(course => [course.id, course.title])),
    [courses]
  );
  const visibleClients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("fr-CA");
    return clients.filter(client => {
      const matchesStatus =
        statusFilter === "all" || client.status === statusFilter;
      const matchesSearch =
        !term ||
        [client.name, client.email ?? ""]
          .join(" ")
          .toLocaleLowerCase("fr-CA")
          .includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [clients, search, statusFilter]);

  const activeCount = clients.filter(
    client => client.status === "active"
  ).length;
  const revokedCount = clients.length - activeCount;

  const refreshClients = async () => {
    const result = await clientsQuery.refetch();
    return (result.data ?? []) as unknown as ClientRecord[];
  };

  const revisionAfterConflict = async (clientId: string) => {
    try {
      const freshClients = await refreshClients();
      return freshClients.find(client => client.id === clientId)?.revision;
    } catch {
      return undefined;
    }
  };

  const createClient = async (draft: ClientDraft) => {
    await approveClient.mutateAsync({
      email: draft.email,
      name: draft.name,
      courseIds: draft.courseIds,
    });
    await refreshClients();
    setCreating(false);
  };

  const saveClient = async (draft: ClientDraft) => {
    if (!editingClient || draft.revision === undefined) {
      throw new Error(
        "Ce client n’est plus disponible. Ferme la fenêtre et réessaie."
      );
    }
    try {
      await updateClient.mutateAsync({
        id: editingClient.id,
        revision: draft.revision,
        name: draft.name,
        courseIds: draft.courseIds,
      });
      await refreshClients();
      setEditingId(null);
    } catch (caught) {
      if (isConflictError(caught)) {
        const revision = await revisionAfterConflict(editingClient.id);
        throw new ClientConflictError(
          "Un changement récent a été détecté. Tes modifications sont conservées dans ce formulaire; vérifie-les puis réessaie.",
          revision
        );
      }
      throw caught;
    }
  };

  const confirmStatusChange = async () => {
    if (!pendingStatus) return;
    setStatusError(null);
    try {
      await setClientStatus.mutateAsync({
        id: pendingStatus.id,
        revision: pendingStatus.revision,
        status: pendingStatus.status,
      });
      await refreshClients();
      setPendingStatus(null);
    } catch (caught) {
      if (isConflictError(caught)) {
        const revision = await revisionAfterConflict(pendingStatus.id);
        if (revision !== undefined) {
          setPendingStatus(current =>
            current && current.id === pendingStatus.id
              ? { ...current, revision }
              : current
          );
        }
        setStatusError(
          "Un changement récent a été détecté. La liste a été actualisée; confirme à nouveau l’action si elle est toujours souhaitée."
        );
        return;
      }
      setStatusError(
        getErrorMessage(
          caught,
          "Le changement d’accès n’a pas pu être enregistré. Réessaie."
        )
      );
    }
  };

  const confirmCodeAction = async () => {
    if (!pendingCodeAction) return;
    setCodeActionError(null);
    try {
      if (pendingCodeAction.kind === "disable") {
        await disableCode.mutateAsync({
          id: pendingCodeAction.id,
          revision: pendingCodeAction.revision,
        });
        await refreshClients();
        setPendingCodeAction(null);
        return;
      }

      const result = await issueCode.mutateAsync({
        id: pendingCodeAction.id,
        revision: pendingCodeAction.revision,
      });
      if (!result.code) {
        throw new Error(
          "Le code n’a pas pu être affiché. Réessaie de le générer."
        );
      }
      // Reveal before the optional list refresh: the secret must not be lost if
      // a harmless refetch fails immediately after a successful issuance.
      setRevealedCode({
        clientName: pendingCodeAction.name,
        code: result.code,
      });
      setPendingCodeAction(null);
      void refreshClients().catch(() => undefined);
    } catch (caught) {
      if (isConflictError(caught)) {
        const revision = await revisionAfterConflict(pendingCodeAction.id);
        if (revision !== undefined) {
          setPendingCodeAction(current =>
            current && current.id === pendingCodeAction.id
              ? { ...current, revision }
              : current
          );
        }
        setCodeActionError(
          "Un changement récent a été détecté. La liste a été actualisée; confirme à nouveau l’action si elle est toujours souhaitée."
        );
        return;
      }
      setCodeActionError(
        getErrorMessage(
          caught,
          "Cette action sur le code n’a pas pu être enregistrée. Réessaie."
        )
      );
    }
  };

  const startStatusChange = (client: ClientRecord) => {
    setStatusError(null);
    setPendingStatus({
      id: client.id,
      name: client.name,
      revision: client.revision,
      status: client.status === "active" ? "revoked" : "active",
    });
  };

  const startCodeAction = (client: ClientRecord, kind: CodeAction["kind"]) => {
    setCodeActionError(null);
    setPendingCodeAction({
      id: client.id,
      name: client.name,
      revision: client.revision,
      kind,
    });
  };

  return (
    <div className="admin-page admin-clients-page">
      <header className="admin-heading client-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-line" /> ADMINISTRATION
          </p>
          <h1 className="page-title">Gérer les clients</h1>
          <p className="admin-lead">
            Crée les dossiers clients, attribue les cours et génère des codes
            personnels. Les codes ne sont jamais conservés ni affichés dans
            cette liste.
          </p>
        </div>
        <div className="admin-heading-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreating(true)}
          >
            <CirclePlus size={18} /> Créer un client
          </button>
        </div>
      </header>

      <section
        className="panel clients-panel"
        aria-labelledby="client-list-title"
      >
        <div className="admin-toolbar client-toolbar">
          <div className="admin-toolbar-copy">
            <h2 id="client-list-title">Clients</h2>
            <p>
              {activeCount} actif{activeCount === 1 ? "" : "s"} · {revokedCount}{" "}
              révoqué{revokedCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="admin-filters client-filters">
            <label
              className="admin-search"
              aria-label="Rechercher parmi les clients"
            >
              <Search size={17} aria-hidden="true" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Nom ou courriel…"
              />
            </label>
            <select
              className="admin-filter-select"
              value={statusFilter}
              onChange={event =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              aria-label="Filtrer par état d’accès"
            >
              <option value="all">Tous les clients</option>
              <option value="active">Actifs</option>
              <option value="revoked">Révoqués</option>
            </select>
          </div>
        </div>

        {clientsQuery.isLoading ? (
          <div className="admin-loading" aria-live="polite">
            <LoaderCircle size={26} className="admin-spin-icon" /> Chargement
            des clients…
          </div>
        ) : clientsQuery.isError ? (
          <div className="admin-query-error" role="alert">
            <AlertCircle size={27} />
            <h2>Impossible de charger les clients</h2>
            <p>Réessaie dans un instant. Aucun client n’a été modifié.</p>
            <button
              type="button"
              className="btn secondary"
              onClick={() => void clientsQuery.refetch()}
            >
              <RefreshCw size={17} /> Réessayer
            </button>
          </div>
        ) : visibleClients.length ? (
          <div className="client-list" role="list">
            {visibleClients.map(client => {
              const isActive = client.status === "active";
              const code = codeState(client);
              const assignments = client.courseIds
                .map(
                  courseId => courseNames.get(courseId) ?? "Cours indisponible"
                )
                .join(" · ");
              const initial = (client.name.trim() || client.email || "E")
                .slice(0, 1)
                .toLocaleUpperCase("fr-CA");
              return (
                <article
                  className="client-card"
                  key={client.id}
                  role="listitem"
                >
                  <div className="client-avatar" aria-hidden="true">
                    {initial}
                  </div>
                  <div className="client-card-main">
                    <div className="client-card-topline">
                      <div>
                        <h3>{client.name.trim() || "Client sans nom"}</h3>
                        <p className="client-email">
                          <Mail size={14} aria-hidden="true" />
                          {client.email || "Aucun courriel de contact"}
                        </p>
                      </div>
                      <div className="client-card-badges">
                        <span
                          className={`client-status ${isActive ? "is-active" : "is-revoked"}`}
                        >
                          {isActive ? (
                            <BadgeCheck size={14} />
                          ) : (
                            <ShieldOff size={14} />
                          )}
                          {isActive ? "Actif" : "Révoqué"}
                        </span>
                        <span className={`client-code-state ${code.className}`}>
                          <KeyRound size={13} /> {code.label}
                        </span>
                      </div>
                    </div>
                    <div className="client-card-details">
                      <span>
                        <BookOpenCheck size={14} aria-hidden="true" />
                        {client.courseIds.length} cours attribué
                        {client.courseIds.length === 1 ? "" : "s"}
                      </span>
                      {client.codeIssuedAt && (
                        <span>
                          Code émis le {formatDate(client.codeIssuedAt)}
                        </span>
                      )}
                      {client.lastCodeLoginAt && (
                        <span>
                          <Clock3 size={14} aria-hidden="true" /> Dernière
                          entrée le {formatDate(client.lastCodeLoginAt)}
                        </span>
                      )}
                      <span>Mis à jour le {formatDate(client.updatedAt)}</span>
                    </div>
                    <p
                      className="client-assignments"
                      title={assignments || undefined}
                    >
                      {assignments || "Aucun cours attribué pour le moment."}
                    </p>
                  </div>
                  <div className="client-card-actions">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setEditingId(client.id)}
                      aria-label={`Modifier ${client.name.trim() || client.email || "ce client"}`}
                    >
                      <Pencil size={16} /> Modifier
                    </button>
                    {isActive && (
                      <button
                        type="button"
                        className="btn secondary client-code-button"
                        onClick={() =>
                          startCodeAction(
                            client,
                            client.codeEnabled ? "replace" : "issue"
                          )
                        }
                      >
                        <KeyRound size={16} />{" "}
                        {client.codeEnabled
                          ? "Remplacer le code"
                          : "Générer le code"}
                      </button>
                    )}
                    {client.codeEnabled && (
                      <button
                        type="button"
                        className="btn secondary client-disable-code-button"
                        onClick={() => startCodeAction(client, "disable")}
                      >
                        <Power size={16} /> Désactiver le code
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn ${isActive ? "client-revoke-button" : "primary"}`}
                      onClick={() => startStatusChange(client)}
                    >
                      {isActive ? (
                        <ShieldOff size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      {isActive ? "Révoquer" : "Réactiver"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="admin-empty">
            <UserRound size={28} />
            <h2>Aucun client ne correspond</h2>
            <p>
              {search || statusFilter !== "all"
                ? "Essaie une autre recherche ou enlève le filtre d’état."
                : "Aucun client n’est créé pour le moment."}
            </p>
            {search || statusFilter !== "all" ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
              >
                Effacer les filtres
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => setCreating(true)}
              >
                <CirclePlus size={17} /> Créer un client
              </button>
            )}
          </div>
        )}
      </section>

      {creating && (
        <ClientFormDialog
          mode="create"
          client={null}
          courses={courses}
          coursesLoading={coursesQuery.isLoading}
          coursesError={coursesQuery.isError}
          saving={approveClient.isPending}
          onClose={() => setCreating(false)}
          onSave={createClient}
          onRetryCourses={() => void coursesQuery.refetch()}
        />
      )}
      {editingClient && (
        <ClientFormDialog
          mode="edit"
          client={editingClient}
          courses={courses}
          coursesLoading={coursesQuery.isLoading}
          coursesError={coursesQuery.isError}
          saving={updateClient.isPending}
          onClose={() => setEditingId(null)}
          onSave={saveClient}
          onRetryCourses={() => void coursesQuery.refetch()}
        />
      )}
      {pendingStatus && (
        <StatusConfirmationDialog
          change={pendingStatus}
          saving={setClientStatus.isPending}
          error={statusError}
          onClose={() => {
            setPendingStatus(null);
            setStatusError(null);
          }}
          onConfirm={() => void confirmStatusChange()}
        />
      )}
      {pendingCodeAction && (
        <CodeConfirmationDialog
          action={pendingCodeAction}
          saving={issueCode.isPending || disableCode.isPending}
          error={codeActionError}
          onClose={() => {
            setPendingCodeAction(null);
            setCodeActionError(null);
          }}
          onConfirm={() => void confirmCodeAction()}
        />
      )}
      {revealedCode && (
        <RevealedCodeDialog
          secret={revealedCode}
          onClose={() => setRevealedCode(null)}
        />
      )}
    </div>
  );
}

export default function AdminClients() {
  return (
    <AdminGate>
      <AdminClientsContent />
    </AdminGate>
  );
}
