import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { ContactValidationError } from './contact'
import { ContactStorageError, IndexedDbContactRepository } from './contactRepository'

const databaseName = 'samparka-test-contacts'
const repository = new IndexedDbContactRepository(databaseName)

afterEach(async () => {
  await repository.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('contact model and IndexedDB repository', () => {
  it('rejects missing names and phone numbers with useful validation errors', async () => {
    await expect(repository.create({ name: '  ', phoneNumbers: ['123'] })).rejects.toThrow(
      ContactValidationError,
    )
    await expect(repository.create({ name: 'Mira', phoneNumbers: ['  '] })).rejects.toThrow(
      /at least one non-empty phone number/i,
    )
  })

  it('normalizes optional fields and deduplicates tags case-insensitively', async () => {
    const contact = await repository.create({
      name: '  Mira Rao  ',
      phoneNumbers: [' +001 23 ', '555 0100'],
      emails: [' mira@example.com ', ''],
      description: '  School friend  ',
      tags: ['Friend', ' friend ', 'Work'],
    })

    expect(contact).toMatchObject({
      name: 'Mira Rao',
      phoneNumbers: ['+001 23', '555 0100'],
      emails: ['mira@example.com'],
      description: 'School friend',
      tags: ['Friend', 'Work'],
    })
    expect(contact.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(contact.createdAt).toBe(contact.updatedAt)
  })

  it('supports create, get, list, update, and delete while preserving identity and creation time', async () => {
    const original = await repository.create({ name: 'Mira', phoneNumbers: ['00123'] })
    expect(await repository.getById(original.id)).toEqual(original)
    expect(await repository.list()).toEqual([original])

    const updated = await repository.update(original.id, { name: 'Mira Rao', tags: ['Friend'] })
    expect(updated).toMatchObject({ id: original.id, createdAt: original.createdAt, name: 'Mira Rao' })
    expect(updated.updatedAt).toBeGreaterThan(original.updatedAt)
    expect(await repository.getById(original.id)).toEqual(updated)

    await repository.delete(original.id)
    expect(await repository.getById(original.id)).toBeUndefined()
    expect(await repository.list()).toEqual([])
  })

  it('keeps contacts after closing and reopening the database', async () => {
    const original = await repository.create({ name: 'Mira', phoneNumbers: ['00123'] })
    await repository.close()

    expect(await repository.getById(original.id)).toEqual(original)
  })

  it('surfaces browser storage failures through a repository error', async () => {
    const originalIndexedDb = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
    try {
      const brokenRepository = new IndexedDbContactRepository('storage-unavailable')
      await expect(brokenRepository.list()).rejects.toThrow(ContactStorageError)
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDb })
    }
  })
})
