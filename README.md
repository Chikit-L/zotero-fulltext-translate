# Full Text Translate for Zotero

This README is also available in: [:cn: 简体中文](./doc/README-zhCN.md)

This is a Zotero full-text translation plugin. It parses PDFs with MinerU and then translates the parsed content with Translate for Zotero.

## Notice

This plugin was developed with substantial AI assistance, so it may still contain bugs, incomplete edge-case handling, formatting problems, or incorrect results. For important papers, please manually verify the parsing and translation output. It is not recommended to use the results directly in formal research, submission, or archival workflows without review.

## Features

- Reconstruct local PDF attachments under a Zotero item into HTML for reading
- Add a `Full Text Translation` action to the item context menu
- Translate the parsed content through Translate for Zotero
- Generate an HTML attachment and add it back to the original item
- Support both Chinese-only and Chinese-English bilingual reading modes in the generated HTML
- Automatically use the precise parsing API when `MinerU Token` is configured
- Automatically fall back to the lightweight Agent API when no token is configured

## Workflow

1. Select a Zotero item with a local PDF attachment.
2. Right-click the item and choose `Full Text Translation`.
3. The plugin sends the PDF to MinerU for parsing.
4. The plugin sends the parsed result to Translate for Zotero for translation.
5. The plugin generates an HTML attachment from the translated result and adds it back to the original item.

## Example Output

- [Open a sample translated HTML result](https://chikit-l.github.io/zotero-fulltext-translate/examples/GreatBarrierReef.translated.html)

## MinerU Modes

The plugin automatically chooses the MinerU mode based on whether a token is provided:

- Precise API
  Enabled when `MinerU Token` is configured in settings.
  Better suited for real use.
  Provides more complete support for tables, images, and structured content.
- Lightweight Agent API
  Enabled when no token is configured.
  No login is required, but file size, page count, and structured output are more limited.
  Images and tables may be missing or only partially preserved in this mode.

It is strongly recommended to apply for a MinerU API token so you can use the precise parsing API.

| Comparison | 🎯 Precise Parsing API | ⚡ Lightweight Agent API |
| --- | --- | --- |
| Token required | ✅ Yes | ❌ No, IP rate limited |
| Endpoint | `/api/v4/extract/task` or `/api/v4/file-urls/batch` | `/api/v1/agent/parse/url` or `/api/v1/agent/parse/file` |
| Model version | `pipeline` by default, `vlm` recommended, `MinerU-HTML` also supported | Fixed lightweight `pipeline` model |
| File size limit | ≤ 200MB | ≤ 10MB |
| Page limit | ≤ 600 pages | ≤ 20 pages |
| Batch support | ✅ Yes, up to 200 files | ❌ Single file only |
| Output format | Zip package with Markdown and JSON, exportable to docx/html/latex | Markdown only, returned through a CDN link |
| Call pattern | Async, submit then poll | Async, submit then poll |

## Requirements

- Zotero 7
- [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate) must be installed
- The selected item must contain a local PDF attachment
- Optional but strongly recommended: a MinerU API token

## Settings

The current preferences pane includes:

- MinerU Token
- MinerU Model
- Document Language
- Enable OCR
- Enable Table Recognition
- Enable Formula Recognition

## Install

If a release is available, you can install the latest `.xpi` package from GitHub Releases.

If you need an online update manifest for Zotero auto-update, use:

- `https://chikit-l.github.io/zotero-fulltext-translate/update.json`

If you are building from source:

```bash
npm install
npm run build
```

After the build completes, install the generated `.xpi` file from `.scaffold/build/` into Zotero.

## Acknowledgements

This project was developed with reference to the following projects:

- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) for the plugin scaffold and build workflow
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero#readme) for implementation ideas around MinerU-related features
- [zotero-style](https://github.com/MuiseDestiny/zotero-style#readme) for presentation ideas for full-text translation results

## License

GNU Affero General Public License v3.0
