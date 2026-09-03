// MCP health — per-server connect state, on its own surface.
//
// Issue #157: when an MCP server failed to start, the only thing the user
// ever saw was a run error card, so a session whose every run succeeded
// still read as broken and no server was ever named. This panel is where
// that state belongs. The daemon measures it first-hand
// (`GET /api/mcp/health`), so what shows here is what MishMash observed —
// not what the agent CLI claimed, which is the thing that was wrong.

import { useCallback, useState } from 'react';
import { Button } from '@open-design/components';
import { fetchMcpHealth } from '../state/mcp';
import type { McpServerHealth } from '../state/mcp';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './McpHealthPanel.module.css';

const STATE_LABEL_KEY = {
  ok: 'mcpClient.health.stateOk',
  failed: 'mcpClient.health.stateFailed',
  timeout: 'mcpClient.health.stateTimeout',
  disabled: 'mcpClient.health.stateDisabled',
} as const;

/**
 * The state union is closed in contracts, but this value arrives over HTTP —
 * an older or newer daemon can send one this build has no label for. Show the
 * raw value rather than an empty chip.
 */
function stateLabel(state: McpServerHealth['state'], t: ReturnType<typeof useT>): string {
  const key = STATE_LABEL_KEY[state];
  return key ? t(key) : state;
}

export function McpHealthPanel() {
  const t = useT();
  const [servers, setServers] = useState<McpServerHealth[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    const data = await fetchMcpHealth();
    setChecking(false);
    if (!data) {
      setError(t('mcpClient.health.failed'));
      return;
    }
    setServers(data.servers);
  }, [t]);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <p className="hint">{t('mcpClient.health.hint')}</p>
        <Button onClick={() => void check()} disabled={checking}>
          {checking ? t('mcpClient.health.checking') : t('mcpClient.health.check')}
        </Button>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {servers ? (
        <ul className={styles.list}>
          {servers.map((server) => (
            <li key={server.id} className={styles.row} data-state={server.state}>
              <div className={styles.rowHead}>
                <Icon
                  name={server.state === 'ok' ? 'check' : 'alert-triangle'}
                  size={13}
                />
                <span className={styles.name}>{server.label || server.id}</span>
                <span className={styles.state}>{stateLabel(server.state, t)}</span>
                {server.state === 'ok' ? (
                  <span className="hint">
                    {t('mcpClient.health.connectMs', { ms: String(server.connectMs) })}
                  </span>
                ) : null}
                {server.state === 'timeout' ? (
                  <span className="hint">
                    {t('mcpClient.health.budgetMs', { ms: String(server.budgetMs) })}
                  </span>
                ) : null}
              </div>
              {server.reason ? <p className={styles.reason}>{server.reason}</p> : null}
              {server.remedy ? (
                <p className={styles.remedy}>
                  <strong>{t('mcpClient.health.remedyLabel')}: </strong>
                  {server.remedy}
                </p>
              ) : null}
              {server.stderrExcerpt ? (
                <details className={styles.stderr}>
                  <summary>{t('mcpClient.health.stderrLabel')}</summary>
                  <pre>{server.stderrExcerpt}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
