import { AiSettingsSection } from '../../settings/AiSettingsSection.tsx';
import { Link } from 'react-router-dom';
import { localOnly } from '../../mode/appMode.ts';

export default function SettingsPage() {
  return (
    <section className="nx-stack nx-auth-card">
      <h2>Settings</h2>
      {localOnly ? (
        <p className="nx-muted">
          AI settings live on the server. This build runs local-only, so there is nothing to
          configure here
        </p>
      ) : (
        <AiSettingsSection />
      )}
      <Link to="/legal/privacy">Review how your data is stored</Link>
    </section>
  );
}
