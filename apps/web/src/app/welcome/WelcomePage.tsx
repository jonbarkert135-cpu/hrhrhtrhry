import {
  ArrowRightIcon,
  FileTextIcon,
  LockClosedIcon,
  Share1Icon,
  ClockIcon,
} from '@radix-ui/react-icons';
import { Link } from 'react-router-dom';
import { capabilities } from '../../mode/appMode';
import { MetallicLink } from './MetallicLink';
import './welcome.css';

export default function WelcomePage() {
  const local = !capabilities.auth;
  return (
    <main className="rvn-welcome" id="top">
      <a className="nx-skip-link" href="#welcome-content">
        Skip to content
      </a>
      <header className="rvn-welcome-nav">
        <Link className="rvn-wordmark" to="/welcome" aria-label="Raven home">
          <img
            src={`${import.meta.env.BASE_URL}brand/raven-mark-64.png`}
            width={32}
            height={32}
            alt=""
          />
          <span>
            Raven<span className="rvn-wordmark-sub">OSINT</span>
          </span>
        </Link>
        <nav aria-label="Welcome navigation">
          <a href="#workflow">Workflow</a>
          <a href="#principles">Principles</a>
        </nav>
        <Link className="rvn-nav-workspace" to="/">
          Dashboard <ArrowRightIcon aria-hidden="true" />
        </Link>
      </header>
      <section className="rvn-hero" id="welcome-content" aria-labelledby="welcome-title">
        <div className="rvn-hero-copy">
          <p className="rvn-kicker">Research, with perspective</p>
          <h1 id="welcome-title">Raven OSINT.</h1>
          <p className="rvn-hero-description">
            Turn scattered sources into a clear investigation. A private workspace for the
            connections that matter.
          </p>
          <div className="rvn-hero-actions">
            <MetallicLink />
            <a className="rvn-text-link" href="#workflow">
              Explore the workflow <ArrowRightIcon aria-hidden="true" />
            </a>
          </div>
          <p className="rvn-hero-assurance">
            <LockClosedIcon aria-hidden="true" />
            {local
              ? 'Starts on your device. No account required.'
              : 'Organization workspace. Sign in to continue.'}
          </p>
        </div>
        <div className="rvn-hero-art" aria-hidden="true">
          <img
            src={`${import.meta.env.BASE_URL}brand/raven-silver-hero.webp`}
            width={768}
            height={768}
            alt=""
            fetchPriority="high"
          />
        </div>
      </section>
      <section className="rvn-workflow" id="workflow" aria-labelledby="workflow-title">
        <header>
          <p className="rvn-kicker">A deliberate workflow</p>
          <h2 id="workflow-title">
            Find the thread.
            <br />
            <span>Keep the context.</span>
          </h2>
          <p>One canvas for the material you collect and the conclusions you choose to make.</p>
        </header>
        <ol className="rvn-workflow-steps">
          <li>
            <FileTextIcon aria-hidden="true" />
            <div>
              <h3>Collect the context</h3>
              <p>
                Bring links, notes and files into the same investigation. Give each fragment a
                place.
              </p>
            </div>
          </li>
          <li>
            <Share1Icon aria-hidden="true" />
            <div>
              <h3>Connect with intent</h3>
              <p>
                Arrange people and sources on your canvas. Review proposed changes before applying
                them.
              </p>
            </div>
          </li>
          <li>
            <ClockIcon aria-hidden="true" />
            <div>
              <h3>Keep a trail</h3>
              <p>
                Inspect provenance, revisit board versions and export your work when you need to
                share it.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section className="rvn-product" aria-label="Raven workspace preview">
        <div className="rvn-product-caption">
          <span>Inside the workspace</span>
          <span>Illustrative data</span>
        </div>
        <img
          src={`${import.meta.env.BASE_URL}brand/raven-workspace-preview.png`}
          width={1440}
          height={900}
          loading="lazy"
          alt="Raven canvas showing a fictional person, analyst notes and their connections."
        />
      </section>
      <section className="rvn-principles" id="principles" aria-labelledby="principles-title">
        <h2 id="principles-title">
          Your work.
          <br />
          <span>Your judgement.</span>
        </h2>
        <dl>
          <div>
            <dt>Local first</dt>
            <dd>
              The default workspace runs on your device, with no account or external service
              required.
            </dd>
          </div>
          <div>
            <dt>Human decisions</dt>
            <dd>
              A suggestion is a starting point. You choose which changes become part of your
              investigation.
            </dd>
          </div>
          <div>
            <dt>Traceable context</dt>
            <dd>
              Keep sources alongside your work and preserve conflicting claims instead of silently
              merging identities.
            </dd>
          </div>
        </dl>
      </section>
      <footer className="rvn-welcome-footer">
        <span>Raven OSINT</span>
        <span>A workspace for deliberate research.</span>
        <a href="#top">
          Back to top <ArrowRightIcon aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
}
