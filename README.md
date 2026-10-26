# jamaica-reunion-2026
Family Reunion 2026

## Family photo uploads and approval

Use **Upload Family Photos** on the main page to select one or more JPG, PNG,
or WebP images, up to 8 MB each. Enter your name first. Photos upload one at a
time with progress feedback and remain private until reviewed. If some uploads
fail, **Retry Failed Photos** retries only those photos, not successful uploads.
Choosing a new selection replaces the retry queue.

Review emails go to the configured photo reviewer. The **Approve** and
**Reject** form submits at the top browser level because Google Apps Script
pages run inside a sandboxed frame; posting within that frame causes Google's
“refused to connect” error. Existing review links use the corrected form after
the backend is redeployed. Approval publishes the image to the carousel on the
next website load; rejection removes it from the review queue.

Publish the main page and deploy the backend using the deployment instructions
below. Run the photo regression tests with:

```sh
node --test tests/photos.test.cjs
```

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

### T-shirt organizer access

New orders and updates also send a separate notification to
**chrishird20@gmail.com**. The family still receives its own response copy and
private edit link. Organizer emails do not contain the family's edit credentials.
If either email fails, the order stays saved, the failure is logged, and the
page reports the relevant delivery problem independently.

Chris uses the existing **T-Shirt Orders** tab in the
[shared reunion spreadsheet](https://docs.google.com/spreadsheets/d/1CnTfSMjKRbHTd1RVeWkvCULY-ds1HmdrC3HMQetoMuk/edit#gid=1731207462).
Orders remain in their original rows: one family per row with up to ten
member name/size pairs. New submissions and edits appear automatically; no
separate manager page, export synchronization, or setup email is required.

The spreadsheet is shared with **chrishird20@gmail.com** as an **Editor**, as
approved by the organizer. General access remains **Restricted**. Google
permissions apply to the entire workbook, so Chris can also view and edit the
RSVP, flight, and archive tabs. Keep access limited to trusted organizers.
Leave order IDs and the hidden edit-token hash column unchanged to preserve
families' private edit links.

To download all orders, Chris can choose **File > Download > Microsoft Excel
(.xlsx)** in Google Sheets. This downloads the entire workbook, including the
T-Shirt Orders tab and the other reunion tabs. Google permissions and downloads
remain available after the order deadline.

New and updated order notifications now point directly to this Google Sheets
tab. Previous manager-page URLs forward there as well; Google sign-in and
spreadsheet permissions are required. The former token-based order-list API
has been removed, so old manager tokens no longer grant access.

Run all related regression tests:

```sh
node --test tests/flight-export.test.cjs tests/tshirt-orders.test.cjs tests/apps-script-deploy.test.cjs
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
administrative functions such as `setupTshirtSheet` are separate from deployment:
select the function and click **Run** in the editor when initially setting up
the sheet. Routine order access and Chris's spreadsheet sharing need no Apps
Script setup function. Ordinary code updates require no copying, pasting, or
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
