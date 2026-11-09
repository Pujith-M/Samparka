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

describe('Google Sheets contact adapter', () => {
  it.each(['id', 'archivedAt'])(
    'does not mutate a worksheet without the required %s header',
    async (missingHeader) => {
      const headers = CONTACT_HEADERS.filter(
        (header) => header !== missingHeader,
      )
      const fetcher = vi.fn().mockResolvedValueOnce(
        Response.json({
          values: [headers, contactToRow(contact, headers)],
        }),
      )
      const adapter = new GoogleSheetsContactAdapter(new SheetsApi(fetcher))

      await expect(
        adapter.archive(location, contact.id, 'token'),
      ).rejects.toThrow(`Missing required header: “${missingHeader}”.`)
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )

  it('reads and archives rows using the current Samparka schema', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ values: [CONTACT_HEADERS, contactToRow(contact)] }),
      )
      .mockResolvedValueOnce(
        Response.json({ values: [CONTACT_HEADERS, contactToRow(contact)] }),
      )
      .mockResolvedValueOnce(Response.json({}))
    const adapter = new GoogleSheetsContactAdapter(new SheetsApi(fetcher))

    await expect(adapter.list(location, 'token')).resolves.toEqual([contact])
    await adapter.archive(location, contact.id, 'token')

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(String(fetcher.mock.calls[2][0])).toContain(
      '/values/Contacts!I2?valueInputOption=RAW',
    )
  })
})
