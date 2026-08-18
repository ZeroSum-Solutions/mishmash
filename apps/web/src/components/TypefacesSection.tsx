// Typefaces gallery (/typefaces -> EntryShell view 'typefaces').
//
// Makes the webfonts already vendored under design-templates/*/fonts/
// reachable from a run that started with no template and no design system —
// see apps/daemon/src/typefaces/catalogue.ts for the index this reads and
// apps/daemon/src/typefaces/allowlist.ts for why only some families on disk
// are listed here.
//
// Every entry is described factually (weights, styles, monospace, the
// literal words in the published name, and the licence) — never ranked or
// recommended. AGENTS.md's Design authority section forbids this catalogue
// from encoding a house aesthetic.
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@open-design/components';
import type { TypefaceSummary } from '@open-design/contracts';
import { fetchTypefaces, installTypefaceIntoProject } from '../providers/typefaces';
import { listProjects } from '../state/projects';
import type { Project } from '../types';
import { useT } from '../i18n';
import styles from './TypefacesSection.module.css';

type InstallState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; dir: string; cssFile: string }
  | { status: 'error'; message: string };

function classificationLine(t: TypefaceSummary): string {
  const weights = t.classification.variableWeightRange
    ? `variable ${t.classification.variableWeightRange[0]}–${t.classification.variableWeightRange[1]}`
    : t.classification.weights.length > 0
      ? `weights ${t.classification.weights.join(', ')}`
      : 'weight unspecified';
  const styleWord = t.classification.styles.includes('italic') ? `${weights}, normal + italic` : `${weights}, normal only`;
  return styleWord;
}

function TypefaceRow({
  typeface,
  projects,
}: {
  typeface: TypefaceSummary;
  projects: Project[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? '');
  const [install, setInstall] = useState<InstallState>({ status: 'idle' });

  const onInstall = async () => {
    if (!projectId) return;
    setInstall({ status: 'busy' });
    const outcome = await installTypefaceIntoProject(typeface.id, { projectId });
    if (outcome.ok) {
      setInstall({ status: 'done', dir: outcome.result.dir, cssFile: outcome.result.cssFile });
    } else {
      setInstall({ status: 'error', message: outcome.message });
    }
  };

  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.rowHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.family}>{typeface.family}</span>
        <span className={styles.meta}>{classificationLine(typeface)}</span>
        {typeface.classification.monospace ? <span className={styles.badge}>Mono</span> : null}
        {typeface.classification.nameHints.map((hint) => (
          <span key={hint} className={styles.badge}>{hint}</span>
        ))}
        <span className={styles.license} title={typeface.license.sourceLabel}>{typeface.license.spdx}</span>
      </button>
      <div className={`${styles.body} ${expanded ? styles.bodyOpen : ''}`}>
        <div className={styles.bodyInner}>
          <p className={styles.faceCount}>{typeface.faceCount} installable @font-face rule{typeface.faceCount === 1 ? '' : 's'}.</p>
          {projects.length === 0 ? (
            <p className={styles.hint}>Open or create a project first to install this typeface into it.</p>
          ) : (
            <div className={styles.installRow}>
              <select
                className={styles.select}
                value={projectId}
                onChange={(e) => { setProjectId(e.target.value); setInstall({ status: 'idle' }); }}
                aria-label={`Project to install ${typeface.family} into`}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <Button
                variant="primary"
                onClick={onInstall}
                disabled={install.status === 'busy' || !projectId}
                data-testid={`typeface-install-${typeface.id}`}
              >
                {install.status === 'busy' ? 'Installing…' : 'Install into project'}
              </Button>
            </div>
          )}
          {install.status === 'done' ? (
            <p className={styles.success}>
              Installed to <code>{install.dir}/</code> — reference <code>{install.cssFile}</code> for the @font-face rules.
            </p>
          ) : null}
          {install.status === 'error' ? <p className={styles.error}>{install.message}</p> : null}
        </div>
      </div>
    </li>
  );
}

export function TypefacesSection() {
  const t = useT();
  const [typefaces, setTypefaces] = useState<TypefaceSummary[]>([]);
  const [scannedFamilies, setScannedFamilies] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [monospaceOnly, setMonospaceOnly] = useState(false);
  const [condensedOnly, setCondensedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchTypefaces(), listProjects()]).then(([typefaceResult, projectList]) => {
      if (cancelled) return;
      setTypefaces(typefaceResult.typefaces);
      setScannedFamilies(typefaceResult.scannedFamilies);
      setProjects(projectList);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return typefaces
      .filter((tf) => !q || tf.family.toLowerCase().includes(q))
      .filter((tf) => !monospaceOnly || tf.classification.monospace)
      .filter((tf) => !condensedOnly || tf.classification.nameHints.some((h) => h === 'Condensed' || h === 'Narrow'));
  }, [typefaces, search, monospaceOnly, condensedOnly]);

  return (
    <section className={styles.section} data-testid="typefaces-section">
      <header className={styles.header}>
        <h1 className={styles.title}>{t('typefaces.title')}</h1>
        <p className={styles.subtitle}>{t('typefaces.subtitle')}</p>
      </header>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder={t('typefaces.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('typefaces.search')}
        />
        <label className={styles.filterChip}>
          <input type="checkbox" checked={monospaceOnly} onChange={(e) => setMonospaceOnly(e.target.checked)} />
          Monospace
        </label>
        <label className={styles.filterChip}>
          <input type="checkbox" checked={condensedOnly} onChange={(e) => setCondensedOnly(e.target.checked)} />
          Condensed / narrow
        </label>
      </div>
      {loading ? (
        <p className={styles.hint}>{t('typefaces.loading')}</p>
      ) : (
        <>
          <p className={styles.count}>
            {filtered.length} of {typefaces.length} installable typefaces ({scannedFamilies} families found in the template catalogue; only license-cleared ones are listed)
          </p>
          {filtered.length === 0 ? (
            <p className={styles.hint}>{t('typefaces.empty')}</p>
          ) : (
            <ul className={styles.list}>
              {filtered.map((tf) => (
                <TypefaceRow key={tf.id} typeface={tf} projects={projects} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
