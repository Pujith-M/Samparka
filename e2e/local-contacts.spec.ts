import { expect, test } from '@playwright/test'

test('creates, searches, edits, and deletes a persisted contact', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Contacts', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Add your first contact' }).click()

  await page.getByLabel('Name').fill('Maya Rao')
  await page.getByLabel('Phone number 1').fill('+91 98765 43210')
  await page.getByLabel('Description').fill('Met at the pottery studio')
  await page.getByRole('button', { name: 'Save contact' }).click()

  await expect(
    page.getByRole('heading', { name: 'Maya Rao', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Maya Rao, +91 98765 43210' }),
  ).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search contacts' }).fill('pottery')
  await expect(
    page.getByRole('button', { name: 'Maya Rao, +91 98765 43210' }),
  ).toBeVisible()
  await expect(page.getByText('1 contact shown')).toBeVisible()

  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.getByRole('button', { name: 'Maya Rao, +91 98765 43210' }).click()
  await page.getByRole('button', { name: 'Edit contact' }).click()
  await page.getByLabel('Name').fill('Maya Rao updated')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(
    page.getByRole('heading', { name: 'Maya Rao updated', exact: true }),
  ).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete contact' }).click()
  await expect(page.getByText('Your circle starts here')).toBeVisible()
})
