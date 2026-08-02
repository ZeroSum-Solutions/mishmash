// Quiet link-out row that replaced the Home "Workflows and Assets" gallery
// grid (docs/plans/2026-08-01-home-studio-entrance-restructure.md, phase 1).
// The full gallery still lives on the Plugins view — this row is Home's only
// remaining reference to it, so Home keeps a single calm affordance instead
// of a multi-screen card grid.

import { Button } from '@open-design/components';
import { Icon } from './Icon';
import { useT } from '../i18n';
import styles from './WorkflowsLinkRow.module.css';

interface Props {
  /** Routes to the Plugins view — the same `onBrowseRegistry` callback the
   *  gallery's "Browse registry" affordance used. */
  onBrowse: () => void;
}

export function WorkflowsLinkRow({ onBrowse }: Props) {
  const t = useT();
  return (
    <div className={styles.root}>
      <Button
        variant="ghost"
        className={styles.link ?? ''}
        data-testid="home-workflows-linkrow"
        onClick={onBrowse}
      >
        <span>{t('home.workflowsLink.label')}</span>
        <Icon name="chevron-right" size={14} />
      </Button>
    </div>
  );
}
