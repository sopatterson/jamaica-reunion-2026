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

Before publishing the new page:

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
