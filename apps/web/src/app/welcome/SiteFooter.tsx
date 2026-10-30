import { Link } from 'react-router-dom';
import './site-footer.css';

export function SiteFooter() {
  return (
    <footer className="rvn-site-footer">
      <div className="rvn-footer-brand">
        <Link className="rvn-wordmark" to="/welcome">
          <img
            src={`${import.meta.env.BASE_URL}brand/raven-mark-64.png`}
            width={36}
            height={36}
            alt=""
          />
          <span>Raven OSINT</span>
        </Link>
        <p>Private research workspace</p>
        <small>© {new Date().getFullYear()} Raven OSINT</small>
      </div>
      <nav aria-label="Workspace links">
        <h2>Workspace</h2>
        <Link to="/">Open workspace</Link>
        <a href="/welcome#workflow">Workflow</a>
        <Link to="/legal/credits">Licences & materials</Link>
      </nav>
      <nav aria-label="Data links">
        <h2>Your data</h2>
        <Link to="/legal/privacy">Data & privacy</Link>
        <Link to="/legal/data-rules">Data rules</Link>
        <Link to="/legal/security">Security notice</Link>
      </nav>
      <nav aria-label="Legal links">
        <h2>Legal</h2>
        <Link to="/legal/terms">Terms of use</Link>
        <Link to="/legal/copyright">Copyright & sources</Link>
      </nav>
      <p className="rvn-footer-note">
        For a private research group · Collect only what you are permitted to use
      </p>
    </footer>
  );
}
