import { Link, useParams } from 'react-router-dom';
import { legalDocument } from './documents';
import { SiteFooter } from '../welcome/SiteFooter';
import './legal.css';

export default function LegalPage() {
  const { document = '' } = useParams();
  const content = legalDocument(document);
  return (
    <div className="rvn-legal-page">
      <header className="rvn-legal-nav">
        <Link to="/welcome">Raven OSINT</Link>
        <Link to="/">Open workspace</Link>
      </header>
      <main className="rvn-legal-copy" id="legal-content" lang="ru">
        {content === undefined ? (
          <>
            <h1>Документ не найден</h1>
            <Link to="/legal/privacy">Какие данные использует Raven</Link>
          </>
        ) : (
          content.text
            .trim()
            .split(/\n\s*\n/)
            .map((block, index) => {
              if (block.startsWith('# ')) return <h1 key={index}>{block.slice(2)}</h1>;
              if (block.startsWith('## ')) return <h2 key={index}>{block.slice(3)}</h2>;
              return <p key={index}>{block.replace(/\n/g, ' ')}</p>;
            })
        )}
        {document === 'credits' ? (
          <p className="rvn-license-links">
            <a href={`${import.meta.env.BASE_URL}legal/Manrope-OFL.txt`}>Manrope · SIL OFL 1.1</a>
            <br />
            <a href={`${import.meta.env.BASE_URL}legal/JetBrainsMono-OFL.txt`}>
              JetBrains Mono · SIL OFL 1.1
            </a>
          </p>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
