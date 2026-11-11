import { describe, expect, it, vi } from 'vitest'
import {
  GoogleIntegrationError,
  SheetsApi,
  worksheetRange,
} from './googleSheets'
import { CONTACT_HEADERS } from './googleSheetsSchema'

describe('SheetsApi', () => {
  it('quotes worksheet names safely in A1 ranges', () => {
    expect(worksheetRange('Contacts', 'A1:H6')).toBe('Contacts!A1:H6')
    expect(worksheetRange('Family Contacts', 'A1:H6')).toBe(
      "'Family Contacts'!A1:H6",
    )
    expect(worksheetRange("People's Book", 'A1:H6')).toBe(
      "'People''s Book'!A1:H6",
    )
  })

  it('reads spreadsheet metadata with the user token without loading cell contents', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      Response.json({
        properties: { title: 'People' },
        sheets: [{ properties: { title: 'Contacts', sheetId: 1 } }],
      }),
    )
    const result = await new SheetsApi(fetcher).spreadsheetMetadata(
      'sheet/id',
      'in-memory-token',
    )
    expect(result).toEqual({
      title: 'People',
      worksheet: 'Contacts',
      worksheets: [{ title: 'Contacts', sheetId: 1 }],
    })
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer in-memory-token',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not silently substitute another worksheet when the saved one is missing', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      Response.json({
        properties: { title: 'People' },
        sheets: [{ properties: { title: 'Contacts', sheetId: 1 } }],
      }),
    )
    await expect(
      new SheetsApi(fetcher).spreadsheetMetadata(
        'sheet',
        'token',
        'Old worksheet',
      ),
    ).rejects.toMatchObject({
      code: 'api',
      message: expect.stringContaining('no longer exists'),
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
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
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          spreadsheetId: 'new-id',
          properties: { title: 'My new sheet' },
        }),
      ),
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
      sheets: [{ properties: { title: 'Contacts' } }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      values: [[...CONTACT_HEADERS]],
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

  it('returns a reconnectable expiry error for unauthorized API responses', async () => {
    const api = new SheetsApi(
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )
    await expect(
      api.spreadsheetMetadata('sheet', 'expired-token'),
    ).rejects.toMatchObject<Partial<GoogleIntegrationError>>({
      code: 'expired',
    })
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
    await expect(api.spreadsheetMetadata('sheet', 'token')).rejects.toThrow(
      'Google Sheets request failed (403)',
    )
    await expect(api.spreadsheetMetadata('sheet', 'token')).rejects.not.toThrow(
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
