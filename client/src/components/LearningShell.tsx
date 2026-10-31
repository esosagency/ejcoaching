import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, BookOpen, ChevronRight, GraduationCap, LayoutDashboard, Library, Menu, Search, Sparkles, X } from 'lucide-react';

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/courses', label: 'Course library', icon: Library },
  { href: '/my-learning', label: 'My learning', icon: GraduationCap },
  { href: '/resources', label: 'Resources', icon: BookOpen },
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
  const activePage = location.startsWith('/learn') ? 'Video lesson' : location.startsWith('/courses/') ? 'Course overview' : navigation.find(item => item.href === location)?.label || 'Learning hub';
  return (
    <div className="learning-app">
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`learning-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <Link href="/" className="brand-lockup" aria-label="EJ Coaching overview">
          <img src="/ej-mark.svg" alt="" width="42" height="42" />
          <span><strong>EJ COACHING</strong><small>THE LEARNING HUB</small></span>
        </Link>
        <div className="sidebar-divider" />
        <p className="nav-caption">YOUR WORKSPACE</p>
        <nav className="sidebar-nav">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? location === '/' : href === '/courses' ? location.startsWith('/courses') || location.startsWith('/learn') : location === href;
            return <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><Icon size={18} strokeWidth={1.7} /><span>{label}</span>{active && <span className="nav-active-dot" />}</Link>;
          })}
        </nav>
        <div className="sidebar-encouragement">
          <span className="small-spark"><Sparkles size={19} /></span>
          <strong>Small lessons.<br />Lasting confidence.</strong>
          <p>Build your knowledge at your own pace.</p>
          <Link href="/courses">Find your next lesson <ArrowUpRight size={15} /></Link>
        </div>
        <div className="sidebar-bottom">
          <button className="preview-help" onClick={() => setHelpOpen(true)}><span className="status-dot" /> About this preview <ArrowUpRight size={14} /></button>
          <p>© {new Date().getFullYear()} EJ Coaching</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="header-left">
            <button className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={22} /></button>
            <span className="header-breadcrumb">Your workspace <ChevronRight size={13} /><strong>{activePage}</strong></span>
          </div>
          <div className="header-right">
            <Link className="header-search" href="/courses"><Search size={16} /><span>Find a course</span><span className="search-shortcut">↗</span></Link>
            <span className="preview-badge">DESIGN PREVIEW</span>
            <div className="preview-profile" title="Sample client view. No real account is connected."><span className="profile-monogram">EJ</span><span>Client preview<small>Learning workspace</small></span></div>
          </div>
        </header>
        <main className="page-content" id="main-content">{children}</main>
        <footer className="workspace-footer"><span>Built around your journey.</span><span>Sample content · Browser-only demo progress</span></footer>
      </div>
      {helpOpen && <div className="preview-modal-backdrop" onClick={() => setHelpOpen(false)}><section className="preview-modal panel" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={event => event.stopPropagation()}><button autoFocus className="icon-button modal-close" aria-label="Close preview information" onClick={() => setHelpOpen(false)}><X size={21} /></button><img src="/ej-mark.svg" alt="" width="48" height="48" /><p className="eyebrow">A FIRST LOOK AT EJ COACHING</p><h2 id="preview-title">Your platform, taking shape.</h2><p>This is a clickable design prototype. Course outlines, durations, and artwork are samples. The video player uses a 12-second silent interface demo—not an EJ Coaching lesson.</p><p>Completion, bookmarks, and notes are saved only in this browser. Real client accounts, creator videos, and uploads are not connected yet.</p><button className="btn primary" onClick={() => setHelpOpen(false)}>Explore the preview <ArrowUpRight size={16} /></button></section></div>}
    </div>
  );
}
