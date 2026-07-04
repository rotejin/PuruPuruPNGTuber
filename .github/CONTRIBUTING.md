# Contributing

Thanks for your interest in PuruPuru PNGTuber.

By contributing software code or documentation text, you agree that your contribution is provided under the Apache License 2.0 unless explicitly stated otherwise before submission.

## Before contributing

- Read [README.md](../README.md), [SECURITY.md](./SECURITY.md), and [SUPPORT.md](./SUPPORT.md).
- Do not submit assets unless you own them or have permission to contribute them.
- Do not include private characters, raw material folders, generated `.purupuru` files, backups, or screenshots containing private information.

## Development checks

Run these before submitting changes:

```bash
node --check app.js
node --check standalone_drawing_avatar_export/standalone-drawing-avatar.js
node tests/js_runtime_checks.mjs
python -m py_compile scripts/run_local_server.py
python -m py_compile scripts/verify_vendor_checksums.py
python -m py_compile scripts/fetch_fonts.py
python scripts/verify_vendor_checksums.py
python -m unittest tests.test_project_static
```

## Pull request expectations

- Keep changes focused.
- Update documentation when behavior changes.
- Include before/after screenshots for UI changes when useful.
- Avoid large refactors mixed with feature changes.
- Review license and asset impact for any new files. Code and documentation are Apache-2.0; bundled/demo visual assets are separate.
