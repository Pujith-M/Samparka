# Samparka Google Sheets schema

Schema version: **1.0**. A connection selects one spreadsheet and one worksheet. The first row is the header row; subsequent non-empty rows are contacts.

## Headers

```text
samparka_contact_id | name | phone_numbers_json | emails_json | description | tags_json | created_at | updated_at | archived_at
```

`samparka_contact_id`, `name`, `phone_numbers_json`, `emails_json`, `description`, `tags_json`, `created_at`, and `updated_at` are required. `archived_at` is optional for existing sheets, but is required before archive/restore operations. Samparka must ask for consent before adding either managed column.

Arrays use JSON, not delimiters, so commas, quotes, Unicode, and empty strings remain reversible. For example, `phone_numbers_json` is `["+1,555-0100","办公室"]` and `tags_json` is `["Friend","Work"]`. Timestamps are Unix milliseconds. An archive timestamp hides a contact from the active view; clearing it restores the row. Rows are never deleted.

Blank rows are ignored. Blank or malformed managed cells, missing or renamed headers, duplicate headers, duplicate IDs, and missing IDs are validation errors that block mutations. Unknown columns are preserved and never rewritten by the schema converter.
