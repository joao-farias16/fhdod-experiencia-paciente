/** TL07 na interface: importação de escala com erros por linha e confirmação. */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  json,
  mockApi,
  renderApp,
  SECTOR_ADMIN as AS,
  signedInClient as client,
} from '../../test/helpers';

describe('TL07 — importação de escalas', () => {
  it('mostra erros por linha de um arquivo recusado e confirma um arquivo válido', async () => {
    const user = userEvent.setup();
    let uploads = 0;
    const base = { fileName: 'escala.csv', expiresAt: '2026-10-27T18:30:00Z', committedAt: null };
    const api = mockApi({
      'GET /me': () => json({ data: AS }),
      'POST /admin/rosters/import': () => {
        uploads += 1;
        return uploads === 1
          ? json(
              {
                data: {
                  ...base,
                  id: 'imp-1',
                  status: 'rejected',
                  totalRows: 2,
                  acceptedRows: 1,
                  rejectedRows: 1,
                  summary: [],
                  errors: [
                    {
                      line: 3,
                      column: 'data',
                      code: 'DATE_INVALID',
                      message: 'Use uma data válida no formato DD/MM/AAAA.',
                    },
                  ],
                },
              },
              201,
            )
          : json(
              {
                data: {
                  ...base,
                  id: 'imp-2',
                  status: 'validated',
                  totalRows: 2,
                  acceptedRows: 2,
                  rejectedRows: 0,
                  errors: [],
                  summary: [
                    {
                      sectorCode: 'PA',
                      sectorName: 'Pronto Atendimento',
                      teamCode: 'EQUIPE-A',
                      teamName: 'Equipe A',
                      shifts: 2,
                    },
                  ],
                },
              },
              201,
            );
      },
      'POST /admin/rosters/imports/imp-2/confirm': () =>
        json({
          data: {
            ...base,
            id: 'imp-2',
            status: 'committed',
            totalRows: 2,
            acceptedRows: 2,
            rejectedRows: 0,
            errors: [],
            summary: [],
            committedAt: '2026-10-27T18:05:00Z',
          },
        }),
    });
    renderApp('/admin/escalas/importar', client('token-as'));
    await screen.findByRole('heading', { name: 'Importação de escalas' });
    const file = new File(
      ['setor_codigo;equipe_codigo;data;turno;hora_inicio;hora_fim\n'],
      'escala.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByLabelText('Arquivo CSV'), file);
    await user.click(screen.getByRole('button', { name: 'Validar arquivo' }));
    expect(await screen.findByText('Arquivo recusado')).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Erros por linha' });
    expect(
      within(table).getByText('Use uma data válida no formato DD/MM/AAAA.'),
    ).toBeInTheDocument();
    expect(within(table).getByText('DATE_INVALID')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Validar arquivo' }));
    expect(await screen.findByText('Arquivo válido')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    expect(await screen.findByText('Escala importada')).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path === '/admin/rosters/import')).toHaveLength(2);
  });
});
