# Reference App Summary

## Purpose

The reference app is a Streamlit prototype for planning and evaluating digital content performance. It uses historical ASU story performance data to estimate likely 30-day and 90-day pageviews, score draft quality, compare similar stories, and export simple reports.

## Main User Workflows

- Review a dashboard of historical story metrics.
- Enter a planned story and receive a prediction.
- Paste, upload, or fetch draft text and receive readability and improvement feedback.
- Find similar historical stories.
- Save, view, delete, and export prediction records.
- Download the source dataset and a lightweight API specification.

## Features Reproduced

- Simple dashboard with totals, status summary, recent records, and next action.
- Records list with search, filters, sorting, create, view, edit, and delete.
- Spreadsheet import with template download, preview, validation, duplicate detection, and import summary.
- CSV and XLSX export of permitted records.
- Privacy-safe GA4 event hooks through one central utility.
- Simple score and recommendation logic that helps non-technical users act on the data.

## Features Intentionally Excluded

- Complex AI agent behavior.
- Admin retraining endpoint.
- Email delivery.
- Multi-service architecture.
- Advanced model diagnostics.
- Production SSO integration.

## Excel Or CSV Functionality Retained

- Upload `.csv` and `.xlsx` files.
- Validate expected columns.
- Show row-level errors before import.
- Import only valid non-duplicate rows.
- Export records.
- Download a safe sample template.

## Google Analytics Functionality Retained

The reference app did not include GA4 tracking. Content Watchtower adds optional, privacy-safe GA4 tracking for product events only. No names, emails, raw notes, search text, record IDs, or spreadsheet content are sent.

## Assumptions

- This MVP is for a side project or internal pilot.
- Authentication is not required yet because the reference app has no login or roles.
- Local browser storage is acceptable for the lightweight MVP. A production version should move operational data to PostgreSQL before multi-user use.
