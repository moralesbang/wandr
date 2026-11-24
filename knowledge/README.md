# Knowledge

How code is written in Wandr. [`docs/`](../docs/) says what Wandr is and why each decision was made; this folder says how to write the code that follows from those decisions.

A standard binds every line you write or review in the paths it applies to. Read each one that matches the files you touch before writing them.

| Standard | Applies to |
| --- | --- |
| [`data-layer.md`](standards/data-layer.md) | `apps/web/src/**`: every file that calls the API, defines a query key or uses TanStack Query, and every route loader |
