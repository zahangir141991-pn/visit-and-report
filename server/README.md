# DMS Attendance device services

These services belong only to `zahangir141991-pn/visit-and-report` and Firebase project `visit-report-ea224`. They do not connect to Hisab360.

## Deployment state

GitHub Pages serves the English Attendance workspace. Publishing these server files to GitHub **does not deploy a Cloudflare Worker or run a LAN connector**. The existing login Worker remains separate. Cloudflare access was blocked during the last dashboard sign-in, so receiver v2 must be activated before ADMS push/sync buttons become available.

## ADMS receiver v2

1. Use the **existing Attendance device receiver** Worker, not `dms-attendance-login`.
2. Deploy `adms-receiver.mjs` and its imported `firebase-service.mjs` together. `wrangler.toml` is a deployment template; replace its name with the actual existing receiver name before deploying.
3. Keep `FIREBASE_SERVICE_ACCOUNT` as an encrypted Worker secret. Its service account project must be `visit-report-ea224`. Never paste its value into source files, the app, GitHub, screenshots or chat.
4. Set `FIREBASE_PROJECT_ID=visit-report-ea224` and `FIREBASE_DATABASE_URL=https://visit-report-ea224-default-rtdb.firebaseio.com`.
5. Merge **only** the `.indexOn` array from `FIREBASE_INDEXES.json` into the existing `attendance/records` rules. Do not replace the database rules with this fragment. Preserve authentication and authorization rules. The receiver falls back to a full catalog read when the optional kind index is unavailable.
6. Add the receiver hostname in Attendance → Settings. Register the machine name, branch, serial and its Internet public IP in Devices. A per-device hostname may override the default.
7. In the machine ADMS/Cloud Server menu, use that hostname (no protocol/path), matching port and HTTPS setting. The machine must support this protocol. Some K60 firmware requires the LAN connector instead.
8. Confirm an actual heartbeat. Receiver v2 publishes `protocolVersion: 2` and supported commands in the device status. Then record a physical test punch and verify check-in/out in Reports.
9. Push one test employee. Status progresses `Queued` → `Sent` → `Synced` only after that device posts a successful command acknowledgement (`Return=0`). Test each model/firmware before bulk push.

`/health` validates configuration syntax/key import, not live Firebase authorization or machine reachability. The receiver registers no passwords or biometric templates in Firebase. It accepts only registered serials and their exact public IPs. If the branch public IP changes, update its registration.

Commands are limited to user ID/name updates and attendance/user queries. No delete, clear-log, reboot, door-control, credential or privilege-changing command is exposed. A data-query acknowledgement means the device accepted the request; actual incoming data is tracked by `lastDataAt`/`lastUserDataAt`.

Unmapped attendance rows are retained under `attendance_server/adms_raw` and reconciled after employees are mapped. Do not open this server-only path to browser clients. Retain the existing Attendance-admin claim checks on client records; server device status, inventory and completed job fields should remain server-writable only. The connector service account must remain private.

## LAN connector (K60 / TCP-IP)

Run `local-connector.py` on a trusted computer on the same LAN as the registered machine. Use a dedicated Python virtual environment and install `requirements-local.txt`. Download the device JSON from its Setup dialog and store it on that computer. Supply a private DMS service account file using `--service-account`; do not put it inside this repository. Configure an existing machine communication key only through the local `ZK_COMM_KEY` environment variable. Set `ZK_FORCE_UDP=true` only if required by that firmware/network.

Example:

```sh
python local-connector.py --device-config device-config.json --service-account /private/dms-service-account.json
```

The computer must remain running. Polling defaults to 15 seconds. A local SQLite checkpoint is written only after cloud acknowledgement; keep it with the connector installation. Historical device logs are never cleared. Existing machine privileges, password and card values are preserved when updating a user, and are never sent to Firebase. User push is verified by reading back that user ID/name.

## Reports and compatibility

Existing `attendance/records` employees, settings, leaves, punches and device records stay at their existing paths. Legacy minute-only punches use first/last detection. New machine punches retain seconds and explicit IN/OUT states. Single punches do not invent checkout times. Calculations use Asia/Dhaka, current configured same-day shift rules, first-in/last-out duration less configured break, and a Monday–Sunday report week. Future days are not marked absent. Settings changes recalculate historical reports; they are not payroll calculations.

## Tests

```sh
node --test tests/*.test.mjs
python tests/test_local_connector.py
```

Tests use simulated devices and database stores; no employee records are created or altered by the tests. Physical-device and live Cloudflare/Firebase tests require deployment and access to the registered hardware.

Protocol references: ZKTeco Attendance PUSH Communication Protocol manual; ZKTeco PUSH SDK; pyzk's upstream API documentation at https://github.com/fananimi/pyzk; Firebase Admin database documentation at https://firebase.google.com/docs/database/admin/save-data.
