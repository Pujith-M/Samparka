import { describe, expect, it, vi } from 'vitest'
import { GoogleIntegrationError, SheetsApi } from './googleSheets'

describe('SheetsApi', () => {
  it('reads spreadsheet metadata and a worksheet preview with the user token', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          properties: { title: 'People' },
          sheets: [{ properties: { title: 'Contacts', sheetId: 1 } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          values: [
            ['ID', 'Name'],
            ['c-1', 'Ada'],
          ],
        }),
      )
    const result = await new SheetsApi(fetcher).preview(
      'sheet/id',
      'in-memory-token',
    )
    expect(result).toEqual({
      title: 'People',
      worksheets: [{ title: 'Contacts', sheetId: 1 }],
      values: [
        ['ID', 'Name'],
        ['c-1', 'Ada'],
      ],
    })
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer in-memory-token',
    })
    expect(String(fetcher.mock.calls[1][0])).toContain('Contacts!A1%3AH6')
  })

  it('appends a row with reversible JSON array cells', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}))
    await new SheetsApi(fetcher).appendRow(
      'sheet',
      'Contacts',
      {
        id: 'c-1',
        name: 'Ada',
        phoneNumbers: ['1', '2'],
        emails: ['a@example.com'],
        tags: ['friend'],
        createdAt: 1,
        updatedAt: 2,
      },
      'token',
    )
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
      values: string[][]
    }
    expect(body.values[0]).toEqual([
      'c-1',
      'Ada',
      '["1","2"]',
      '["a@example.com"]',
      '',
      '["friend"]',
      '1',
      '2',
      '',
      '1.0',
    ])
  })

  it('creates a spreadsheet and returns it as the selected file', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        spreadsheetId: 'new-id',
        properties: { title: 'My new sheet' },
      }),
    )
    const result = await new SheetsApi(fetcher).createSpreadsheet(
      'My new sheet',
      'token',
    )
    expect(result).toEqual({ id: 'new-id', name: 'My new sheet' })
    expect(String(fetcher.mock.calls[0][0])).toContain('/v4/spreadsheets?')
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      properties: { title: 'My new sheet' },
    })
  })

  it('calls the browser fetch function with its global receiver', async () => {
    const fetcher = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis)
      return Promise.resolve(
        Response.json({
          spreadsheetId: 'new-id',
          properties: { title: 'My new sheet' },
        }),
      )
    }) as unknown as typeof fetch
    await expect(
      new SheetsApi(fetcher).createSpreadsheet('My new sheet', 'token'),
    ).resolves.toEqual({ id: 'new-id', name: 'My new sheet' })
  })

  it('requires explicit consent before writing metadata columns', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}))
    const api = new SheetsApi(fetcher)
    await expect(
      api.addMetadataColumns(
        'sheet',
        'Contacts!I1:J1',
        [['Samparka ID', 'Archived']],
        'token',
        false,
      ),
    ).rejects.toThrow(/Explicit consent/)
    expect(fetcher).not.toHaveBeenCalled()
    await api.addMetadataColumns(
      'sheet',
      'Contacts!I1:J1',
      [['Samparka ID', 'Archived']],
      'token',
      true,
    )
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('returns a reconnectable expiry error for unauthorized API responses', async () => {
    const api = new SheetsApi(
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )
    await expect(api.preview('sheet', 'expired-token')).rejects.toMatchObject<
      Partial<GoogleIntegrationError>
    >({ code: 'expired' })
  })

  it('updates only the specified known row range', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}))
    await new SheetsApi(fetcher).updateRow(
      'sheet',
      'Contacts!B4:B4',
      [['Updated']],
      'token',
    )
    expect(String(fetcher.mock.calls[0][0])).toContain('Contacts!B4%3AB4')
    expect(fetcher.mock.calls[0][1]?.method).toBe('PUT')
  })

  it('surfaces API errors without exposing response bodies', async () => {
    const api = new SheetsApi(
      vi
        .fn()
        .mockResolvedValue(new Response('private details', { status: 403 })),
    )
    await expect(api.preview('sheet', 'token')).rejects.toThrow(
      'Google Sheets request failed (403)',
    )
    await expect(api.preview('sheet', 'token')).rejects.not.toThrow(
      'private details',
    )
  })

  it('shows the provider error message and HTTP status for configuration diagnosis', async () => {
    const api = new SheetsApi(
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: 'Sheets API is disabled for this project.' } },
            { status: 403 },
          ),
        ),
    )
    await expect(
      api.createSpreadsheet('Validation', 'token'),
    ).rejects.toMatchObject({
      code: 'api',
      status: 403,
      message: expect.stringContaining('Sheets API is disabled'),
    })
  })

  it('preserves a redacted browser fetch error for network diagnosis', async () => {
    const api = new SheetsApi(
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    await expect(
      api.createSpreadsheet('Validation', 'token'),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('TypeError: Failed to fetch'),
    })
  })
})
