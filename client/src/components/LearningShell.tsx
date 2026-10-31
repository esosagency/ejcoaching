import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, BookOpen, ChevronRight, GraduationCap, LayoutDashboard, Library, Menu, Search, Sparkles, X } from 'lucide-react';

const navigation = [
  { href: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/courses', label: 'Bibliothèque de cours', icon: Library },
  { href: '/my-learning', label: 'Mon apprentissage', icon: GraduationCap },
  { href: '/resources', label: 'Ressources', icon: BookOpen },
];

export default function LearningShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }, [location]);
  useEffect(() => {
    if (!helpOpen && !mobileOpen) return;
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') { setHelpOpen(false); setMobileOpen(false); } };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [helpOpen, mobileOpen]);
  const activePage = location.startsWith('/learn') ? 'Leçon vidéo' : location.startsWith('/courses/') ? 'Aperçu du cours' : navigation.find(item => item.href === location)?.label || 'Espace d’apprentissage';
  return (
    <div className="learning-app">
      {mobileOpen && <button className="sidebar-scrim" aria-label="Fermer la navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`learning-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Navigation principale">
        <Link href="/" className="brand-lockup" aria-label="Tableau de bord EJ Coaching">
          <img src="/ej-mark.svg" alt="" width="42" height="42" />
          <span><strong>EJ COACHING</strong><small>ESPACE D’APPRENTISSAGE</small></span>
        </Link>
        <div className="sidebar-divider" />
        <p className="nav-caption">TON ESPACE</p>
        <nav className="sidebar-nav">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? location === '/' : href === '/courses' ? location.startsWith('/courses') || location.startsWith('/learn') : location === href;
            return <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><Icon size={18} strokeWidth={1.7} /><span>{label}</span>{active && <span className="nav-active-dot" />}</Link>;
          })}
        </nav>
        <div className="sidebar-encouragement">
          <span className="small-spark"><Sparkles size={19} /></span>
          <strong>Une leçon à la fois.<br />Plus de confiance.</strong>
          <p>Développe tes connaissances à ton rythme.</p>
          <Link href="/courses">Trouve ta prochaine leçon <ArrowUpRight size={15} /></Link>
        </div>
        <div className="sidebar-bottom">
          <button className="preview-help" onClick={() => setHelpOpen(true)}><span className="status-dot" /> À propos de cet aperçu <ArrowUpRight size={14} /></button>
          <p>© {new Date().getFullYear()} EJ Coaching</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="header-left">
            <button className="mobile-menu icon-button" aria-label="Ouvrir la navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={22} /></button>
            <span className="header-breadcrumb">Ton espace <ChevronRight size={13} /><strong>{activePage}</strong></span>
          </div>
          <div className="header-right">
            <Link className="header-search" href="/courses"><Search size={16} /><span>Trouver un cours</span><span className="search-shortcut">↗</span></Link>
            <span className="preview-badge">APERÇU DU DESIGN</span>
            <div className="preview-profile" title="Aperçu du côté client. Aucun compte réel n’est connecté."><span className="profile-monogram">EJ</span><span>Aperçu client<small>Espace d’apprentissage</small></span></div>
          </div>
        </header>
        <main className="page-content" id="main-content">{children}</main>
        <footer className="workspace-footer"><span>Pensé pour ton parcours.</span><span>Contenu d’exemple · Progression enregistrée dans ce navigateur</span></footer>
      </div>
      {helpOpen && <div className="preview-modal-backdrop" onClick={() => setHelpOpen(false)}><section className="preview-modal panel" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={event => event.stopPropagation()}><button autoFocus className="icon-button modal-close" aria-label="Fermer les renseignements sur l’aperçu" onClick={() => setHelpOpen(false)}><X size={21} /></button><img src="/ej-mark.svg" alt="" width="48" height="48" /><p className="eyebrow">UN PREMIER APERÇU D’EJ COACHING</p><h2 id="preview-title">Ta plateforme prend forme.</h2><p>Ceci est un prototype interactif. Les plans de cours, les durées et les visuels sont des exemples. Le lecteur utilise une démo d’interface silencieuse de 12 secondes, et non une leçon d’EJ Coaching.</p><p>Ta progression, tes leçons enregistrées et tes notes restent dans ce navigateur seulement. Les vrais comptes clients, tes vidéos et les téléversements ne sont pas encore connectés.</p><button className="btn primary" onClick={() => setHelpOpen(false)}>Explorer l’aperçu <ArrowUpRight size={16} /></button></section></div>}
    </div>
  );
}
