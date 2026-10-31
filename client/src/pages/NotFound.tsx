import { Link } from 'wouter';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { useEffect } from 'react';

export default function NotFound() {
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    if (window.location.pathname.replace(/\/$/, '') !== '/404') window.location.replace('/404');
    return () => robots.remove();
  }, []);
  return <section className="panel" style={{ padding: '60px 30px', textAlign: 'center', maxWidth: 650, margin: '60px auto' }}><span className="icon-chip" style={{ margin: '0 auto 20px' }}><BookOpen size={22} /></span><p className="eyebrow" style={{ justifyContent: 'center' }}>404 · PAGE NOT FOUND</p><h1 className="page-title" style={{ margin: '15px 0' }}>Let’s find your next lesson.</h1><p className="muted" style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 25 }}>This page or lesson isn’t part of the preview.<br />Your course library is a good place to continue.</p><Link href="/courses" className="btn primary"><ArrowLeft size={16} /> Back to course library</Link></section>;
}
