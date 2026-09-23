# OCR real-world calibration fixtures

This directory is for **sanitized** bank/app screenshots used to calibrate O-Wallet Image Import v2 against real layouts.

Do not commit an unsanitized banking screenshot. Preserve layout, typography, colors, spacing, repeated-row structure and status bars, but replace names, account/reference identifiers and other private values before adding a fixture. Use fake transaction amounts in committed fixtures when possible.

## Files

- `manifest.example.json` documents the schema.
- `manifest.json` is optional. When it exists, GitHub Actions runs every listed case through the same browser/Tesseract/tiled-OCR path used by the visual harness.
- Image files referenced by the manifest stay in this directory.

The calibration report intentionally contains only structural metrics: dimensions, OCR box count, transaction-block count, confidence, tile/retry counts and expected-value **hit counts**. It does not export raw OCR text, merchant/recipient strings or parsed amount values.

## Local run

Build the OCR harness first:

```bash
VITE_OCR_E2E=1 npm run build
npm run test:ocr:calibration
```

The local `dist/tessdata` must contain the language data used by each case. CI always provides English and additionally provides Vietnamese when `manifest.json` exists.

## Expectations

`expect.expectedAmounts` is only used internally to count parser hits. The values are never copied into the result report. Duplicates are occurrence-aware, so `[100000, 100000]` requires two matching parsed transactions.

Template calibration is optional. When `template.hints` is present, the runner teaches Pattern Template v2 from one detected block using semantic text hints, ranks that template against the full screenshot, then runs segmentation again through the template path.

Do not tune production thresholds from one fixture. Add failures from multiple apps/themes/layouts and convert each reproducible failure into a committed regression case before changing `OCR_HEURISTIC_THRESHOLDS`.
