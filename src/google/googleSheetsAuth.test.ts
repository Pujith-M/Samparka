import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import {
  DRIVE_FILE_SCOPE,
  GoogleIntegrationError,
  pickSpreadsheet,
  requestGoogleAccessToken,
} from './googleSheets'

const config = {
  clientId: 'public-client-id.apps.googleusercontent.com',
  apiKey: 'public-api-key',
  appId: '1234567890',
}

const gisUrl = 'https://accounts.google.com/gsi/client'
const gapiUrl = 'https://apis.google.com/js/api.js'

function loadScript(url: string) {
  const script = document.querySelector<HTMLScriptElement>(
    `script[src="${url}"]`,
  )
  if (!script) throw new Error(`Expected script ${url} to be added`)
  fireEvent.load(script)
}

afterEach(() => {
  delete window.google
  delete window.gapi
  document.querySelectorAll('script').forEach((script) => script.remove())
  vi.restoreAllMocks()
})

describe('Google browser authorization', () => {
  it('requests only drive.file and keeps the returned token in memory', async () => {
    let tokenCallback:
      | ((response: {
          access_token?: string
          expires_in?: number
          error?: string
        }) => void)
      | undefined
    let requestedScope = ''
    const requestAccessToken = vi.fn()
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((options) => {
            tokenCallback = options.callback
            requestedScope = options.scope
            return { requestAccessToken }
          }),
        },
      },
    }

    const pending = requestGoogleAccessToken(config)
    loadScript(gisUrl)
    await waitFor(() => expect(tokenCallback).toBeDefined())

    expect(requestedScope).toBe(DRIVE_FILE_SCOPE)
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'consent' })
    tokenCallback?.({ access_token: 'ephemeral-test-token', expires_in: 300 })

    await expect(pending).resolves.toMatchObject({
      accessToken: 'ephemeral-test-token',
      expiresAt: expect.any(Number),
    })
  })

  it('reports OAuth denial and popup cancellation as recoverable errors', async () => {
    let tokenCallback: ((response: { error?: string }) => void) | undefined
    let errorCallback: ((error: { type: string }) => void) | undefined
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((options) => {
            tokenCallback = options.callback
            errorCallback = options.error_callback
            return { requestAccessToken: vi.fn() }
          }),
        },
      },
    }

    const denied = requestGoogleAccessToken(config)
    loadScript(gisUrl)
    await waitFor(() => expect(tokenCallback).toBeDefined())
    tokenCallback?.({ error: 'access_denied' })
    await expect(denied).rejects.toMatchObject<Partial<GoogleIntegrationError>>(
      { code: 'denied' },
    )

    const cancelled = requestGoogleAccessToken(config)
    await waitFor(() => expect(errorCallback).toBeDefined())
    errorCallback?.({ type: 'popup_closed' })
    await expect(cancelled).rejects.toMatchObject<
      Partial<GoogleIntegrationError>
    >({ code: 'cancelled' })
  })

  it('returns the selected spreadsheet from Picker and handles cancellation', async () => {
    let pickerCallback:
      | ((data: {
          action: string
          docs?: Array<{ id: string; name: string }>
        }) => void)
      | undefined
    const setVisible = vi.fn()
    const builders: MockPickerBuilder[] = []
    class MockPickerBuilder {
      constructor() {
        builders.push(this)
      }
      addView = vi.fn().mockReturnThis()
      setOAuthToken = vi.fn().mockReturnThis()
      setDeveloperKey = vi.fn().mockReturnThis()
      setAppId = vi.fn().mockReturnThis()
      setCallback = vi.fn(
        (
          callback: (data: {
            action: string
            docs?: Array<{ id: string; name: string }>
          }) => void,
        ) => {
          pickerCallback = callback
          return this
        },
      )
      build = vi.fn(() => ({ setVisible }))
    }
    const picker = {
      ViewId: { SPREADSHEETS: 'spreadsheets' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      DocsView: class {
        setMimeTypes = vi.fn()
      },
      PickerBuilder: MockPickerBuilder,
    }
    window.google = { picker }
    window.gapi = { load: vi.fn((_api, callback) => callback()) }

    const selected = pickSpreadsheet(config, 'ephemeral-test-token')
    loadScript(gapiUrl)
    await waitFor(() => expect(pickerCallback).toBeDefined())
    expect(builders[0]?.setOAuthToken).toHaveBeenCalledWith(
      'ephemeral-test-token',
    )
    expect(builders[0]?.setDeveloperKey).toHaveBeenCalledWith(config.apiKey)
    expect(builders[0]?.setAppId).toHaveBeenCalledWith(config.appId)
    expect(setVisible).toHaveBeenCalledWith(true)
    pickerCallback?.({
      action: 'picked',
      docs: [{ id: 'selected-sheet-id', name: 'Disposable test sheet' }],
    })
    await expect(selected).resolves.toEqual({
      id: 'selected-sheet-id',
      name: 'Disposable test sheet',
    })

    const cancelled = pickSpreadsheet(config, 'ephemeral-test-token')
    await waitFor(() =>
      expect(builders[1]?.setCallback).toHaveBeenCalledTimes(1),
    )
    pickerCallback?.({ action: 'cancel' })
    await expect(cancelled).rejects.toMatchObject<
      Partial<GoogleIntegrationError>
    >({ code: 'cancelled' })
  })
})
