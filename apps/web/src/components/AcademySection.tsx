import { useEffect, useRef, useState } from 'react';
import { assetBaseDirFor, inlineRelativeAssets } from './file-viewer-preview-assets';
import { projectRawUrl } from '../providers/registry';
import { buildSrcdoc, PREVIEW_NAVIGATE_MESSAGE } from '../runtime/srcdoc';
import styles from './AcademySection.module.css';

const ACADEMY_PROJECT_ID = 'mishmash-academy';
const ACADEMY_ENTRY_FILE = 'index.html';

type AcademyDocumentState =
  | { kind: 'loading' }
  | { kind: 'ready'; srcDoc: string }
  | { kind: 'unavailable' };

interface Props {
  title: string;
  loadingLabel: string;
  unavailableLabel: string;
}

function safeAcademyPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.split(/[?#]/u, 1)[0]?.trim() ?? '';
  if (!path || path.startsWith('/') || !path.toLowerCase().endsWith('.html')) return null;
  try {
    const segments = path.split('/').map((segment) => decodeURIComponent(segment));
    if (
      segments.some(
        (segment) =>
          !segment
          || segment === '.'
          || segment === '..'
          || segment.includes('/')
          || segment.includes('\\'),
      )
    ) {
      return null;
    }
    return segments.join('/');
  } catch {
    return null;
  }
}

export function AcademySection({ title, loadingLabel, unavailableLabel }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [navigation, setNavigation] = useState({ filePath: ACADEMY_ENTRY_FILE, requestId: 0 });
  const [documentState, setDocumentState] = useState<AcademyDocumentState>({ kind: 'loading' });
  const { filePath } = navigation;

  useEffect(() => {
    const controller = new AbortController();
    setDocumentState((current) => current.kind === 'ready' ? current : { kind: 'loading' });
    const load = async () => {
      try {
        const response = await fetch(projectRawUrl(ACADEMY_PROJECT_ID, filePath), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          setDocumentState((current) => current.kind === 'ready' ? current : { kind: 'unavailable' });
          return;
        }
        const source = await response.text();
        const inlined = await inlineRelativeAssets(
          source,
          ACADEMY_PROJECT_ID,
          filePath,
          null,
          {
            fetch: globalThis.fetch.bind(globalThis),
            rawUrl: projectRawUrl,
          },
        );
        if (controller.signal.aborted) return;
        setDocumentState({
          kind: 'ready',
          srcDoc: buildSrcdoc(inlined, {
            baseHref: projectRawUrl(ACADEMY_PROJECT_ID, assetBaseDirFor(filePath)),
            previewNavigationRootHref: projectRawUrl(ACADEMY_PROJECT_ID, ''),
            previewFocusGuard: true,
          }),
        });
      } catch {
        if (!controller.signal.aborted) {
          setDocumentState((current) => current.kind === 'ready' ? current : { kind: 'unavailable' });
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [filePath, navigation.requestId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== PREVIEW_NAVIGATE_MESSAGE) return;
      const nextPath = safeAcademyPath(event.data.path);
      if (nextPath) {
        setNavigation((current) => ({
          filePath: nextPath,
          requestId: current.requestId + 1,
        }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <section className={styles.root} aria-label={title}>
      {documentState.kind === 'ready' ? (
        <iframe
          ref={frameRef}
          className={styles.frame}
          data-testid="academy-frame"
          title={title}
          sandbox="allow-scripts"
          srcDoc={documentState.srcDoc}
        />
      ) : (
        <div className={styles.status} role="status">
          {documentState.kind === 'loading' ? loadingLabel : unavailableLabel}
        </div>
      )}
    </section>
  );
}
