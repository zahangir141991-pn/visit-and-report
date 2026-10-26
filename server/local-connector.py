"""DMS ZKTeco LAN connector. Polls attendance; never clears or disables the machine.
Install requirements-local.txt in a virtual environment. Run beside the device:
  python local-connector.py --device-config device-config.json --service-account /private/dms-service-account.json
The service account file and communication key MUST stay outside the repository.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import time
from pathlib import Path

PROJECT = 'visit-report-ea224'
DATABASE = 'https://visit-report-ea224-default-rtdb.firebaseio.com'
DHAKA = dt.timezone(dt.timedelta(hours=6))


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def safe_name(value):
    return re.sub(r'[\x00-\x1f\x7f]', ' ', str(value)).strip().encode('utf-8')[:24].decode('utf-8', errors='ignore')


def punch_record(punch, employee, device_id):
    value = punch.timestamp
    if value.tzinfo is not None:
        value = value.astimezone(DHAKA)
    date, clock = value.strftime('%Y-%m-%d'), value.strftime('%H:%M:%S')
    direction = str(getattr(punch, 'punch', ''))
    key = f'p_{employee}_{date}_{clock.replace(":", "")}_{direction}'
    return key, dict(kind='punch', employee=employee, device=device_id, date=date,
                     time=clock, punchState=direction, source='Local connector',
                     timestamp=value.replace(tzinfo=DHAKA).isoformat())


class SkipJob(Exception):
    pass


def claim_job(reference):
    def change(value):
        if not value or value.get('status') not in ('Queued', 'Sent'):
            raise SkipJob()
        sent = value.get('sentAt')
        if value.get('status') == 'Sent' and sent:
            try:
                if (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(sent.replace('Z', '+00:00'))).total_seconds() < 30:
                    raise SkipJob()
            except ValueError:
                pass
        return dict(value, status='Sent', sentAt=timestamp(), attempts=int(value.get('attempts', 0)) + 1)
    try:
        return reference.transaction(change)
    except SkipJob:
        return None


def push_user(conn, employee, job):
    if str(employee.get('code')) != str(job.get('code')) or not re.fullmatch(r'[A-Za-z0-9_-]{1,24}', str(job.get('code', ''))):
        raise ValueError('Employee device user ID changed or is invalid')
    code = str(job['code'])
    users = conn.get_users()
    matches = [u for u in users if str(u.user_id) == code]
    if len(matches) > 1:
        raise ValueError('Duplicate user IDs on machine')
    current = matches[0] if matches else None
    used = {u.uid for u in users}
    uid = current.uid if current else next((n for n in range(1, 65535) if n not in used), None)
    if uid is None:
        raise ValueError('No available device user slot')
    name = safe_name(job.get('name') or employee.get('deviceName') or employee.get('name', ''))
    if not name:
        raise ValueError('Device display name is empty')
    # Preserve existing device privileges, card and password. None are uploaded.
    conn.set_user(uid=uid, name=name, privilege=current.privilege if current else 0,
                  password=current.password if current else '', group_id=current.group_id if current else '',
                  user_id=code, card=current.card if current else 0)
    confirmed = [u for u in conn.get_users() if str(u.user_id) == code]
    if len(confirmed) != 1 or confirmed[0].name.strip() != name:
        raise ValueError('Device read-back did not confirm user update')


def run_cycle(conn, root, device_id, record_data, checkpoint):
    device = record_data.get(device_id)
    if not device or device.get('kind') != 'device' or device.get('accessType') != 'Device' or device.get('active') is False:
        raise ValueError('Register an active local device in DMS first')
    serial = conn.get_serialnumber()
    if device.get('serial') and str(serial).strip() != str(device['serial']).strip():
        raise ValueError('Machine serial does not match DMS device')
    employees = {k: v for k, v in record_data.items() if isinstance(v, dict) and v.get('kind') == 'employee'}
    by_code = {}
    for key, employee in employees.items():
        if (employee.get('allBranchAttendance') is True and not employee.get('deleted') and str(employee.get('designation', '')).strip().lower() in ('dm', 'distribution manager')) or employee.get('sourceDevice') == device_id or (not employee.get('sourceDevice') and str(employee.get('branch', '')).strip().lower() == str(device.get('location', '')).strip().lower()):
            by_code.setdefault(str(employee.get('code')), []).append(key)
    for key, employee in employees.items():
        if employee.get('allBranchAttendance') is True and not employee.get('deleted') and str(employee.get('designation', '')).strip().lower() in ('dm', 'distribution manager'):
            code = str(employee.get('code'))
            if sum(str(e.get('code')) == code for e in employees.values()) != 1:
                by_code[code] = []
    updates, new_hashes = {}, []
    users = conn.get_users()
    for user in users:
        code = str(user.user_id)
        key = hashlib.sha256((device_id + '|' + code).encode()).hexdigest()
        updates['attendance/records/du_' + key] = dict(kind='deviceUser', device=device_id, code=code,
                                                        name=str(user.name)[:100], receivedAt=timestamp())
    new_count = 0
    punches = conn.get_attendance()
    for punch in punches:
        code = str(punch.user_id)
        raw_id = hashlib.sha256((device_id + '|' + code + '|' + str(punch.timestamp) + '|' + str(getattr(punch, 'punch', ''))).encode()).hexdigest()
        if len(by_code.get(code, [])) != 1:
            updates['attendance_server/local_raw/' + device_id + '/' + raw_id] = dict(code=code,
                timestamp=punch.timestamp.replace(tzinfo=DHAKA).isoformat(), punchState=str(getattr(punch, 'punch', '')), receivedAt=timestamp())
            continue
        if checkpoint.execute('SELECT 1 FROM saved WHERE id=?', (raw_id,)).fetchone():
            continue
        key, record = punch_record(punch, by_code[code][0], device_id)
        updates['attendance/records/' + key] = record
        updates['attendance_server/local_raw/' + device_id + '/' + raw_id] = None
        new_hashes.append(raw_id)
        new_count += 1
    status = dict(kind='deviceStatus', device=device_id, online=True, updated=timestamp(), mode='Local connector',
                  protocolVersion=2, capabilities=['pull_attendance', 'push_user', 'inspect_users', 'delete_user'], userCount=len(users))
    status_path = 'attendance/records/status_' + device_id
    for key, value in status.items():
        updates[status_path + '/' + key] = value
    if new_count:
        updates[status_path + '/lastDataAt'] = timestamp()
        updates[status_path + '/lastDataCount'] = new_count
    updates[status_path + '/lastUserDataAt'] = timestamp()
    # Do not clear checkpoint entries until the cloud confirms the whole write.
    for begin in range(0, len(updates), 400):
        part = dict(list(updates.items())[begin:begin + 400])
        root.update(part)
    checkpoint.executemany('INSERT OR IGNORE INTO saved (id) VALUES (?)', [(key,) for key in new_hashes])
    checkpoint.commit()
    for job_id, candidate in list(record_data.items()):
        if not isinstance(candidate, dict) or candidate.get('device') != device_id or candidate.get('kind') not in ('pushjob', 'syncjob'):
            continue
        if candidate.get('status') not in ('Queued', 'Sent'):
            continue
        reference = root.child('attendance/records/' + job_id)
        job = claim_job(reference)
        if not job:
            continue
        try:
            if int(job.get('attempts', 0)) > 5:
                raise ValueError('Maximum delivery attempts exceeded')
            if job['kind'] == 'pushjob' and job.get('action') == 'delete_user':
                employee = employees.get(job.get('employee'))
                code = str(job.get('code', ''))
                if not employee or not employee.get('deleted') or str(employee.get('code')) != code or job.get('employee') not in by_code.get(code, []):
                    raise ValueError('Deletion employee or device mapping does not match')
                if any(k != job.get('employee') and not employees[k].get('deleted') for k in by_code.get(code, [])):
                    raise ValueError('Another employee uses this device ID')
                matches = [u for u in conn.get_users() if str(u.user_id) == code]
                for user in matches:
                    conn.delete_user(uid=user.uid)
                if any(str(u.user_id) == code for u in conn.get_users()):
                    raise ValueError('Device still contains this user')
                removal = {'attendance/records/' + job['employee'] + '/deviceDeletionStatus': 'Synced'}
                for key, value in record_data.items():
                    if isinstance(value, dict) and value.get('kind') == 'deviceUser' and value.get('device') == device_id and str(value.get('code')) == code:
                        removal['attendance/records/' + key] = None
                root.update(removal)
                reference.update(dict(status='Synced', completedAt=timestamp(), returnCode=0, resultMessage='Device read-back confirmed user deletion'))
            elif job['kind'] == 'pushjob' and job.get('action', 'upsert_user') == 'upsert_user':
                employee = employees.get(job.get('employee'))
                if not employee or employee.get('deleted'):
                    raise ValueError('Employee does not exist')
                push_user(conn, employee, job)
                reference.update(dict(status='Synced', completedAt=timestamp(), returnCode=0,
                    resultMessage='Device read-back confirmed user ID and name'))
            elif job['kind'] == 'syncjob' and job.get('action') in ('pull_attendance', 'inspect_users'):
                reference.update(dict(status='Acknowledged', completedAt=timestamp(), returnCode=0,
                    resultMessage='Device data received and saved by this polling cycle'))
            else:
                raise ValueError('Unsupported device operation')
        except Exception as error:
            reference.update(dict(status='Failed', completedAt=timestamp(), error=str(error)[:160]))


def main():
    parser = argparse.ArgumentParser(description='DMS ZKTeco local connector')
    parser.add_argument('--device-config', required=True)
    parser.add_argument('--service-account', required=True)
    parser.add_argument('--checkpoint', default='attendance-checkpoint.sqlite')
    args = parser.parse_args()
    config = json.loads(Path(args.device_config).read_text(encoding='utf-8'))
    account = json.loads(Path(args.service_account).read_text(encoding='utf-8'))
    if account.get('project_id') != PROJECT:
        raise SystemExit('This connector only accepts the DMS visit-report-ea224 project.')
    device_id = str(config.get('deviceId', ''))
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', device_id):
        raise SystemExit('Valid DMS deviceId required')
    from zk import ZK
    import firebase_admin
    from firebase_admin import credentials, db
    firebase_admin.initialize_app(credentials.Certificate(account), dict(databaseURL=DATABASE,
        httpTimeout=15))
    root = db.reference('/')
    checkpoint = sqlite3.connect(args.checkpoint)
    checkpoint.execute('CREATE TABLE IF NOT EXISTS saved (id TEXT PRIMARY KEY)')
    interval = max(5, min(60, int(config.get('pollSeconds', 15))))
    while True:
        conn = None
        try:
            record_data = db.reference('attendance/records').get() or {}
            device = record_data.get(device_id, {})
            if device.get('active') is False:
                time.sleep(interval)
                continue
            if str(device.get('address')) != str(config['ip']) or int(device.get('port', 4370)) != int(config.get('port', 4370)):
                raise ValueError('Connector IP/port do not match the DMS device registration')
            machine = ZK(config['ip'], port=int(config.get('port', 4370)), timeout=8,
                password=int(os.environ.get('ZK_COMM_KEY', '0')), ommit_ping=True,
                force_udp=str(os.environ.get('ZK_FORCE_UDP', '')).lower() == 'true', encoding='utf-8')
            conn = machine.connect()
            run_cycle(conn, root, device_id, record_data, checkpoint)
            print(timestamp(), 'Device synchronization complete', flush=True)
        except KeyboardInterrupt:
            break
        except Exception as error:
            print(timestamp(), 'Synchronization failed:', type(error).__name__, flush=True)
            try:
                db.reference('attendance/records/status_' + device_id).update(dict(kind='deviceStatus',
                    device=device_id, online=False, updated=timestamp(), error='Connector could not reach the device or storage'))
            except Exception:
                pass
        finally:
            if conn:
                try:
                    conn.disconnect()
                except Exception:
                    pass
        time.sleep(interval)
    checkpoint.close()


if __name__ == '__main__':
    main()
