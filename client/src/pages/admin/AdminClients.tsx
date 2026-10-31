import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  BookOpenCheck,
  CirclePlus,
  LoaderCircle,
  Mail,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  UserRound,
  X,
} from "lucide-react";
import type { Course } from "@shared/content";
import AdminGate from "@/components/AdminGate";
import { trpc } from "@/lib/trpc";
import "./Admin.css";
import "./AdminClients.css";

type ClientStatus = "active" | "revoked";
type ClientRecord = {
  id: string;
  email: string;
  name: string;
  status: ClientStatus;
  revision: number;
  courseIds: string[];
  createdAt: string;
  updatedAt: string;
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
          email: client.email,
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
            email: client.email,
            name: client.name,
            courseIds: client.courseIds,
            revision: client.revision,
          }
        : emptyDraft()
    );
    setError(null);
    // Do not depend on the entire client record: a refetch after a conflict
    // must not replace this administrator's unsaved name/course selections.
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
    if (!draft.email.trim()) {
      setError("Entre une adresse courriel avant de continuer.");
      return;
    }
    if (coursesLoading || coursesError) {
      setError("Les cours doivent être chargés avant d’enregistrer l’accès.");
      return;
    }

    setError(null);
    try {
      await onSave({
        ...draft,
        email: draft.email.trim(),
        name: draft.name.trim(),
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
            ? "L’approbation n’a pas pu être enregistrée. Réessaie."
            : "Les modifications n’ont pas pu être enregistrées. Réessaie."
        )
      );
    }
  };

  const title =
    mode === "create" ? "Approuver une personne" : "Modifier l’accès";
  const submitLabel =
    mode === "create" ? "Approuver l’accès" : "Enregistrer les modifications";
  const formId =
    mode === "create" ? "client-approval" : `client-edit-${client?.id ?? ""}`;

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
              {mode === "create" ? "NOUVEL ACCÈS" : "ACCÈS CLIENT"}
            </p>
            <h2 id={`${formId}-title`}>{title}</h2>
            <p>
              {mode === "create"
                ? "La personne utilisera son compte Manus existant avec cette adresse courriel. Aucune invitation par courriel n’est envoyée."
                : "L’adresse courriel est liée au compte Manus de la personne et ne peut pas être modifiée ici."}
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
              <span>Adresse courriel Manus</span>
              {mode === "create" ? (
                <input
                  autoFocus
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
                  required
                  disabled={saving}
                />
              ) : (
                <p className="client-readonly-email">
                  <Mail size={16} aria-hidden="true" /> {client?.email}
                </p>
              )}
            </label>

            <label className="admin-field is-full">
              <span>Nom affiché</span>
              <input
                autoComplete="name"
                value={draft.name}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Ex. Marie Tremblay (facultatif)"
                disabled={saving}
              />
              <small>
                Ce nom aide à reconnaître la personne dans l’administration.
              </small>
            </label>

            <fieldset
              className="admin-form-fieldset is-full"
              disabled={saving || coursesLoading}
            >
              <legend className="client-course-legend">
                Cours à attribuer <span>(choix explicites)</span>
              </legend>
              <p className="client-course-help">
                Sélectionne uniquement les cours auxquels cette personne doit
                avoir accès. Les brouillons peuvent être attribués pour une
                sortie future, mais restent invisibles avant leur publication.
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
  const firstName = change.name.trim() || "cette personne";

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
                ? `Après confirmation, ${firstName} ne pourra plus ouvrir ses cours avec son compte Manus.`
                : `Après confirmation, ${firstName} retrouvera l’accès à ses cours déjà attribués.`}
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
            Les attributions de cours sont conservées au cas où l’accès est
            réactivé plus tard.
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

function AdminClientsContent() {
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

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<StatusChange | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const clients = (clientsQuery.data ?? []) as ClientRecord[];
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
        [client.name, client.email]
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
    return (result.data ?? []) as ClientRecord[];
  };

  const revisionAfterConflict = async (clientId: string) => {
    try {
      const freshClients = await refreshClients();
      return freshClients.find(client => client.id === clientId)?.revision;
    } catch {
      // The conflict feedback is still useful even if the refresh temporarily fails.
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

  const startStatusChange = (client: ClientRecord) => {
    setStatusError(null);
    setPendingStatus({
      id: client.id,
      name: client.name,
      revision: client.revision,
      status: client.status === "active" ? "revoked" : "active",
    });
  };

  return (
    <div className="admin-page admin-clients-page">
      <header className="admin-heading client-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-line" /> ADMINISTRATION
          </p>
          <h1 className="page-title">Gérer les accès clients</h1>
          <p className="admin-lead">
            Approuve les comptes Manus et attribue les cours un à un. Aucune
            invitation par courriel n’est envoyée : la personne se connecte avec
            son compte existant et l’adresse approuvée.
          </p>
        </div>
        <div className="admin-heading-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreating(true)}
          >
            <CirclePlus size={18} /> Approuver une personne
          </button>
        </div>
      </header>

      <section
        className="panel clients-panel"
        aria-labelledby="client-list-title"
      >
        <div className="admin-toolbar client-toolbar">
          <div className="admin-toolbar-copy">
            <h2 id="client-list-title">Accès approuvés</h2>
            <p>
              {activeCount} actif{activeCount === 1 ? "" : "s"} · {revokedCount}{" "}
              révoqué
              {revokedCount === 1 ? "" : "s"}
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
              <option value="all">Tous les accès</option>
              <option value="active">Actifs</option>
              <option value="revoked">Révoqués</option>
            </select>
          </div>
        </div>

        {clientsQuery.isLoading ? (
          <div className="admin-loading" aria-live="polite">
            <LoaderCircle size={26} className="admin-spin-icon" /> Chargement
            des accès…
          </div>
        ) : clientsQuery.isError ? (
          <div className="admin-query-error" role="alert">
            <AlertCircle size={27} />
            <h2>Impossible de charger les accès</h2>
            <p>Réessaie dans un instant. Aucun accès n’a été modifié.</p>
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
              const assignments = client.courseIds
                .map(
                  courseId => courseNames.get(courseId) ?? "Cours indisponible"
                )
                .join(" · ");
              return (
                <article
                  className="client-card"
                  key={client.id}
                  role="listitem"
                >
                  <div className="client-avatar" aria-hidden="true">
                    {(client.name.trim() || client.email)
                      .slice(0, 1)
                      .toLocaleUpperCase("fr-CA")}
                  </div>
                  <div className="client-card-main">
                    <div className="client-card-topline">
                      <div>
                        <h3>{client.name.trim() || "Nom non indiqué"}</h3>
                        <p className="client-email">
                          <Mail size={14} aria-hidden="true" /> {client.email}
                        </p>
                      </div>
                      <span
                        className={`client-status ${isActive ? "is-active" : "is-revoked"}`}
                      >
                        {isActive ? (
                          <BadgeCheck size={14} />
                        ) : (
                          <ShieldOff size={14} />
                        )}
                        {isActive ? "Approuvé" : "Révoqué"}
                      </span>
                    </div>
                    <div className="client-card-details">
                      <span>
                        <BookOpenCheck size={14} aria-hidden="true" />
                        {client.courseIds.length} cours attribué
                        {client.courseIds.length === 1 ? "" : "s"}
                      </span>
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
                      aria-label={`Modifier l’accès de ${client.name.trim() || client.email}`}
                    >
                      <Pencil size={16} /> Modifier
                    </button>
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
            <h2>Aucun accès ne correspond</h2>
            <p>
              {search || statusFilter !== "all"
                ? "Essaie une autre recherche ou enlève le filtre d’état."
                : "Aucune personne n’est approuvée pour le moment."}
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
                <CirclePlus size={17} /> Approuver une personne
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
          onClose={() => setPendingStatus(null)}
          onConfirm={() => void confirmStatusChange()}
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
