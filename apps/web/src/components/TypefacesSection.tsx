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
import type { TypefaceDetail, TypefaceFace, TypefaceSummary } from '@open-design/contracts';
import { fetchTypeface, fetchTypefaces, installTypefaceIntoProject, typefaceFaceUrl } from '../providers/typefaces';
import { listProjects } from '../state/projects';
import type { Project } from '../types';
import { useT } from '../i18n';
import { useInView } from './plugins-home/useInView';
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

// ---- Specimen rendering (F008 R1-R8) ---------------------------------------
//
// See plan F008.md section B.4 for the full design rationale (alias-based
// load tracking, why R2's full-coverage promise stays with the unmodified
// install flow, why the grid specimen unmounts while a row is expanded).
const VARIABLE_WEIGHT_RE = /^\d{1,4}\s+\d{1,4}$/;
const SPECIMEN_ALIAS_PREFIX = 'od-specimen-';

type FaceLoadStatus = 'idle' | 'loading' | 'loaded' | 'unavailable';

function isLatinFace(face: TypefaceFace): boolean {
  return (face.unicodeRange ?? '').trim().toUpperCase().startsWith('U+0000-00FF');
}

/**
 * Among same-weight/style candidates, the Latin-covering subset (present for
 * most families) or -- for an unbounded family like InterVariable/
 * InterDisplay, which ship one file per weight with no unicode-range at all
 * -- the one face that carries no unicodeRange. Never `faces[0]`: raw array
 * order is not script-aware (F008 audit correction).
 */
function pickSpecimenFace(candidates: TypefaceFace[]): TypefaceFace | undefined {
  return candidates.find(isLatinFace) ?? candidates.find((f) => !f.unicodeRange);
}

function facesForWeight(faces: TypefaceFace[], weight: string): TypefaceFace[] {
  const isVariable = VARIABLE_WEIGHT_RE.test(weight);
  return faces.filter(
    (f) => f.style === 'normal' && (isVariable ? VARIABLE_WEIGHT_RE.test(f.weight.trim()) : f.weight.trim() === weight),
  );
}

function specimenAlias(typefaceId: string, weight: string): string {
  return `${SPECIMEN_ALIAS_PREFIX}${typefaceId}-${weight.replace(/\s+/g, '_')}`;
}

/**
 * Loads exactly one @font-face for one (family, weight) pair under a unique
 * alias and reports whether it actually decoded. `active` gates the
 * fetch/registration behind viewport visibility (grid) or the row's expanded
 * state (detail). `face`/`faceUrl` must be memoized by the caller against
 * stable inputs so this effect does not refire on every render (R7: at most
 * one face request per activation).
 */
function useFaceLoad(
  alias: string,
  face: TypefaceFace | undefined,
  faceUrl: string | undefined,
  weight: string,
  active: boolean,
): FaceLoadStatus {
  const [status, setStatus] = useState<FaceLoadStatus>('idle');

  useEffect(() => {
    if (!active || !face || !faceUrl) return;
    if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const fontFace = new FontFace(alias, `url("${faceUrl}") format("woff2")`, {
      weight,
      style: 'normal',
      display: 'swap',
    });
    document.fonts.add(fontFace);
    fontFace
      .load()
      .then(() => {
        if (!cancelled) setStatus('loaded');
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable');
        document.fonts.delete(fontFace);
      });
    return () => {
      cancelled = true;
      document.fonts.delete(fontFace);
    };
  }, [active, face, faceUrl, alias, weight]);

  return status;
}

/**
 * One weight's specimen line: the shared comparison phrase, rendered in that
 * weight's own face, or an explicit unavailable marker (R6/R9) — never
 * unstyled text pretending to be styled, and never a face that silently fell
 * back to a same-named system font.
 */
function WeightSpecimen({
  typefaceId,
  weight,
  faces,
  phrase,
  active,
  variant,
}: {
  typefaceId: string;
  weight: string;
  faces: TypefaceFace[];
  phrase: string;
  active: boolean;
  variant: 'grid' | 'detail';
}) {
  const t = useT();
  const face = useMemo(() => pickSpecimenFace(facesForWeight(faces, weight)), [faces, weight]);
  const faceUrl = useMemo(() => (face ? typefaceFaceUrl(typefaceId, face.file) : undefined), [face, typefaceId]);
  const alias = useMemo(() => specimenAlias(typefaceId, weight), [typefaceId, weight]);
  const status = useFaceLoad(alias, face, faceUrl, weight, active);
  const label = VARIABLE_WEIGHT_RE.test(weight) ? `variable ${weight.replace(/\s+/g, '–')}` : weight;
  const testIdBase = `typeface-specimen-${typefaceId}-${weight.replace(/\s+/g, '_')}`;

  if (!face || status === 'unavailable') {
    return (
      <p className={styles.specimenUnavailable} data-testid={`${testIdBase}-unavailable`} role="status">
        <span className={styles.specimenWeightLabel}>{label}</span> {t('typefaces.specimenUnavailable')}
      </p>
    );
  }

  return (
    <p
      className={variant === 'grid' ? styles.specimenLine : styles.specimenDetailLine}
      aria-busy={status === 'loading'}
      data-testid={testIdBase}
      style={status === 'loaded' ? { fontFamily: `'${alias}'` } : undefined}
    >
      <span className={styles.specimenWeightLabel}>{label}</span> {status === 'loaded' ? phrase : ''}
    </p>
  );
}

function defaultWeight(classification: TypefaceSummary['classification']): string | undefined {
  if (classification.weights.length > 0) return String(classification.weights[0]);
  if (classification.variableWeightRange) {
    return `${classification.variableWeightRange[0]} ${classification.variableWeightRange[1]}`;
  }
  return undefined;
}

function allWeights(classification: TypefaceSummary['classification']): string[] {
  if (classification.weights.length > 0) return classification.weights.map(String);
  if (classification.variableWeightRange) {
    return [`${classification.variableWeightRange[0]} ${classification.variableWeightRange[1]}`];
  }
  return [];
}

function TypefaceRow({
  typeface,
  projects,
}: {
  typeface: TypefaceSummary;
  projects: Project[];
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? '');
  const [install, setInstall] = useState<InstallState>({ status: 'idle' });
  const { ref: specimenRef, inView } = useInView<HTMLDivElement>({ rootMargin: '240px' });
  const [detail, setDetail] = useState<TypefaceDetail | null>(null);

  useEffect(() => {
    if (!inView || detail) return;
    let cancelled = false;
    fetchTypeface(typeface.id).then((result) => {
      if (!cancelled && result) setDetail(result);
    });
    return () => {
      cancelled = true;
    };
  }, [inView, detail, typeface.id]);

  const phrase = t('typefaces.specimenPhrase');
  const gridWeight = defaultWeight(typeface.classification);
  const detailWeights = useMemo(() => allWeights(typeface.classification), [typeface.classification]);

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
    <li className={styles.row} data-testid={`typeface-row-${typeface.id}`}>
      <div ref={specimenRef} className={styles.specimen}>
        {gridWeight && !expanded ? (
          <WeightSpecimen
            typefaceId={typeface.id}
            weight={gridWeight}
            faces={detail?.faces ?? []}
            phrase={phrase}
            active={inView && detail != null}
            variant="grid"
          />
        ) : null}
      </div>
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
          {expanded && detail ? (
            <div className={styles.specimenDetail}>
              {detailWeights.map((weight) => (
                <WeightSpecimen
                  key={weight}
                  typefaceId={typeface.id}
                  weight={weight}
                  faces={detail.faces}
                  phrase={phrase}
                  active
                  variant="detail"
                />
              ))}
            </div>
          ) : null}
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
