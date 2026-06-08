# Contributing

Thank you for thinking about contributing. A few notes.

## Before you start

1. This is a demo, not a product. Big architectural changes are unlikely
   to merge; bug fixes, doc improvements, and additional smoke targets
   are welcome.
2. Open an issue describing what you want to change before sending a PR
   for anything larger than a typo fix.

## Local checks before opening a PR

```bash
make setup                # only if first time
make doctor               # must exit 0
shellcheck scripts/*.sh   # must exit 0
# Touching the deploy path? Also: make up && make smoke
```

## Documentation conventions

- ASCII typography only. No U+2014 (em dash), U+2013 (en dash),
  U+2026 (horizontal ellipsis), U+201C/U+201D (curly double quotes),
  U+2018/U+2019 (curly single quotes). Use ` -- ` for an em-dash-like
  separator and `...` for an ellipsis. Reason: multi-byte UTF-8 in
  Markdown source has historically double-encoded on the SSE wire
  in this repo's portal stream.
- No secrets in `.envrc`. Use `conceal` + Keychain via `make setup`.
- Mac-only stance is intentional. Linux / Windows fixes go on a Wiki
  page, not in tracked docs.

## License

By contributing you agree your contribution is licensed under Apache-2.0
to match the rest of the repo.
