import type { Contact } from '../contacts/contact'
import { CONTACT_HEADERS } from './googleSheetsSchema'

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const SAMPARKA_WORKSHEET = 'Contacts'
const GIS_URL = 'https://accounts.google.com/gsi/client'
const GAPI_URL = 'https://apis.google.com/js/api.js'

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
}
type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void
}
type GooglePicker = {
  ViewId: { SPREADSHEETS: string }
  Action: { PICKED: string; CANCEL: string }
  DocsView: new (id: string) => { setMimeTypes: (types: string) => unknown }
  PickerBuilder: new () => {
    addView: (view: unknown) => unknown
    setOAuthToken: (token: string) => unknown
    setDeveloperKey: (key: string) => unknown
    setAppId: (id: string) => unknown
    setCallback: (
      callback: (data: {
        action: string
        docs?: Array<{ id: string; name: string }>
      }) => void,
    ) => unknown
    build: () => { setVisible: (visible: boolean) => void }
  }
}
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: GoogleTokenResponse) => void
            error_callback?: (error: { type: string }) => void
          }) => GoogleTokenClient
        }
      }
      picker?: GooglePicker
    }
    gapi?: { load: (api: string, callback: () => void) => void }
  }
}

export type GoogleConfig = { clientId: string; apiKey: string; appId: string }
export type SelectedSpreadsheet = { id: string; name: string }
export type SheetPreview = {
  title: string
  worksheets: Array<{ title: string; sheetId: number }>
  values: string[][]
}

export class GoogleIntegrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'config'
      | 'cancelled'
      | 'denied'
      | 'expired'
      | 'api'
      | 'network'
      | 'unavailable',
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GoogleIntegrationError'
  }
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${src}"]`,
  )
  if (existing?.dataset.loaded === 'true') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    script.onerror = () =>
      reject(
        new GoogleIntegrationError(
          'Google services could not be loaded. Check your connection and retry.',
          'unavailable',
        ),
      )
    if (!existing) document.head.append(script)
  })
}

export async function requestGoogleAccessToken(
  config: GoogleConfig,
): Promise<{ accessToken: string; expiresAt: number }> {
  if (!config.clientId)
    throw new GoogleIntegrationError(
      'Set VITE_GOOGLE_CLIENT_ID before connecting.',
      'config',
    )
  await loadScript(GIS_URL)
  return new Promise((resolve, reject) => {
    const client = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: config.clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new GoogleIntegrationError(
              'Google authorization was denied or cancelled. You can try again.',
              'denied',
            ),
          )
          return
        }
        resolve({
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        })
      },
      error_callback: () =>
        reject(
          new GoogleIntegrationError(
            'Google authorization was closed before it completed. You can try again.',
            'cancelled',
          ),
        ),
    })
    if (!client)
      return reject(
        new GoogleIntegrationError(
          'Google Identity Services is unavailable.',
          'unavailable',
        ),
      )
    client.requestAccessToken({ prompt: 'consent' })
  })
}

export async function pickSpreadsheet(
  config: GoogleConfig,
  accessToken: string,
): Promise<SelectedSpreadsheet> {
  if (!config.apiKey || !config.appId)
    throw new GoogleIntegrationError(
      'Set VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID to use Picker.',
      'config',
    )
  await loadScript(GAPI_URL)
  await new Promise<void>((resolve) => window.gapi?.load('picker', resolve))
  const picker = window.google?.picker
  if (!picker)
    throw new GoogleIntegrationError(
      'Google Picker is unavailable.',
      'unavailable',
    )
  return new Promise((resolve, reject) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
    view.setMimeTypes('application/vnd.google-apps.spreadsheet')
    const builder = new picker.PickerBuilder()
    builder.addView(view)
    builder.setOAuthToken(accessToken)
    builder.setDeveloperKey(config.apiKey)
    builder.setAppId(config.appId)
    builder.setCallback((data) => {
      if (data.action === picker.Action.CANCEL)
        reject(
          new GoogleIntegrationError(
            'Spreadsheet selection was cancelled.',
            'cancelled',
          ),
        )
      else if (data.action === picker.Action.PICKED && data.docs?.[0])
        resolve({ id: data.docs[0].id, name: data.docs[0].name })
    })
    builder.build().setVisible(true)
  })
}

export class SheetsApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request<T>(
    url: string,
    token: string,
    init?: RequestInit,
  ): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher.call(globalThis, url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      })
    } catch (cause) {
      const reason =
        cause instanceof Error
          ? `${cause.name}: ${cause.message}`
              .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
              .replace(/https?:\/\/[^\s]+/gi, '[URL redacted]')
              .slice(0, 180)
          : 'Unknown browser network error'
      throw new GoogleIntegrationError(
        `Could not reach Google Sheets (${reason}). Check the network and browser console, then retry.`,
        'network',
      )
    }
    if (response.status === 401)
      throw new GoogleIntegrationError(
        'Google access expired. Reconnect to continue.',
        'expired',
        response.status,
      )
    if (!response.ok) {
      let providerMessage = ''
      try {
        const payload = (await response.clone().json()) as {
          error?: { message?: string }
        }
        providerMessage = payload.error?.message?.slice(0, 240) ?? ''
      } catch {
        // Keep the HTTP status if Google returned a non-JSON error response.
      }
      throw new GoogleIntegrationError(
        `Google Sheets request failed (${response.status}).${providerMessage ? ` ${providerMessage}` : ' Check access and try again.'}`,
        'api',
        response.status,
      )
    }
    return response.json() as Promise<T>
  }

  async preview(spreadsheetId: string, token: string): Promise<SheetPreview> {
    const root = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
    const meta = await this.request<{
      properties: { title: string }
      sheets: Array<{ properties: { title: string; sheetId: number } }>
    }>(`${root}?fields=properties.title,sheets.properties`, token)
    const title = meta.sheets[0]?.properties.title
    const values = title
      ? await this.request<{ values?: string[][] }>(
          `${root}/values/${encodeURIComponent(`${title}!A1:H6`)}`,
          token,
        )
      : {}
    return {
      title: meta.properties.title,
      worksheets: meta.sheets.map(({ properties }) => properties),
      values: values.values ?? [],
    }
  }

  async createSpreadsheet(
    title: string,
    token: string,
  ): Promise<SelectedSpreadsheet> {
    const result = await this.request<{
      spreadsheetId: string
      properties: { title: string }
    }>(
      'https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,properties.title',
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: { title },
          sheets: [{ properties: { title: SAMPARKA_WORKSHEET } }],
        }),
      },
    )
    await this.updateValues(
      result.spreadsheetId,
      `${SAMPARKA_WORKSHEET}!A1`,
      [ [...CONTACT_HEADERS] ],
      token,
    )
    return { id: result.spreadsheetId, name: result.properties.title }
  }

  async readValues(spreadsheetId: string, range: string, token: string): Promise<string[][]> {
    const result = await this.request<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
      token,
    )
    return result.values ?? []
  }

  async appendRow(
    spreadsheetId: string,
    worksheet: string,
    contact: Contact,
    token: string,
    headers = ['id', 'name', 'phoneNumbers', 'emails', 'description', 'tags', 'createdAt', 'updatedAt', 'archivedAt', 'schemaVersion'],
  ): Promise<void> {
    const range = `${worksheet}!A:ZZ`
    const { contactToRow } = await import('./googleSheetsSchema')
    await this.request(
      `${`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`}?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          values: [
            contactToRow(contact, headers),
          ],
        }),
      },
    )
  }

  async updateValues(
    spreadsheetId: string,
    range: string,
    values: string[][],
    token: string,
  ): Promise<void> {
    await this.request(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      token,
      { method: 'PUT', body: JSON.stringify({ values }) },
    )
  }

  async updateRow(spreadsheetId: string, range: string, values: string[][], token: string): Promise<void> {
    return this.updateValues(spreadsheetId, range, values, token)
  }

  async addMetadataColumns(
    spreadsheetId: string,
    range: string,
    values: string[][],
    token: string,
    explicitConsent: boolean,
  ): Promise<void> {
    if (!explicitConsent)
      throw new GoogleIntegrationError(
        'Explicit consent is required before adding Samparka metadata columns.',
        'api',
      )
    await this.updateRow(spreadsheetId, range, values, token)
  }
}
