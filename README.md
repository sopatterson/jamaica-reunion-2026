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

## Family T-shirt orders

The main page links to [Family T-Shirt Order Form](tshirts.html). One response
per family captures the contact name, email, and 1-10 member names and sizes
(XS, S, M, L, XL, XXL). Only the selected number of member sections are shown.
A review step requires respondents to confirm the names and sizes.

The cutoff is **the end of Sunday, October 25, 2026, Eastern/New York time**:
`2026-10-26T00:00:00-04:00` (04:00 UTC on October 26). Both new orders and
edits are rejected by the server at or after that instant. Existing private
links still allow viewing the response and resending its email copy.

### Required backend deployment

Use the automated deployment command below once this workspace is authorized.
The manual alternative, including initial sheet setup, is:

1. Open the Google Apps Script project serving the existing RSVP endpoint.
2. Replace its code with [google-apps-script.gs](google-apps-script.gs).
3. Run `setupTshirtSheet` once and approve the spreadsheet and email permissions.
   This creates the **T-Shirt Orders** tab without changing RSVP or flight data.
4. Choose **Deploy > Manage deployments > Edit** on the existing web app,
   select **New version**, and deploy. Keep the same `/exec` URL, execute as the
   owner, and retain access for anyone, as required by the existing public site.
   Do not create a separate deployment URL unless it is also updated in both
   the main page and [tshirts.js](tshirts.js).
5. Check the existing endpoint with `?action=tshirtConfig`. It must return
   `success: true`, the deadline above, and `timeZone: "America/New_York"`.
6. Publish the website files, including [tshirts.html](tshirts.html) and
   [tshirts.js](tshirts.js). Submit an order using your own email to verify
   actual email delivery and the emailed edit link, then remove that test order
   from the **T-Shirt Orders** tab before collecting family orders.

Each order occupies one spreadsheet row with the contact information, member
count, ten pairs of member name/size columns, creation/update timestamps, and a
hashed edit token. Editing or retrying the same submission updates that row,
including clearing removed members, instead of creating another order.

The spreadsheet must be restricted to trusted organizers; do not publish it
or enable public link access. Contact details are not exposed through a public
order-list API. The private edit link uses a random 256-bit token in the URL
fragment; keep it private because it authorizes viewing and updating the order.
Only the token hash is stored in the sheet. Hiding that column is for convenience,
not access control. Do not replace the emailed link with an order ID alone.

Confirmation emails automatically include a copy of all responses and the
private view/edit link. Mail is sent using the Apps Script owner's `MailApp`
quota. If email sending fails, the saved order is preserved and the page clearly
offers **Retry confirmation email** and the private link. Check spam folders
and the Apps Script execution logs when troubleshooting.

To change the cutoff, update `TSHIRT_ORDER_DEADLINE` in
[google-apps-script.gs](google-apps-script.gs) with an explicit UTC offset,
keep `TSHIRT_ORDER_TIME_ZONE` consistent, and redeploy the backend. The page
loads the deadline from the server rather than keeping a separate cutoff.

Run both export and order tests:

```sh
node --test tests/flight-export.test.cjs tests/tshirt-orders.test.cjs
```

### T-shirt event manager

New orders and updates also send a separate notification to
**chrishird20@gmail.com**. The family still receives its own response copy and
private edit link. Manager emails do not contain the family's edit credentials.
If either email fails, the order stays saved, the failure is logged, and the
page reports the relevant delivery problem independently.

After updating the Apps Script code and redeploying a new version of the
existing web app, run **`setupTshirtManager`** in the Apps Script editor.
This emails Chris a snapshot of **all existing orders** and a private link to
[the manager page](tshirt-orders.html). It also works when there are no orders
yet, and rerunning it sends an updated snapshot using the same private link.
Make sure the website manager page has been published before Chris uses it.

Chris can refresh the order list or choose **Download All Orders (.xls)**.
Each download fetches the current full list, including edits, and produces
one Excel workbook with:

- **Orders:** one row per person, with contact name, email, family shirt count,
  member name, shirt size, and order reference. The family count is repeated
  for context on each person's row; use the **Size Totals** worksheet for totals
  rather than summing this repeated column.
- **Size Totals:** quantities for XS, S, M, L, XL, XXL, the total shirt count,
  and the number of family orders.

Orders are listed alphabetically by contact name. Downloads remain available
after the submission deadline. The manager page is read-only and is not linked
from the public reunion page. Access requires the private manager token, which
is sent to the backend only in a POST body and is never included in exports.

The manager token is generated from two random UUIDs and stored in the Apps
Script project's **Script Properties** as `tshirtManagerToken`, not in the
website or spreadsheet. Treat the emailed manager link and downloaded files
as confidential: anyone with the link can see all orders. To revoke a leaked
link, delete that Script Property and run `setupTshirtManager` again; the old
link will stop working and Chris will receive a new one.

Run all related regression tests:

```sh
node --test tests/flight-export.test.cjs tests/tshirt-orders.test.cjs tests/tshirt-manager.test.cjs
```

## Automated Apps Script deployments

This project pins `@google/clasp` as a development dependency. It publishes
backend updates to the **existing** Google Apps Script deployment, preserving
the `/exec` URL, original manifest, access settings, and remote-only source
files. It does not create a new Google project or replace spreadsheet data.

### One-time authorization and linking

1. Install Node.js 20 or newer and run `npm ci`. On the current Mac, a
   checksum-verified Node.js 24.22.1 installation is available in
   `~/.local/share/jamaica-reunion-tools/node-v24.22.1-darwin-arm64/`.
   The shell wrapper below automatically uses it when `node` is not on PATH.
2. Enable **Google Apps Script API** in
   [Apps Script user settings](https://script.google.com/home/usersettings).
3. Run:

   ```sh
   ./scripts/apps-script.sh login
   ./scripts/apps-script.sh link EXISTING_SCRIPT_ID
   ```

   Complete Google's sign-in and consent in the browser. The Script ID is in
   the existing project's **Project Settings**, not its deployment URL.
   Linking checks that the project contains the deployment already used by
   the website and refuses to overwrite unmerged remote edits.

### Deploy an update

```sh
./scripts/apps-script.sh deploy "Describe the backend update"
```

This runs all regression tests, downloads a fresh private project snapshot,
replaces only the reunion backend source file, pushes it, reads it back to
verify the exact code and preserved manifest, creates an immutable version,
and updates the same live deployment. It stops explicitly if the Google
editor has unmerged changes or the source/deployment cannot be verified.
Avoid editing the Google project while a deployment is running.

With Node/npm on PATH, the equivalent commands are `npm run apps-script:login`,
`npm run apps-script:link -- EXISTING_SCRIPT_ID`, and
`npm run apps-script:deploy -- "Describe the backend update"`.

Use `./scripts/apps-script.sh status` to check authorization or
`./scripts/apps-script.sh open` to open the existing project. Initial
administrative functions such as `setupTshirtSheet` or `setupTshirtManager`
are separate from deployment: select the function and click **Run** in the
editor when needed. Ordinary code updates require no copying, pasting, or
manual deployment version selection.

### Credential and publication safety

Google authorization is stored in
`~/.config/jamaica-reunion/clasp-auth.json` with owner-only permissions,
outside the repository. Do not paste its contents into chat or commit it.
Google may occasionally require renewed consent; run the login command again.
Authorization can also be revoked from your Google account.

Project links and temporary source snapshots stay in the Git-ignored
`.apps-script/` directory. The previous and current deployment version
numbers are recorded locally for recovery. Do not run a forced push to
bypass remote-source conflicts; merge those changes first.

GitHub Pages now stages only public browser files plus the `images/` and
`vendor/` directories into `_site/`. OAuth files, Apps Script source,
deployment configuration, development dependencies, and automation scripts
are not uploaded as website files. To validate the public staging locally:

```sh
node scripts/prepare-site.mjs
```
