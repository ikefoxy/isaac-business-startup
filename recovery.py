"""SQLite snapshots and non-destructive restore drills; no external dependencies."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sqlite3
import tempfile

TABLES = ('orders', 'inventory', 'rewards')


def open_readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)


def check_database(connection):
    if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise ValueError('Database integrity check failed.')
    return {name: connection.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0] for name in TABLES}


def restore_copy(backup, output):
    """Restore to a new file only; never overwrite a running or existing database."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation also protects against accidentally replacing an existing DB.
    fd = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with closing(open_readonly(backup)) as source, closing(sqlite3.connect(output)) as target:
            expected = check_database(source)
            source.backup(target, pages=128)
            actual = check_database(target)
            if actual != expected:
                raise ValueError('Restored row counts did not match.')
        return actual
    except Exception:
        output.unlink(missing_ok=True)
        raise


def create_backup(database, directory, keep=7):
    """Online backup, integrity check, restore drill, then atomic publication."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    stamp = datetime.now(timezone.utc)
    name = 'backup-' + stamp.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(4)
    final = directory / (name + '.sqlite3')
    temporary = directory / (name + '.partial')
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        with closing(open_readonly(database)) as source, closing(sqlite3.connect(temporary)) as target:
            source.backup(target, pages=128)
            check_database(target)
        with tempfile.TemporaryDirectory(prefix='byteback-restore-') as work:
            counts = restore_copy(temporary, Path(work) / 'restored.sqlite3')
        os.replace(temporary, final)
        metadata = {'id': name, 'created_at': stamp.timestamp(), 'bytes': final.stat().st_size,
                    'integrity': 'passed', 'restore_drill': 'passed', 'verified_records': counts}
        meta = directory / (name + '.json')
        fd = os.open(meta, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(metadata, stream)
        # Keep the most recent N completed snapshots; ignore unrelated files.
        for old in list_backups(directory)[max(1, keep):]:
            (directory / (old['id'] + '.sqlite3')).unlink(missing_ok=True)
            (directory / (old['id'] + '.json')).unlink(missing_ok=True)
        return metadata
    finally:
        temporary.unlink(missing_ok=True)


def list_backups(directory):
    results = []
    directory = Path(directory)
    for path in directory.glob('backup-*.json'):
        try:
            value = json.loads(path.read_text())
            # Metadata cannot point at paths outside this directory.
            valid = isinstance(value, dict) and value.get('id') == path.stem
            valid = valid and type(value.get('created_at')) in [int, float] and value['created_at'] > 0
            valid = valid and type(value.get('bytes')) is int and value['bytes'] >= 0
            valid = valid and value.get('integrity') == 'passed' and value.get('restore_drill') == 'passed'
            counts = value.get('verified_records', {}) if isinstance(value, dict) else {}
            valid = valid and isinstance(counts, dict) and all(type(counts.get(name)) is int and counts[name] >= 0 for name in TABLES)
            if valid and (directory / (path.stem + '.sqlite3')).is_file():
                results.append(value)
        except (OSError, ValueError, TypeError):
            continue
    return sorted(results, key=lambda row: row['created_at'], reverse=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    backup = commands.add_parser('backup')
    backup.add_argument('--database', default='.data/byteback.sqlite3')
    backup.add_argument('--directory', default='.data/backups')
    backup.add_argument('--keep', type=int, default=7)
    restore = commands.add_parser('restore')
    restore.add_argument('--backup', required=True)
    restore.add_argument('--output', required=True, help='A new, non-existing database path')
    args = parser.parse_args()
    if args.command == 'backup':
        print(json.dumps(create_backup(args.database, args.directory, args.keep), indent=2))
    else:
        print(json.dumps({'restore': 'passed', 'verified_records': restore_copy(args.backup, args.output)}, indent=2))
