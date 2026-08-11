// Floating generation composer — anchored to the bottom of the Assets grid so
// a user can generate an image without leaving the gallery. Wired to the
// EXISTING media-generation dispatcher (`POST /api/projects/:id/media/generate`,
// the same route `od media generate` and the chat agent's tool token both
// drive) via `generateProjectMedia` + `waitForMediaTask` in providers/registry —
// no new daemon capability. See the "Generated" classification note on
// `generateProjectMedia` for the one known fidelity gap this reuse carries.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { IMAGE_MODELS, MEDIA_ASPECTS, DEFAULT_IMAGE_MODEL } from '../../media/models';
import type { MediaAspect } from '../../types';
import styles from './LibraryComposer.module.css';

export interface LibraryComposerGenerateInput {
  prompt: string;
  model: string;
  aspect: MediaAspect;
  attachment: File | null;
}

export interface LibraryComposerProps {
  onGenerate: (input: LibraryComposerGenerateInput) => Promise<{ ok: boolean; message?: string }>;
}

type ChipMenu = 'model' | 'aspect' | null;

export function LibraryComposer({ onGenerate }: LibraryComposerProps) {
  const t = useT();
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_IMAGE_MODEL);
  const [aspect, setAspect] = useState<MediaAspect>('1:1');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [openMenu, setOpenMenu] = useState<ChipMenu>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const modelLabel = useMemo(
    () => IMAGE_MODELS.find((m) => m.id === model)?.label ?? model,
    [model],
  );

  const submit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onGenerate({ prompt: trimmed, model, aspect, attachment });
      if (result.ok) {
        setPrompt('');
        setAttachment(null);
      } else {
        setError(result.message ?? t('library.composer.error'));
      }
    } finally {
      setBusy(false);
    }
  }, [prompt, model, aspect, attachment, busy, onGenerate, t]);

  return (
    <div className={styles.wrap}>
      {error ? <p className={styles.error}>{error}</p> : null}
      <form
        className={styles.pill}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          className={`${styles.attachBtn} od-tooltip`}
          onClick={() => fileInputRef.current?.click()}
          aria-label={t('library.composer.attach')}
          data-tooltip={t('library.composer.attach')}
          data-tooltip-placement="top"
        >
          <Icon name="attach" size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenFileInput}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setAttachment(file);
            e.target.value = '';
          }}
        />
        {attachment ? (
          <span className={styles.attachmentChip}>
            {attachment.name}
            <button
              type="button"
              aria-label={t('library.composer.removeAttachment')}
              onClick={() => setAttachment(null)}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ) : null}

        <input
          className={styles.promptInput}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('library.composer.promptPlaceholder')}
          disabled={busy}
        />

        <div className={styles.chipWrap}>
          <button
            type="button"
            className={styles.chip}
            onClick={() => setOpenMenu((m) => (m === 'model' ? null : 'model'))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'model'}
          >
            {modelLabel}
            <Icon name="chevron-down" size={12} />
          </button>
          {openMenu === 'model' ? (
            <div className={styles.chipMenu} role="menu">
              {IMAGE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  className={styles.chipMenuItem}
                  data-active={m.id === model ? 'true' : 'false'}
                  onClick={() => {
                    setModel(m.id);
                    setOpenMenu(null);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.chipWrap}>
          <button
            type="button"
            className={styles.chip}
            onClick={() => setOpenMenu((m) => (m === 'aspect' ? null : 'aspect'))}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'aspect'}
          >
            {aspect}
            <Icon name="chevron-down" size={12} />
          </button>
          {openMenu === 'aspect' ? (
            <div className={styles.chipMenu} role="menu">
              {MEDIA_ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="menuitem"
                  className={styles.chipMenuItem}
                  data-active={a === aspect ? 'true' : 'false'}
                  onClick={() => {
                    setAspect(a);
                    setOpenMenu(null);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          className={styles.generateBtn}
          disabled={busy || !prompt.trim()}
          aria-busy={busy}
          onClick={(e) => {
            // Belt-and-braces alongside the form's onSubmit (Enter in the
            // prompt field): a direct click always fires the same handler
            // rather than depending on the browser/test environment's native
            // submit-button-inside-a-form behavior.
            e.preventDefault();
            void submit();
          }}
        >
          {busy ? t('library.composer.generating') : t('library.composer.generate')}
        </button>
      </form>
    </div>
  );
}
