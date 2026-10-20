# jamaica-reunion-2026
Family Reunion 2026

## Flight tracker

The flight tracker lists families alphabetically, with arrival and departure
rows together. **Download Flight List (.xls)** exports that same family
breakdown as a binary Excel workbook, including incomplete rows and local edits.
**Download Bus Plan (.xls)** also exports a binary Excel workbook, preserving
the shared bus groups and seat totals, with families listed alphabetically
within each group. The RSVP download remains a CSV file.

The Excel export uses the locally bundled SheetJS Community Edition 0.20.3
([distribution](https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js),
[Apache 2.0 license](vendor/SheetJS-LICENSE.txt)). No external script service is
required at download time.

Run the flight export regression tests with Node.js:

```sh
node --test tests/flight-export.test.cjs
```
