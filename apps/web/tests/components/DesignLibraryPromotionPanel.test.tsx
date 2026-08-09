// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const uploadLibraryFile = vi.fn(async (_file: File) => {
  calls.push('ingest');
  return { ok: true, asset: { id: 'asset-1' } };
});
const createDesignLibraryPromotion = vi.fn(async (_input: unknown) => {
  calls.push('promote');
  return { ok: true, response: { deduped: false, promotion: { id: 'promotion-1' } } };
});
const fetchDesignLibraryPromotions = vi.fn(async (_status?: unknown) => ({ ok: true, response: { promotions: [] } }));

vi.mock('../../src/providers/registry', () => ({
  uploadLibraryFile: (...args: unknown[]) => uploadLibraryFile(...(args as [File])),
  createDesignLibraryPromotion: (...args: unknown[]) => createDesignLibraryPromotion(...(args as [unknown])),
  fetchDesignLibraryPromotions: (...args: unknown[]) => fetchDesignLibraryPromotions(...(args as [unknown?])),
}));

import { DesignLibraryPromotionPanel } from '../../src/components/DesignLibraryPromotionPanel';

describe('DesignLibraryPromotionPanel', () => {
  beforeEach(() => {
    calls.length = 0;
    uploadLibraryFile.mockClear();
    createDesignLibraryPromotion.mockClear();
    fetchDesignLibraryPromotions.mockClear();
  });
  afterEach(cleanup);

  it('states the bulk _inbox split and rejects directory drops without ingest', async () => {
    render(<DesignLibraryPromotionPanel inboxPath="/synthetic/library/_inbox" />);
    expect(screen.getByText(/Kits, folders, \.fig, \.zip, clones/)).toHaveTextContent('/synthetic/library/_inbox');
    const zone = screen.getByText('Drop one small image or HTML file');
    fireEvent.drop(zone, {
      dataTransfer: {
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
        files: [],
      },
    });
    expect(await screen.findByText(/nothing was uploaded/)).toBeInTheDocument();
    expect(uploadLibraryFile).not.toHaveBeenCalled();
  });

  it('rejects multi-file, oversize, fig, zip, and unsupported drops before ingest', async () => {
    render(<DesignLibraryPromotionPanel inboxPath="/synthetic/library/_inbox" />);
    const zone = screen.getByText('Drop one small image or HTML file');
    const valid = new File(['png'], 'one.png', { type: 'image/png' });
    const rejected = [
      [valid, valid],
      [new File([new Uint8Array(3_000_001)], 'large.png', { type: 'image/png' })],
      [new File(['fig'], 'kit.fig', { type: 'application/octet-stream' })],
      [new File(['zip'], 'kit.zip', { type: 'application/zip' })],
      [new File(['bin'], 'asset.bin', { type: 'application/octet-stream' })],
    ];
    for (const files of rejected) {
      fireEvent.drop(zone, { dataTransfer: { items: [], files } });
    }
    expect(uploadLibraryFile).not.toHaveBeenCalled();
  });

  it('uploads one eligible file before creating the promotion', async () => {
    render(<DesignLibraryPromotionPanel inboxPath="/synthetic/library/_inbox" />);
    const zone = screen.getByText('Drop one small image or HTML file');
    fireEvent.drop(zone, {
      dataTransfer: {
        items: [],
        files: [new File(['png'], 'one.png', { type: 'image/png' })],
      },
    });
    await waitFor(() => expect(createDesignLibraryPromotion).toHaveBeenCalledWith({
      assetId: 'asset-1',
      proposedGroup: 'app-captures',
    }));
    expect(calls).toEqual(['ingest', 'promote']);
  });
});
