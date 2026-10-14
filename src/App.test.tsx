import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@testing-library/jest-dom/vitest'
import type { Contact } from './contacts/contact'
import type { ContactRepository } from './contacts/contactRepository'

afterEach(() => cleanup())
import App from './App'

function makeRepository(initial: Contact[] = []): ContactRepository {
  let contacts = [...initial]
  return {
    list: vi.fn(async () => contacts),
    getById: vi.fn(async (id) => contacts.find((contact) => contact.id === id)),
    create: vi.fn(async (input) => { const now = Date.now(); const contact = { ...input, id: 'created-id', createdAt: now, updatedAt: now, emails: input.emails ?? [], description: input.description, tags: input.tags ?? [] } as Contact; contacts = [...contacts, contact]; return contact }),
    update: vi.fn(async (id, changes) => { const current = contacts.find((contact) => contact.id === id)!; const updated = { ...current, ...changes, updatedAt: current.updatedAt + 1 } as Contact; contacts = contacts.map((contact) => contact.id === id ? updated : contact); return updated }),
    delete: vi.fn(async (id) => { contacts = contacts.filter((contact) => contact.id !== id) }),
  }
}

const savedContact: Contact = { id: 'contact-1', name: 'Maya Rao', phoneNumbers: ['555-0100'], emails: ['maya@example.com'], description: 'Met at the studio', tags: ['friend'], createdAt: 1, updatedAt: 2 }

describe('Samparka app shell', () => {
  it('opens on Contacts with the primary navigation visible', async () => {
    render(<App repository={makeRepository()} />)

    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument()
    expect(await screen.findByText(/your circle starts here/i)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contacts' })).toHaveAttribute('aria-current', 'page')
  })

  it('navigates between Recent, Contacts, and Add views', async () => {
    const user = userEvent.setup()
    render(<App repository={makeRepository()} />)

    await user.click(screen.getByRole('button', { name: 'Recent' }))
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument()
    expect(screen.getByText(/nothing recent yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('heading', { name: 'Add contact' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /contacts/i }))
    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument()
  })

  it('offers a first-contact action from the empty Contacts state', async () => {
    const user = userEvent.setup()
    render(<App repository={makeRepository()} />)

    await user.click(screen.getByRole('button', { name: /add your first contact/i }))
    expect(screen.getByRole('heading', { name: 'Add contact' })).toBeInTheDocument()
  })

  it('creates a contact and opens its saved detail view', async () => {
    const user = userEvent.setup()
    const repository = makeRepository()
    render(<App repository={repository} />)
    await user.click(screen.getByRole('button', { name: /add your first contact/i }))
    await user.type(screen.getByLabelText(/^Name/), 'Maya Rao')
    await user.type(screen.getByLabelText('Phone number 1'), '555-0100')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByRole('heading', { name: 'Maya Rao' })).toBeInTheDocument()
    expect(repository.create).toHaveBeenCalledOnce()
  })

  it('loads, edits, and deletes an existing contact only after confirmation', async () => {
    const user = userEvent.setup()
    const repository = makeRepository([savedContact])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: /maya rao/i }))
    expect(screen.getByText('maya@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit contact' }))
    const name = screen.getByLabelText(/^Name/)
    await user.clear(name)
    await user.type(name, 'Maya Updated')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { name: 'Maya Updated' })).toBeInTheDocument()
    expect(repository.update).toHaveBeenCalledWith('contact-1', expect.objectContaining({ name: 'Maya Updated' }))
    await user.click(screen.getByRole('button', { name: 'Delete contact' }))
    expect(repository.delete).not.toHaveBeenCalled()
    vi.mocked(window.confirm).mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Delete contact' }))
    await waitFor(() => expect(repository.delete).toHaveBeenCalledWith('contact-1'))
    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument()
  })

  it('rejects a blank name and keeps the form available', async () => {
    const user = userEvent.setup()
    const repository = makeRepository()
    render(<App repository={repository} />)
    await user.click(screen.getByRole('button', { name: /add your first contact/i }))
    await user.type(screen.getByLabelText('Phone number 1'), '555-0100')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.')
    expect(repository.create).not.toHaveBeenCalled()
  })
})
