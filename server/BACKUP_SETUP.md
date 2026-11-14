# DMS free encrypted daily backup (v167)

This is for `visit-report-ea224` and `zahangir141991-pn/visit-and-report` only.
No billing plan upgrade, Firebase service-account key in GitHub, external paid
storage, Actions artifact upload, new GitHub PAT or plaintext backup commit is
required by this implementation.

## What is stored

The GitHub default-branch workflow runs at approximately **03:37 Asia/Dhaka**
(`37 21 * * *` UTC). Standard public GitHub-hosted runners execute it. It reads
Realtime Database data and the actual deployed RTDB Rules through a fixed,
read-only machine endpoint on the existing login Worker. The Firebase service
account stays in Cloudflare. The export token cannot change business data,
change Rules, select arbitrary database paths or log in as any user.

The job validates both exports, gzip-compresses them, encrypts with AES-256-GCM
using a random 256-bit key, and verifies complete decryption before publishing.
Only encrypted `.dmsbackup` files and a non-sensitive README are written to the
separate `dms-encrypted-backups` branch. `main`, GitHub Pages, and app data are
not written by the backup workflow.

The branch view keeps the **latest seven successful snapshots**, not seven
calendar days. The branch is replaced with a new root commit using an exact
force-with-lease; concurrent changes or unexpected files stop publication.
Old Git objects may remain retrievable until GitHub garbage collection. They
remain encrypted. Do not treat this rotation as guaranteed immediate erasure.
The backup branch is public, like the existing repository: a lost/exposed
recovery key compromises backups. Never commit it or the export token.

## One-time setup

1. Download `backup/DMS_Backup_Setup_And_Restore.html` and open the local file
   with Chrome or Edge. It has no external dependencies and `connect-src 'none'`.
   Generate the two independent secrets and save the private key file **offline**.
   Do not upload it to the app, GitHub Code, chat, or Library.
2. In Cloudflare, on **dms-attendance-login**, add encrypted Secret
   `DMS_BACKUP_TOKEN` with the generated token. Keep the existing service-account
   and database URL secrets unchanged.
3. Deploy the complete single-file `DMS_Worker_v167.txt` supplied with this setup,
   or deploy `dms-login-worker.mjs` and both imported modules (`security-data.mjs`
   and `backup-export.mjs`). Root health should report version 167 and
   `encrypted-backup-export-v1`. Health is not proof of a working backup.
4. In the exact DMS GitHub repository, go to **Settings → Secrets and variables
   → Actions → New repository secret**. Set `DMS_BACKUP_TOKEN` to the same token,
   and `DMS_BACKUP_KEY` to the independent recovery key. Do not put the service
   account there. Do not put either secret in repository Variables or Code.
5. Once this workflow is merged into `main`, open **Actions → DMS encrypted daily
   backup → Run workflow → main**. A successful test must create a timestamped
   `.dmsbackup` file in `dms-encrypted-backups`. Download that first file and use
   the offline tool to verify it opens. Keep an offline copy of the file and key.
   Until this succeeds, the feature is **prepared, not activated/verified**.

## Access and operating limits

* Never enable anonymous Firebase reads for backup. Browser CORS requests to
  `/backup/export` are rejected; a 64-character random Bearer token is required.
  Missing Worker configuration disables the endpoint. Export requests are rate
  limited, `no-store`, and upstream error bodies/secrets are never forwarded.
* Spark's current storage/download limits still apply, including backup traffic.
  A disabled or quota-exhausted database can stop the backup. This does not
  repair the usage-limit warning already seen in Firebase Console.
* Each export is limited to 128 MiB of JSON; an encrypted backup is limited to
  32 MiB to control repository growth. Oversized/incomplete exports fail without
  replacing old backups. Do not promise a successful backup before measuring
  the first production export. Large data requires a different storage plan.
* GitHub schedules may be delayed/dropped and can be disabled after 60 days of
  repository inactivity. Check the newest backup date and Actions status, and
  enable GitHub workflow failure notifications in the owner's account. No
  notification channel or external monitoring is silently configured here.
* This includes RTDB data and Rules, including the app's `user_auth` records.
  It does **not** export Firebase Authentication's separate user store,
  Cloudflare encrypted secrets, Cloud Storage, other projects or frontend code.
* A Firebase service account retains its pre-existing privileged authority;
  read-only export behavior is enforced by this Worker handler. Rotate a leaked
  export token. To rotate the encryption key, keep every old key required by
  older backups; this implementation has no key escrow.

## Restore

Download the chosen `.dmsbackup` file from the backup branch. Open the offline
HTML tool, select the file and enter its saved recovery key. It verifies AES-GCM,
project, gzip and payload structure, then enables separate JSON downloads for
RTDB data and Rules. It never connects to Firebase or restores automatically.

Before any restore, export the current live database, confirm the snapshot date
and project, and review the intended replacement. Importing root JSON can
replace newer records. Restore Rules only after verifying compatibility with
the currently deployed Worker/client. Do not paste a recovery key into chat.
