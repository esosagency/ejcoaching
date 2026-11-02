import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  GraduationCap,
  LayoutDashboard,
  Library,
  LockKeyhole,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { useLearning } from "@/contexts/LearningContext";
import "./LearningShell.css";

const navigation = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/courses", label: "Bibliothèque de cours", icon: Library },
  { href: "/my-learning", label: "Mon apprentissage", icon: GraduationCap },
  { href: "/resources", label: "Ressources", icon: BookOpen },
];
export default function LearningShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, loading, logout } = useAuth();
  const { persistence, syncError, syncStatus, retrySync } = useLearning();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const isAdmin = user?.role === "admin";
  const inAdmin = location.startsWith("/admin");
  const links = isAdmin
    ? [
        ...navigation,
        { href: "/admin", label: "Gestion des cours", icon: Settings2 },
        { href: "/admin/clients", label: "Gestion des clients", icon: Users },
      ]
    : navigation;
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);
  useEffect(() => {
    if (!helpOpen && !mobileOpen) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [helpOpen, mobileOpen]);
  const activePage = location.startsWith("/admin/clients")
    ? "Gestion des clients"
    : inAdmin
      ? "Gestion des cours"
      : location.startsWith("/learn")
        ? "Leçon vidéo"
        : location.startsWith("/courses/")
          ? "Aperçu du cours"
          : navigation.find(item => item.href === location)?.label ||
            "Espace d’apprentissage";
  const initials = user?.name
    ? user.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join("")
        .toUpperCase()
    : "EJ";
  const endSession = async () => {
    try {
      await logout();
    } catch {
      window.alert(
        "La déconnexion n’a pas pu être effectuée. Réessaie dans un instant."
      );
    }
  };
  return (
    <div className="learning-app">
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Fermer la navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`learning-sidebar ${mobileOpen ? "is-open" : ""}`}
        aria-label="Navigation principale"
      >
        <Link
          href="/"
          className="brand-lockup"
          aria-label="Tableau de bord EJ Coaching"
        >
          <img src="/ej-mark.svg" alt="" width="42" height="42" />
          <span>
            <strong>EJ COACHING</strong>
            <small>ESPACE D’APPRENTISSAGE</small>
          </span>
        </Link>
        <div className="sidebar-divider" />
        <p className="nav-caption">TON ESPACE</p>
        <nav className="sidebar-nav">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? location === "/"
                : href === "/admin"
                  ? inAdmin && !location.startsWith("/admin/clients")
                  : href === "/admin/clients"
                    ? location.startsWith("/admin/clients")
                    : href === "/courses"
                      ? location.startsWith("/courses") ||
                        location.startsWith("/learn")
                      : location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`nav-link ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{label}</span>
                {active && <span className="nav-active-dot" />}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-encouragement">
          <span className="small-spark">
            <Sparkles size={19} />
          </span>
          <strong>
            Une leçon à la fois.
            <br />
            Plus de confiance.
          </strong>
          <p>Développe tes connaissances à ton rythme.</p>
          <Link href="/courses">
            Trouve ta prochaine leçon <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          {!isAdmin && (
            <Link className="preview-help admin-entry-link" href="/login">
              <LockKeyhole size={13} /> Espace administrateur{" "}
              <ArrowUpRight size={14} />
            </Link>
          )}
          <button className="preview-help" onClick={() => setHelpOpen(true)}>
            <span className="status-dot" /> À propos de cet espace{" "}
            <ArrowUpRight size={14} />
          </button>
          <p>© {new Date().getFullYear()} EJ Coaching</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="header-left">
            <button
              className="mobile-menu icon-button"
              aria-label="Ouvrir la navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <Menu size={22} />
            </button>
            <span className="header-breadcrumb">
              Ton espace <ChevronRight size={13} />
              <strong>{activePage}</strong>
            </span>
          </div>
          <div className="header-right">
            <Link className="header-search" href="/courses">
              <Search size={16} />
              <span>Trouver un cours</span>
              <span className="search-shortcut">↗</span>
            </Link>
            <span className="preview-badge">
              {inAdmin ? "ESPACE GESTION" : "EJ COACHING"}
            </span>
            {user ? (
              <>
                <div
                  className="preview-profile"
                  title={
                    isAdmin
                      ? "Compte administrateur authentifié"
                      : "Compte connecté"
                  }
                >
                  <span className="profile-monogram">{initials}</span>
                  <span>
                    {user.name || "Mon compte"}
                    <small>
                      {isAdmin ? "Administrateur" : "Espace client"}
                    </small>
                  </span>
                </div>
                <button
                  className="icon-button logout-button"
                  aria-label="Se déconnecter"
                  title="Se déconnecter"
                  onClick={() => void endSession()}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button
                className="header-login"
                onClick={() => startLogin()}
                disabled={loading}
              >
                <LockKeyhole size={13} />
                {loading ? "Connexion…" : "Connexion"}
              </button>
            )}
          </div>
        </header>
        {persistence === "client-cloud" && (
          <div
            className={`learning-sync-banner is-${syncStatus}`}
            role={syncError ? "alert" : "status"}
            aria-live="polite"
          >
            <span className="status-dot" />
            <span>
              {syncError
                ? syncError
                : syncStatus === "loading"
                  ? "Chargement de ta progression synchronisée…"
                  : syncStatus === "saving"
                    ? "Enregistrement de ta progression…"
                    : "Ta progression et tes notes sont synchronisées avec ton compte."}
            </span>
            {syncError && (
              <button type="button" onClick={retrySync}>
                <RefreshCw size={13} /> Réessayer
              </button>
            )}
          </div>
        )}
        <main className="page-content" id="main-content">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Pensé pour ton parcours.</span>
          <span>
            {inAdmin
              ? "Gestion sécurisée · Contenu enregistré dans la base de données"
              : persistence === "client-cloud"
                ? "Progression et notes synchronisées avec ton compte"
                : "Progrès et notes propres à ton compte, dans ce navigateur"}
          </span>
        </footer>
      </div>
      {helpOpen && (
        <div
          className="preview-modal-backdrop"
          onClick={() => setHelpOpen(false)}
        >
          <section
            className="preview-modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button modal-close"
              aria-label="Fermer les renseignements"
              onClick={() => setHelpOpen(false)}
            >
              <X size={21} />
            </button>
            <img src="/ej-mark.svg" alt="" width="48" height="48" />
            <p className="eyebrow">TON ESPACE EJ COACHING</p>
            <h2>Apprendre, à ton rythme.</h2>
            <p>
              Les cours et les leçons sont enregistrés dans la base de données.
              L’administrateur peut les modifier et choisir quels cours publier
              dans la bibliothèque.
            </p>
            <p>
              Les contenus identifiés comme exemples utilisent encore une démo
              d’interface. Pour les clients connectés avec un code personnel,
              les notes, les leçons enregistrées et la progression sont
              synchronisées avec leur compte. La pratique d’un administrateur
              demeure locale à son navigateur.
            </p>
            <button className="btn primary" onClick={() => setHelpOpen(false)}>
              Continuer <ArrowUpRight size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
