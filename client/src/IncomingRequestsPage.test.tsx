/* @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IncomingRequestsPage from './pages/IncomingRequestsPage';

const apiMocks = vi.hoisted(() => ({
  incomingRequests: vi.fn(),
  syncIncomingRequests: vi.fn(),
}));

vi.mock('./api', () => ({
  api: apiMocks,
}));

describe('actualización automática de solicitudes entrantes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMocks.incomingRequests.mockResolvedValue({ items: [] });
    apiMocks.syncIncomingRequests.mockResolvedValue({
      imported: 0,
      generated: 0,
      documents: 0,
      movedToTrash: 0,
      total: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('consulta el buzón IMAP al finalizar la cuenta regresiva y recarga la lista', async () => {
    render(
      <MemoryRouter>
        <IncomingRequestsPage
          currentUser={{
            id: 'user-1',
            username: 'demo',
            displayName: 'Usuario Demo',
            role: 'ADMIN',
            autoRefreshIncoming: true,
            autoAnalyzeCompleteCases: false,
          }}
          onUserChange={() => undefined}
        />
      </MemoryRouter>,
    );

    await act(async () => undefined);
    expect(apiMocks.incomingRequests).toHaveBeenCalledTimes(1);
    expect(apiMocks.syncIncomingRequests).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiMocks.syncIncomingRequests).toHaveBeenCalledTimes(1);
    expect(apiMocks.incomingRequests).toHaveBeenCalledTimes(2);
  });
});
