"""ByteBack MVP. Python standard library only; run: python3 server.py."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from email.message import EmailMessage
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
# Small, dependency-free .env reader. Environment variables take precedence.
if (ROOT / '.env').exists():
    for line in (ROOT / '.env').read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('\"').strip("'"))
DEMO = os.getenv('BYTEBACK_MODE', 'demo') == 'demo'
PORT = int(os.getenv('PORT', '4173'))
ORIGIN = os.getenv('PUBLIC_URL', f'http://localhost:{PORT}').rstrip('/')
DB = os.getenv('BYTEBACK_DB', str(ROOT / '.data' / 'byteback.sqlite3'))
ADMINS = {v.strip().lower() for v in os.getenv('ADMIN_EMAILS', '').split(',') if v.strip()}
STAGES = ['Submitted', 'Received', 'Data wiped', 'Refurbished', 'Ready for student', 'Collected']
TYPES = {'Laptop': 2, 'Desktop': 7, 'Tablet': .5}
DROP = os.getenv('DROPOFF_DESCRIPTION', 'Demo campus drop-off · Provo (no physical collection location is operating)')


@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def init_db():
    Path(DB).parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, email TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, email TEXT, expires REAL, csrf TEXT);
        CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, email TEXT, kind TEXT, status TEXT, data TEXT, created REAL, request_key TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, name TEXT, specs TEXT, price INTEGER, source TEXT, state TEXT);
        CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, email TEXT, subject TEXT, body TEXT, status TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS throttles (key TEXT PRIMARY KEY, count INTEGER, expires REAL);
        ''')
        if DEMO:
            for item in [('demo-thinkpad', 'Lenovo ThinkPad T480', 'Core i5 · 8 GB RAM · 256 GB SSD · Linux Mint', 79),
                         ('demo-dell', 'Dell Latitude 5400', 'Core i5 · 16 GB RAM · 256 GB SSD · Linux Mint', 119),
                         ('demo-ipad', 'Apple iPad (7th generation)', '32 GB · Wi-Fi · 10.2-inch display', 59)]:
                db.execute('INSERT OR IGNORE INTO inventory VALUES (?,?,?,?,?,?)', (*item, 'Demo inventory', 'available'))


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def uid(prefix):
    return prefix + '-' + secrets.token_hex(6).upper()


def require(condition, message, status=400):
    if not condition:
        raise APIError(message, status)


class APIError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


def mail(email, subject, body):
    message_id = uid('MAIL')
    status = 'preview' if DEMO else 'pending'
    with connect() as db:
        db.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)', (message_id, email, subject, body, status, time.time()))
    if not DEMO:
        try:
            msg = EmailMessage()
            msg['From'] = os.environ['SMTP_FROM']
            msg['To'] = email
            msg['Subject'] = subject
            msg.set_content(body)
            with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=15) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
                smtp.send_message(msg)
            status = 'sent'
        except (OSError, smtplib.SMTPException, KeyError):
            status = 'failed'
        with connect() as db:
            db.execute('UPDATE messages SET status=? WHERE id=?', (status, message_id))
    return status


def receipt(order):
    d = order['data']
    items = ', '.join(x['model'] for x in d.get('devices', [])) or d.get('item_name', '')
    return (f"ByteBack {'DEMO — no physical fulfillment' if DEMO else 'order receipt'}\n\n"
            f"Receipt: {order['id']}\nStatus: {order['status']}\nDevices: {items}\n"
            f"Method: {d.get('method', 'Campus pickup')}\n"
            f"Location: {DROP}\n"
            f"Amount due at pickup: ${d.get('price', 0)}\n"
            f"Pickup pass: {d.get('pass', 'Not applicable')}\n"
            f"Shipping label: {d.get('label_url', 'Available in your dashboard after generation')}\n\n"
            f"View your order: {ORIGIN}/app.html#orders\n"
            "This is an order acknowledgement, not a tax deduction receipt. No payment was collected online.")


def unpack(row):
    result = dict(row)
    result['data'] = json.loads(result['data'])
    result.pop('request_key', None)
    return result


def save_order(db, order):
    db.execute('UPDATE orders SET status=?,data=? WHERE id=?', (order['status'], json.dumps(order['data']), order['id']))


def history(order, text):
    order['data'].setdefault('history', []).append({'status': text, 'at': time.time()})


def provider(path, data=None):
    key = os.getenv('EASYPOST_API_KEY', '')
    require(key, 'Shipping is not configured. Contact the project organizer or choose drop-off.', 503)
    auth = base64.b64encode((key + ':').encode()).decode()
    req = urllib.request.Request('https://api.easypost.com/v2/' + path,
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError):
        raise APIError('The shipping service could not complete this request. Your order is saved; retry from its dashboard.', 502)


def valid_address(value):
    require(isinstance(value, dict), 'Enter a shipping address.')
    clean = {}
    for key in ['name', 'street1', 'street2', 'city', 'state', 'zip']:
        clean[key] = str(value.get(key, '')).strip()[:150]
    require(all(clean[k] for k in ['name', 'street1', 'city', 'state', 'zip']), 'Complete all required address fields.')
    clean['state'] = clean['state'].upper()
    require(clean['state'] in 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(), 'Select a valid US state.')
    require(re.fullmatch(r'\d{5}(-\d{4})?', clean['zip']), 'Enter a valid US ZIP code.')
    clean['country'] = 'US'
    return clean


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        # Never log authentication tokens or personal data in request URLs.
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.easypost.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
        super().end_headers()

    def send_json(self, obj, status=200, cookie=None):
        raw = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(raw)

    def session(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie', ''))
            token = cookies['byteback'].value if 'byteback' in cookies else ''
        except Exception:
            token = ''
        with connect() as db:
            row = db.execute('SELECT * FROM sessions WHERE hash=? AND expires>?', (digest(token), time.time())).fetchone()
        require(row, 'Sign in to continue.', 401)
        return dict(row)

    def rate_limit(self, key, limit=8):
        with connect() as db:
            db.execute('DELETE FROM throttles WHERE expires<?', (time.time(),))
            row = db.execute('SELECT count FROM throttles WHERE key=?', (key,)).fetchone()
            require(not row or row['count'] < limit, 'Too many attempts. Please try again in 15 minutes.', 429)
            db.execute('INSERT INTO throttles VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, time.time() + 900))

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/'):
            return self.dispatch('GET', path)
        allowed = {'/', '/index.html', '/app.html', '/styles.css', '/script.js', '/app.css', '/app.js', '/qr.js'}
        # Explicit allowlist: never serve .env, SQLite, source files, or .git.
        if path not in allowed and path not in {'/assets/' + p.name for p in (ROOT / 'assets').iterdir() if p.is_file()}:
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        allowed = {'/', '/index.html', '/app.html', '/styles.css', '/script.js', '/app.css', '/app.js', '/qr.js'}
        if path not in allowed and path not in {'/assets/' + p.name for p in (ROOT / 'assets').iterdir() if p.is_file()}:
            return self.send_error(404)
        super().do_HEAD()

    def do_POST(self):
        self.dispatch('POST', urlsplit(self.path).path)

    def dispatch(self, method, path):
        try:
            data = {}
            if method == 'POST':
                require(self.headers.get('Origin') == ORIGIN, 'Unrecognized request origin.', 403)
                size = int(self.headers.get('Content-Length', 0))
                require(0 < size <= 65536, 'Request is too large or empty.', 413)
                data = json.loads(self.rfile.read(size))
                require(isinstance(data, dict), 'Invalid request.')
            result = self.api(method, path, data)
            if result is not None:
                self.send_json(result)
        except APIError as error:
            self.send_json({'error': str(error)}, error.status)
        except (ValueError, TypeError, KeyError):
            self.send_json({'error': 'Invalid request fields.'}, 400)
        except Exception as error:
            print('Request failed:', type(error).__name__, flush=True)
            self.send_json({'error': 'Something went wrong. Your saved orders are still available. Please retry.'}, 500)

    def api(self, method, path, data):
        if method == 'GET' and path == '/api/config':
            return {'demo': DEMO, 'dropoff': DROP, 'stages': STAGES, 'shipping': DEMO or bool(os.getenv('EASYPOST_API_KEY'))}
        if method == 'GET' and path == '/api/catalog':
            with connect() as db:
                return {'items': [dict(r) for r in db.execute("SELECT * FROM inventory WHERE state='available' AND (? OR id NOT LIKE 'demo-%')", (DEMO,))]}
        if method == 'POST' and path == '/api/auth/request':
            self.rate_limit('login-ip:' + self.client_address[0], 30)
            email = str(data.get('email', '')).strip().lower()
            require(len(email) <= 254 and re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email), 'Enter a valid email address.')
            self.rate_limit('login-email:' + digest(email))
            token = secrets.token_urlsafe(32)
            with connect() as db:
                db.execute('DELETE FROM links WHERE email=? OR expires<?', (email, time.time()))
                db.execute('INSERT INTO links VALUES (?,?,?)', (digest(token), email, time.time() + 900))
            link = ORIGIN + '/app.html#verify=' + token
            status = mail(email, 'Your ByteBack sign-in link', f'Sign in: {link}\n\nThis link expires in 15 minutes and can be used once. Ignore it if you did not request it.')
            require(status != 'failed', 'Email delivery failed. Please contact the organizer or retry later.', 503)
            return {'message': 'Your sign-in link is ready in the local preview.' if DEMO else 'Check your email for a sign-in link.', 'demo_link': link if DEMO else None}
        if method == 'POST' and path == '/api/auth/verify':
            self.rate_limit('verify:' + self.client_address[0], 40)
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT * FROM links WHERE hash=? AND expires>?', (digest(str(data.get('token', ''))), time.time())).fetchone()
                require(row, 'This link has expired or has already been used. Request a new link.', 401)
                db.execute('DELETE FROM links WHERE hash=?', (row['hash'],))
                token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
                db.execute('INSERT INTO sessions VALUES (?,?,?,?)', (digest(token), row['email'], time.time() + 86400, csrf))
            self.send_json({'email': row['email'], 'csrf': csrf, 'admin': row['email'] in ADMINS}, cookie=self.cookie(token))
            return None
        user = self.session()
        if method == 'POST':
            require(hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), user['csrf']), 'Refresh the page and try again.', 403)
        if path == '/api/me' and method == 'GET':
            return {'email': user['email'], 'csrf': user['csrf'], 'admin': user['email'] in ADMINS}
        if path == '/api/logout' and method == 'POST':
            with connect() as db:
                db.execute('DELETE FROM sessions WHERE hash=?', (user['hash'],))
            self.send_json({'ok': True}, cookie=self.cookie('', 0))
            return None
        if path == '/api/messages' and method == 'GET':
            with connect() as db:
                return {'messages': [dict(r) for r in db.execute("SELECT * FROM messages WHERE email=? AND subject != 'Your ByteBack sign-in link' ORDER BY created DESC", (user['email'],))]}
        if path == '/api/orders' and method == 'GET':
            with connect() as db:
                return {'orders': [unpack(r) for r in db.execute('SELECT * FROM orders WHERE email=? ORDER BY created DESC', (user['email'],))]}
        if path == '/api/admin/orders' and method == 'GET':
            require(user['email'] in ADMINS, 'Organizer access required.', 403)
            with connect() as db:
                return {'orders': [unpack(r) for r in db.execute('SELECT * FROM orders ORDER BY created DESC')]}
        if path == '/api/orders' and method == 'POST':
            return self.create_order(user, data)
        match = re.fullmatch(r'/api/orders/(BB-[A-F0-9]{12})/([a-z]+)', path)
        require(match and method == 'POST', 'Not found.', 404)
        order_id, action = match.groups()
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
            require(row and (row['email'] == user['email'] or user['email'] in ADMINS), 'Order not found.', 404)
            order = unpack(row)
            d = order['data']
            if action == 'cancel':
                require(order['status'] in ['Submitted', 'Reserved'], 'This order can no longer be cancelled online.')
                require(not d.get('shipment_id'), 'A shipping label has been requested. Contact the organizer to void postage before cancellation.')
                order['status'] = 'Cancelled'
                history(order, 'Cancelled')
                if order['kind'] == 'reservation':
                    db.execute("UPDATE inventory SET state='available' WHERE id=?", (d['item_id'],))
            elif action == 'edit':
                require(order['status'] in ['Submitted', 'Reserved'] and not d.get('shipment_id'), 'Editing closes when processing or shipping begins.')
                d['notes'] = str(data.get('notes', '')).strip()[:1000]
                if d.get('method') == 'shipping':
                    d['address'] = valid_address(data.get('address'))
                history(order, 'Details updated')
            elif action == 'advance':
                require(DEMO or user['email'] in ADMINS, 'Only the organizer can update processing status.', 403)
                require(order['status'] not in ['Cancelled', 'Collected'], 'This order is closed.')
                if order['kind'] == 'donation':
                    require(order['status'] != 'Ready for student', 'A student must reserve and collect the computer to complete this donation.')
                    order['status'] = STAGES[STAGES.index(order['status']) + 1]
                    if order['status'] == 'Ready for student':
                        for i, device in enumerate(d['devices']):
                            db.execute('INSERT OR IGNORE INTO inventory VALUES (?,?,?,?,?,?)',
                                       (order_id + '-' + str(i), device['model'], device['type'] + ' · Refurbished · Inspected and data wiped', 0, order_id, 'available'))
                else:
                    order['status'] = 'Collected'
                    db.execute("UPDATE inventory SET state='collected' WHERE id=?", (d['item_id'],))
                    item = db.execute('SELECT * FROM inventory WHERE id=?', (d['item_id'],)).fetchone()
                    donor = db.execute('SELECT * FROM orders WHERE id=?', (item['source'],)).fetchone()
                    if donor:
                        donor = unpack(donor)
                        donor['data']['points'] = donor['data'].get('points', 0) + 100
                        remaining = db.execute("SELECT count(*) FROM inventory WHERE source=? AND state!='collected'", (donor['id'],)).fetchone()[0]
                        if not remaining:
                            donor['status'] = 'Collected'
                        history(donor, 'A student collected a device · 100 community points earned')
                        save_order(db, donor)
                history(order, order['status'])
            elif action == 'label':
                require(order['kind'] == 'donation' and d['method'] == 'shipping' and order['status'] == 'Submitted', 'Shipping labels are only available for unprocessed shipping donations.')
                if not d.get('label_url'):
                    if DEMO:
                        d['label_url'] = 'demo'
                        d['tracking'] = 'DEMO-' + order_id
                        d['carrier_status'] = 'pre_transit'
                    else:
                        # Persist shipment ID before buying. Retrying retrieves the same shipment,
                        # so an ambiguous purchase timeout cannot create a second label.
                        if not d.get('shipment_id'):
                            destination = json.loads(os.getenv('SHIP_TO_JSON', '{}'))
                            require(destination.get('street1'), 'The organizer must configure a receiving address.', 503)
                            verified = provider('addresses', {'address': d['address'], 'verify': ['delivery']})
                            require(verified.get('verifications', {}).get('delivery', {}).get('success'), 'The carrier could not verify this address. Edit it and try again.')
                            shipment = provider('shipments', {'shipment': {'from_address': {'id': verified['id']}, 'to_address': destination, 'parcel': d['parcel'], 'options': {'label_format': 'PDF'}}})
                            d['shipment_id'] = shipment['id']
                            save_order(db, order)
                            db.commit()
                        shipment = provider('shipments/' + d['shipment_id'])
                        if not shipment.get('postage_label'):
                            rates = [r for r in shipment.get('rates', []) if r['carrier'] in ['USPS', 'FedEx'] and r.get('currency') == 'USD']
                            require(rates, 'No USPS or FedEx service is available for this package.')
                            rate = min(rates, key=lambda r: float(r['rate']))
                            require(float(rate['rate']) <= float(os.getenv('MAX_LABEL_USD', '25')), 'Postage exceeds the organizer’s spending limit. Contact the organizer.')
                            shipment = provider('shipments/' + d['shipment_id'] + '/buy', {'rate': {'id': rate['id']}})
                        d['label_url'] = shipment['postage_label']['label_url']
                        d['label_mode'] = shipment.get('mode', 'test')
                        d['tracking'] = shipment.get('tracking_code', '')
                        d['tracker_id'] = shipment.get('tracker', {}).get('id')
                        d['carrier_status'] = shipment.get('tracker', {}).get('status', 'pre_transit')
                    history(order, 'Shipping label generated')
            elif action == 'track':
                if d.get('tracker_id') and not DEMO and time.time() - d.get('last_sync', 0) > 60:
                    tracker = provider('trackers/' + d['tracker_id'])
                    d['carrier_status'] = tracker['status']
                    d['last_sync'] = time.time()
            elif action != 'receipt':
                raise APIError('Unknown action.', 404)
            save_order(db, order)
        if action != 'track':
            email_status = mail(order['email'], 'ByteBack ' + action + ' · ' + order_id, receipt(order))
        else:
            email_status = None
        return {'order': order, 'email_status': email_status}

    def create_order(self, user, data):
        key = str(data.get('request_key', ''))
        require(re.fullmatch(r'[a-zA-Z0-9-]{10,100}', key), 'Missing submission identifier. Refresh and try again.')
        key = user['email'] + ':' + key
        kind = data.get('kind')
        require(kind in ['donation', 'reservation'], 'Select an order type.')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT * FROM orders WHERE request_key=?', (key,)).fetchone()
            if existing:
                return {'order': unpack(existing), 'email_status': 'already created'}
            d = {'notes': str(data.get('notes', ''))[:1000], 'history': [], 'points': 0}
            if kind == 'donation':
                devices = data.get('devices')
                require(isinstance(devices, list) and 1 <= len(devices) <= 10, 'Add between 1 and 10 devices.')
                clean = []
                for device in devices:
                    require(device.get('type') in TYPES and device.get('condition') in ['Working', 'Needs repair', 'Not powering on'], 'Select device type and condition.')
                    model = str(device.get('model', '')).strip()
                    require(2 <= len(model) <= 100, 'Enter a model name (2–100 characters).')
                    require(device.get('safe') is True, 'Devices with damaged or swollen batteries cannot be accepted.')
                    clean.append({'type': device['type'], 'model': model, 'condition': device['condition'], 'charger': bool(device.get('charger')), 'safe': True})
                require(data.get('pledge') is True, 'Accept the backup, account removal, and data wipe pledge.')
                method = data.get('method')
                require(method in ['dropoff', 'shipping'], 'Select a delivery method.')
                d.update({'devices': clean, 'method': method, 'pledge': True, 'pass': uid('DROP')})
                if method == 'shipping':
                    d['address'] = valid_address(data.get('address'))
                    parcel = data.get('parcel', {})
                    d['parcel'] = {k: float(parcel.get(k, 0)) for k in ['length', 'width', 'height', 'weight']}
                    require(all(0 < v <= 108 for k, v in d['parcel'].items() if k != 'weight') and 0 < d['parcel']['weight'] <= 1120, 'Enter package dimensions (1–108 inches) and weight (1–1120 ounces).')
                status = 'Submitted'
            else:
                item = db.execute("SELECT * FROM inventory WHERE id=? AND state='available' AND (? OR id NOT LIKE 'demo-%')", (str(data.get('item_id', '')), DEMO)).fetchone()
                require(item, 'This computer was just reserved. Please choose another.', 409)
                require(item['source'] not in [r[0] for r in db.execute('SELECT id FROM orders WHERE email=?', (user['email'],))], 'Choose a computer donated by someone else.')
                require(data.get('student') is True, 'Confirm you are a Provo-area college student.')
                d.update({'item_id': item['id'], 'item_name': item['name'], 'price': item['price'], 'pass': uid('PICK'), 'method': 'Campus pickup'})
                db.execute("UPDATE inventory SET state='reserved' WHERE id=?", (item['id'],))
                status = 'Reserved'
            order = {'id': uid('BB'), 'email': user['email'], 'kind': kind, 'status': status, 'data': d, 'created': time.time()}
            history(order, status)
            db.execute('INSERT INTO orders VALUES (?,?,?,?,?,?,?)', (order['id'], user['email'], kind, status, json.dumps(d), order['created'], key))
        return {'order': order, 'email_status': mail(user['email'], 'ByteBack receipt · ' + order['id'], receipt(order))}

    def cookie(self, token, age=86400):
        return f'byteback={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={age}' + ('; Secure' if ORIGIN.startswith('https://') else '')


if __name__ == '__main__':
    if not DEMO:
        missing = [key for key in ['SMTP_HOST', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'ADMIN_EMAILS', 'DROPOFF_DESCRIPTION'] if not os.getenv(key)]
        if missing or not ORIGIN.startswith('https://'):
            raise SystemExit('Live mode requires HTTPS PUBLIC_URL and: ' + ', '.join(missing))
    init_db()
    host = '127.0.0.1' if DEMO else os.getenv('HOST', '127.0.0.1')
    print(f'ByteBack: {ORIGIN}/app.html — {"LOCAL DEMO" if DEMO else "LIVE"}', flush=True)
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()
