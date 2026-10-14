import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import '@testing-library/jest-dom/vitest'

afterEach(() => cleanup())
import App from './App'

describe('Samparka app shell', () => {
  it('opens on Contacts with the primary navigation visible', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument()
    expect(screen.getByText(/your circle starts here/i)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contacts' })).toHaveAttribute('aria-current', 'page')
  })

  it('navigates between Recent, Contacts, and Add views', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Recent' }))
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument()
    expect(screen.getByText(/nothing recent yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('heading', { name: 'Add contact' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back to contacts/i }))
    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument()
  })

  it('offers a first-contact action from the empty Contacts state', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /add your first contact/i }))
    expect(screen.getByRole('heading', { name: 'Add contact' })).toBeInTheDocument()
  })
})
