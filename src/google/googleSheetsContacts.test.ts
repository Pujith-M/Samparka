import { describe, expect, it, vi } from 'vitest'
import { SheetsApi } from './googleSheets'
import { GoogleSheetsContactAdapter } from './googleSheetsContacts'
import { CONTACT_HEADERS, contactToRow } from './googleSheetsSchema'

const contact = {
  id: 'contact-1',
  name: 'Maya Rao',
  phoneNumbers: ['+91 98765 43210'],
  emails: [],
  tags: [],
  createdAt: 10,
  updatedAt: 20,
}
const location = { spreadsheetId: 'sheet/id', worksheet: 'Contacts' }
const headersWithoutArchive = CONTACT_HEADERS.filter(
  (header) => header !== 'archivedAt',
)

describe('Google Sheets contact adapter', () => {
  it('asks for explicit consent before changing an existing worksheet', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      Response.json({
        values: [
          headersWithoutArchive,
          contactToRow(contact, headersWithoutArchive),
        ],
      }),
    )
    const adapter = new GoogleSheetsContactAdapter(new SheetsApi(fetcher))

    await expect(
      adapter.addArchiveMetadataColumn(location, 'token', false),
    ).rejects.toMatchObject({ code: 'consent' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('adds the missing archive column before schemaVersion after consent', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          values: [
            headersWithoutArchive,
            contactToRow(contact, headersWithoutArchive),
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          sheets: [{ properties: { title: 'Contacts', sheetId: 12 } }],
        }),
      )
      .mockResolvedValueOnce(Response.json({}))
    const adapter = new GoogleSheetsContactAdapter(new SheetsApi(fetcher))

    await expect(
      adapter.addArchiveMetadataColumn(location, 'token', true),
    ).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledTimes(3)
    const request = JSON.parse(String(fetcher.mock.calls[2][1]?.body)) as {
      requests: Array<{ insertDimension?: { range: { startIndex: number } } }>
    }
    expect(request.requests[0].insertDimension?.range.startIndex).toBe(
      headersWithoutArchive.indexOf('schemaVersion'),
    )
  })

  it('does not add a duplicate archive column when it already exists', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ values: [CONTACT_HEADERS, contactToRow(contact)] }),
      )
    const adapter = new GoogleSheetsContactAdapter(new SheetsApi(fetcher))

    await expect(
      adapter.addArchiveMetadataColumn(location, 'token', true),
    ).resolves.toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
