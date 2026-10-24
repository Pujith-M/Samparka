# Samparka Google Sheets schema

Schema version: **1.0**. A connection selects one spreadsheet and one worksheet. The first row is the header row; subsequent non-empty rows are contacts.

## Headers

```text
id | name | phoneNumbers | emails | description | tags | createdAt | updatedAt | archivedAt | schemaVersion
```

All ten headers are required for a Samparka-managed worksheet. Samparka does not add individual columns to an existing worksheet or ask for consent column by column. A connection must either use a worksheet that already matches this complete schema or create a new Samparka worksheet with the schema below.

Arrays use JSON, not delimiters, so commas, quotes, Unicode, and empty strings remain reversible. For example, `phoneNumbers` is `["+1,555-0100","办公室"]` and `tags` is `["Friend","Work"]`. Timestamps are Unix milliseconds. An archive timestamp hides a contact from the active view; clearing it restores the row. Rows are never deleted.

Example row:

```text
c-123 | Ada Lovelace | ["+1,555-0100"] | ["ada@example.com"] | First programmer | ["Friend"] | 1710000000000 | 1710000000000 |  | 1.0
```

Blank rows are ignored. Blank or malformed managed cells, missing or renamed headers, duplicate headers, duplicate IDs, and missing IDs are validation errors that block mutations. Unknown columns are preserved and never rewritten by the schema converter.
