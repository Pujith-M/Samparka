# Samparka Google Sheets schema

Schema version: **1.0**. A connection selects one spreadsheet and one worksheet. The first row is the header row; subsequent non-empty rows are contacts.

## Headers

```text
id | name | phoneNumbers | emails | description | tags | createdAt | updatedAt | archivedAt | schemaVersion
```

`id`, `name`, `phoneNumbers`, `emails`, `description`, `tags`, `createdAt`, `updatedAt`, and `schemaVersion` are required to read a Samparka worksheet. `archivedAt` is required for reversible archive and restore operations. If an existing compatible worksheet lacks `archivedAt`, Samparka asks before inserting that column immediately before `schemaVersion`; Google Sheets shifts later columns while preserving their contents. Declining leaves the schema and local queue unchanged. New Samparka worksheets start with all ten headers.

Arrays use JSON, not delimiters, so commas, quotes, Unicode, and empty strings remain reversible. For example, `phoneNumbers` is `["+1,555-0100","办公室"]` and `tags` is `["Friend","Work"]`. Timestamps are Unix milliseconds. An archive timestamp hides a contact from the active view; clearing it restores the row. Rows are never deleted.

Example row:

```text
c-123 | Ada Lovelace | ["+1,555-0100"] | ["ada@example.com"] | First programmer | ["Friend"] | 1710000000000 | 1710000000000 |  | 1.0
```

Blank rows are ignored. Blank or malformed managed cells, missing or renamed headers, duplicate headers, duplicate IDs, and missing IDs are validation errors that block mutations. Unknown columns are preserved and never rewritten by the schema converter.
