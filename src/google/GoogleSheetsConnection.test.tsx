import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContactRepository } from '../contacts/contactRepository'
import { GoogleSheetsConnection } from './GoogleSheetsConnection'

const savedSheetKey = 'samparka.google.sheet.v1'
const syncDestinationKey = 'samparka.google.sync-destination.v1'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Google Sheets connection panel', () => {
  it('shows a remembered destination as requiring fresh authorization after reload', async () => {
    localStorage.setItem(
      savedSheetKey,
      JSON.stringify({ id: 'sheet-1', name: 'Family', worksheet: 'Contacts' }),
    )
    const repository = {
      listChanges: vi.fn().mockResolvedValue([]),
    } as unknown as ContactRepository

    render(<GoogleSheetsConnection onClose={vi.fn()} repository={repository} />)

    expect(await screen.findByText('Reconnect required')).toBeInTheDocument()
    expect(screen.getByText('Spreadsheet:')).toBeInTheDocument()
    expect(screen.getByText('Family')).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/sheet-1/edit',
    )
    expect(screen.getByText(/Worksheet:/)).toHaveTextContent('Contacts')
    expect(
      screen.getByRole('button', { name: 'Reconnect and verify destination' }),
    ).toBeInTheDocument()
  })

  it('disconnects only after confirmation and keeps the durable destination binding', () => {
    localStorage.setItem(
      savedSheetKey,
      JSON.stringify({ id: 'sheet-1', name: 'Family', worksheet: 'Contacts' }),
    )
    localStorage.setItem(syncDestinationKey, 'sheet-1\nContacts')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const repository = {
      listChanges: vi.fn().mockResolvedValue([]),
    } as unknown as ContactRepository

    render(<GoogleSheetsConnection onClose={vi.fn()} repository={repository} />)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('does not modify the Google spreadsheet'),
    )
    expect(localStorage.getItem(savedSheetKey)).toBeNull()
    expect(localStorage.getItem(syncDestinationKey)).toBe('sheet-1\nContacts')
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Choose an existing Samparka sheet' }),
    ).toBeInTheDocument()
  })
})
