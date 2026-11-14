# DMS security rollout v166

This is for `visit-report-ea224` and `zahangir141991-pn/visit-and-report` only.
Do not point it at Hisab360. GitHub publication alone does not apply database rules
or deploy the existing `dms-attendance-login` Worker.

## Changes

* Remove the permissive section wildcard. Unknown database sections fail closed.
* Browser credentials, login history and other users' sessions stay private.
* Agent master and transaction reports: Admin/DM all, DSO own wallet, DSS none.
* DSS KYC is scoped to exact, unambiguous common DSS–DSO assignments. KYC remains visible.
* Visit reports are Admin/DM all; field users see only their own visits or, for
  DSO, their own wallet's visits. DSS cannot read other users' agent visit reports.
* `/data` verifies the Firebase ID token and current account, and filters on the
  server before returning any records, images or report chunks. Arbitrary paths
  and client-supplied scope are rejected.
* KYC status changes are Admin-only. KYC history is append-only. Visit/KYC/photo
  deletion and whole-root deletion by browser clients are denied, including Admin.
* Reset/disabled accounts lose data access; existing sessions require fresh login
  after deployment to acquire credential-version and assigned-wallet claims.

## Required validation and order

1. Run the GitHub `DMS security checks` workflow. It must pass, including the local
   database emulator. Unit tests alone do not prove Firebase Rules compilation.
2. Take a full **private** production database export in Firebase Console and
   verify it opens. Do not commit the export or credentials or upload them to a
   public workflow artifact. This change does not configure automatic backups.
3. Deploy `server/dms-login-worker.mjs` **and its import** `security-data.mjs` to
   the existing login Worker. Keep the existing encrypted service-account secret
   and database URL. Verify `/health` advertises `scoped-data-v1` and version 166.
4. Publish the frontend `index.html` and `assets/secure-data.js` together. Do not
   deploy this frontend before the Worker supports `/data`.
5. Publish `server/DMS_DATABASE_RULES.json` to the existing RTDB. This step actually
   closes direct database access. Never deploy only the frontend and claim that
   server security is active.
6. Sign out/in test accounts Admin, DM, DSS and DSO 801/802/846. Verify private
   reads, own KYC submission with photo, duplicate rejection, Admin status/history,
   visit submission with photo, review replies and Attendance before wider rollout.
   Check requests to other wallets and DELETE operations are denied without
   testing destructive requests against real production records.

Scoped subscriptions use a 15-second reconciliation fallback; existing live-update
signals also refresh the app. No passwords, device approval policy, idle logout,
automatic backups or encryption key rotation are silently configured by this patch.
Server service-account access remains privileged and requires separate operational
controls. Back up data before rollback; never restore the broad wildcard rules as
an incident response.
