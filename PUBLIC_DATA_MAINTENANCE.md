# Public data maintenance

The recipient guide is `data-guide.html`. Do not add it or the JSON endpoints
to navigation, the sitemap, or other public landing pages. The guide has a
`noindex,nofollow` directive; it is not an authenticated or private endpoint.
Commercial use and redistribution are prohibited. Do not add a permissive
open-data license to the generated data.

## Generation

For source folders containing `data.csv` and `stage_skills.csv`, run
`node import_dataset.js <source-directory>` first. This maps the source Pred
and Feature columns, parses only the explicit BPM field, preserves blank Pred
values, and replaces course stages for the supplied versions while retaining
other versions. Both CSV files are validated before either bundle is written.
Then bump the data bundle cache keys in the HTML templates and run the chart
page generator below. A full generation also updates the chart sitemap entries.

The official CSV import index is built on every record-page initialization from
the current bundle's `official_title`, `official_version`, and difficulty. Keep
these fields populated during updates. `record-import-index.js` supplements only
legacy aliases; new charts do not require a separate manual index update. Aliases
for IDs absent from the current dataset are ignored, and same-name charts remain
version-specific when the title and difficulty are ambiguous.

Run `node generate_public_data.js` after changing `data.js`, or use
`node generate_chart_pages.js`, which also generates the JSON. Generation
validates all rows before writing output. All published Pred values are raw
values from `data.js`, not personalized values or approximations.

Enable the automatic commit hook once in each publication checkout:

```sh
git config core.hooksPath .githooks
```

The hook automatically generates and stages `data/v1` when `data.js` or a
generator is staged. It reads the staged `data.js`, so partially staged changes
are exported correctly. Node.js must be available on PATH. Do not bypass the
hook for data updates. Keep `.githooks/pre-commit` executable on Unix.

When editing via GitHub's web editor or another checkout without the hook,
generate and include the output before publishing. A hosting server does not
run the local generator automatically. Run `node generate_public_data.js --check`
to detect stale output, a damaged snapshot, or a mismatched manifest.

## Version policy

- `schemaVersion: 1` and `data/v1` describe the schema, not the Pred model version.
- IDs are existing chart IDs as strings. Never reuse a removed ID for a different chart.
- Dataset versions use the creation date in JST and the first 12 hexadecimal
  characters of SHA-256 of the canonical content. The manifest stores full hashes.
- Changes to chart data, feature definitions, or usage metadata create a new
  snapshot. Reordering input rows or feature tokens does not.
- Repeating generation preserves the initial timestamp. Reverting to an earlier
  dataset reuses its existing version. `manifest.latest` is authoritative.
- Preserve all files under `data/v1/versions`; never edit published snapshots.
- Keep the guide's feature table in sync with `featureDefinitions` in the generator.
- Breaking changes require a separate version path such as `data/v2`.

## Verification

```sh
node --test tests/public-data-regression.cjs
node generate_public_data.js --check
```

After publishing, verify the latest JSON and manifest via the public HTTPS URLs
and fetch the JSON in a browser page served from localhost to check CORS.
The guide includes the fetch example. A local CORS-enabled test server alone
cannot verify the actual production response headers.
