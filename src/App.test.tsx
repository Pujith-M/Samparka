import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Samparka placeholder', () => {
  it('introduces the product and its purpose', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /good things grow/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/helps you hold on to the little details/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /something lovely is on its way/i }),
    ).toHaveAttribute('href', 'mailto:hello@samparka.app')
  })
})
