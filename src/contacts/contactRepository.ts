import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import { normalizeContact } from './contact'
import type { Contact, ContactInput, ContactUpdate } from './contact'

const DATABASE_NAME = 'samparka'
const DATABASE_VERSION = 1
const CONTACT_STORE = 'contacts'

interface SamparkaDatabase extends DBSchema {
  contacts: {
    key: string
    value: Contact
    indexes: { 'by-updated-at': number }
  }
}

export class ContactStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContactStorageError'
  }
}

export interface ContactRepository {
  create(input: ContactInput): Promise<Contact>
  getById(id: string): Promise<Contact | undefined>
  list(): Promise<Contact[]>
  update(id: string, changes: ContactUpdate): Promise<Contact>
  delete(id: string): Promise<void>
}

export class IndexedDbContactRepository implements ContactRepository {
  private database?: Promise<IDBPDatabase<SamparkaDatabase>>

  constructor(private readonly databaseName = DATABASE_NAME) {}

  private open(): Promise<IDBPDatabase<SamparkaDatabase>> {
    this.database ??= openDB<SamparkaDatabase>(this.databaseName, DATABASE_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore(CONTACT_STORE, { keyPath: 'id' })
        store.createIndex('by-updated-at', 'updatedAt')
      },
    })
    return this.database
  }

  private async run<T>(operation: (database: IDBPDatabase<SamparkaDatabase>) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.open())
    } catch (error) {
      if (error instanceof ContactStorageError) throw error
      throw new ContactStorageError('Could not access contacts in browser storage.', { cause: error })
    }
  }

  async create(input: ContactInput): Promise<Contact> {
    const normalized = normalizeContact(input)
    const now = Date.now()
    const contact: Contact = {
      ...normalized,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    return this.run(async (database) => {
      await database.add(CONTACT_STORE, contact)
      return contact
    })
  }

  getById(id: string): Promise<Contact | undefined> {
    return this.run((database) => database.get(CONTACT_STORE, id))
  }

  list(): Promise<Contact[]> {
    return this.run(async (database) => (await database.getAllFromIndex(CONTACT_STORE, 'by-updated-at')).reverse())
  }

  async update(id: string, changes: ContactUpdate): Promise<Contact> {
    const existing = await this.getById(id)
    if (!existing) throw new ContactStorageError(`Contact “${id}” does not exist.`)
    const normalized = normalizeContact({
      name: changes.name ?? existing.name,
      phoneNumbers: changes.phoneNumbers ?? existing.phoneNumbers,
      emails: changes.emails ?? existing.emails,
      description: changes.description === undefined ? existing.description : changes.description,
      tags: changes.tags ?? existing.tags,
    })
    const updated: Contact = {
      ...normalized,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
    }
    return this.run(async (database) => {
      await database.put(CONTACT_STORE, updated)
      return updated
    })
  }

  async delete(id: string): Promise<void> {
    await this.run((database) => database.delete(CONTACT_STORE, id))
  }

  async close(): Promise<void> {
    if (!this.database) return
    const database = await this.database
    database.close()
    this.database = undefined
  }
}

export const contactRepository = new IndexedDbContactRepository()
