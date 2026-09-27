"""Integration tests against a real HTTP server and isolated SQLite database."""
import concurrent.futures
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class Client:
    def __init__(self, port):
        self.port = port
        self.cookie = ''
        self.csrf = ''

    def request(self, method, path, data=None, **headers):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        standard = {'Origin': server.ORIGIN, 'Cookie': self.cookie, 'X-CSRF-Token': self.csrf}
        standard.update(headers)
        connection.request(method, path, json.dumps(data) if data is not None else None, standard)
        response = connection.getresponse()
        if response.getheader('Set-Cookie'):
            self.cookie = response.getheader('Set-Cookie').split(';')[0]
        raw = response.read()
        status = response.status
        connection.close()
        try:
            return status, json.loads(raw)
        except ValueError:
            return status, raw.decode()

    def login(self, email):
        status, result = self.request('POST', '/api/auth/request', {'email': email})
        assert status == 200, result
        token = result['demo_link'].split('verify=')[1]
        status, result = self.request('POST', '/api/auth/verify', {'token': token})
        assert status == 200, result
        self.csrf = result['csrf']
        return token


class MVPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = str(Path(cls.temp.name) / 'test.db')
        server.DEMO = True
        server.init_db()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.http.server_port
        server.ORIGIN = f'http://localhost:{cls.port}'
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()

    def setUp(self):
        with server.connect() as db:
            for table in ['orders', 'sessions', 'messages', 'links', 'throttles', 'inventory']:
                db.execute('DELETE FROM ' + table)
        server.init_db()
        self.alice = Client(self.port)
        self.bob = Client(self.port)
        self.token = self.alice.login('alice@example.com')
        self.bob.login('bob@example.com')

    def donation(self, client=None, **changes):
        payload = {'kind': 'donation', 'request_key': 'request-123456789', 'method': 'dropoff', 'pledge': True,
                   'devices': [{'type': 'Laptop', 'model': 'ThinkPad T480', 'condition': 'Working', 'safe': True, 'charger': True}]}
        payload.update(changes)
        return (client or self.alice).request('POST', '/api/orders', payload)

    def test_auth_single_use_and_access_controls(self):
        self.assertEqual(self.alice.request('POST', '/api/auth/verify', {'token': self.token})[0], 401)
        self.assertEqual(Client(self.port).request('GET', '/api/orders')[0], 401)
        self.assertEqual(self.alice.request('POST', '/api/logout', {}, **{'X-CSRF-Token': 'bad'})[0], 403)
        self.assertEqual(self.alice.request('POST', '/api/logout', {}, Origin='https://evil.example')[0], 403)
        self.assertEqual(self.alice.request('POST', '/api/logout', {})[0], 200)
        self.assertEqual(self.alice.request('GET', '/api/me')[0], 401)

    def test_private_files_are_never_served(self):
        for path in ['/.env', '/.data/byteback.sqlite3', '/server.py', '/.git/config', '/assets/../server.py', '/%2eenv']:
            self.assertEqual(self.alice.request('GET', path)[0], 404, path)
        for path in ['/', '/app.html', '/app.js', '/app.css']:
            self.assertEqual(self.alice.request('GET', path)[0], 200, path)

    def test_validation_and_idempotency(self):
        self.assertEqual(self.donation(pledge=False)[0], 400)
        self.assertEqual(self.donation(devices=[])[0], 400)
        self.assertEqual(self.donation(devices=[{'type':'Laptop','model':'Broken','condition':'Working','safe':False}])[0], 400)
        status, first = self.donation()
        self.assertEqual(status, 200)
        self.assertEqual(self.donation()[1]['order']['id'], first['order']['id'])
        self.assertEqual(len(self.alice.request('GET', '/api/orders')[1]['orders']), 1)
        self.assertEqual(len(self.alice.request('GET', '/api/messages')[1]['messages']), 1)
        self.assertEqual(self.bob.request('POST', '/api/orders/'+first['order']['id']+'/cancel', {})[0], 404)
        self.assertEqual(self.bob.request('GET', '/api/orders')[1]['orders'], [])

    def test_full_donor_student_handoff_and_incentive(self):
        order = self.donation()[1]['order']
        path = '/api/orders/' + order['id']
        for expected in server.STAGES[1:5]:
            status, result = self.alice.request('POST', path+'/advance', {})
            self.assertEqual((status, result['order']['status']), (200, expected))
        self.assertEqual(self.alice.request('POST', path+'/cancel', {})[0], 400)
        self.assertEqual(self.alice.request('POST', path+'/advance', {})[0], 400)
        item = next(i for i in self.bob.request('GET', '/api/catalog')[1]['items'] if i['source']==order['id'])
        reservation = {'kind':'reservation', 'request_key':'student-reservation-123', 'student':True, 'item_id':item['id']}
        self.assertEqual(self.alice.request('POST','/api/orders',reservation)[0], 400)
        status, result = self.bob.request('POST','/api/orders',reservation)
        self.assertEqual(status, 200)
        self.assertEqual(self.alice.request('GET','/api/orders')[1]['orders'][0]['data']['points'], 0)
        pickup = '/api/orders/'+result['order']['id']+'/advance'
        self.assertEqual(self.bob.request('POST',pickup,{})[0], 200)
        self.assertEqual(self.bob.request('POST',pickup,{})[0], 400)
        donor = self.alice.request('GET','/api/orders')[1]['orders'][0]
        self.assertEqual((donor['status'], donor['data']['points']), ('Collected',100))

    def test_concurrent_reservation_and_cancellation_restock(self):
        data = {'kind':'reservation','request_key':'race-reservation-123','student':True,'item_id':'demo-dell'}
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results = list(pool.map(lambda c: c.request('POST','/api/orders',data), [self.alice,self.bob]))
        self.assertEqual(sorted(r[0] for r in results), [200,409])
        index = next(i for i,r in enumerate(results) if r[0]==200)
        client = [self.alice,self.bob][index]
        order_id = results[index][1]['order']['id']
        self.assertEqual(client.request('POST','/api/orders/'+order_id+'/cancel',{})[0],200)
        self.assertIn('demo-dell', [i['id'] for i in client.request('GET','/api/catalog')[1]['items']])

    def test_shipping_labels_address_edit_and_receipts(self):
        address = {'name':'Alice','street1':'123 Test Lane','city':'Provo','state':'UT','zip':'84601'}
        parcel = {'length':16,'width':12,'height':4,'weight':80}
        self.assertEqual(self.donation(method='shipping',address={**address,'zip':'bad'},parcel=parcel)[0],400)
        status,result = self.donation(method='shipping',address=address,parcel=parcel)
        self.assertEqual(status,200)
        path = '/api/orders/'+result['order']['id']
        self.assertEqual(self.alice.request('POST',path+'/edit',{'address':address,'notes':'New note'})[0],200)
        status,result = self.alice.request('POST',path+'/label',{})
        self.assertEqual((status,result['order']['data']['label_url']), (200,'demo'))
        self.assertEqual(self.alice.request('POST',path+'/label',{})[1]['order']['data']['tracking'],result['order']['data']['tracking'])
        self.assertEqual(self.alice.request('POST',path+'/receipt',{})[1]['email_status'],'preview')

    def test_live_authorization_blocks_user_status_updates(self):
        order = self.donation()[1]['order']
        with patch.object(server, 'DEMO', False):
            self.assertEqual(self.alice.request('POST','/api/orders/'+order['id']+'/advance',{})[0],403)
            self.assertEqual(self.alice.request('GET','/api/admin/orders')[0],403)
            self.assertEqual(self.alice.request('GET','/api/catalog')[1]['items'],[])

    def test_expired_link_is_rejected(self):
        _, result = self.alice.request('POST', '/api/auth/request', {'email':'expired@example.com'})
        token = result['demo_link'].split('verify=')[1]
        with server.connect() as db:
            db.execute('UPDATE links SET expires=0')
        self.assertEqual(self.alice.request('POST','/api/auth/verify',{'token':token})[0],401)

    def test_receipt_failure_preserves_order(self):
        with patch.object(server, 'mail', return_value='failed'):
            status, result = self.donation()
        self.assertEqual((status, result['email_status']), (200, 'failed'))
        self.assertEqual(self.alice.request('GET','/api/orders')[1]['orders'][0]['id'],result['order']['id'])

    def test_carrier_purchase_timeout_reuses_shipment(self):
        address = {'name':'Alice','street1':'123 Test Lane','city':'Provo','state':'UT','zip':'84601'}
        parcel = {'length':16,'width':12,'height':4,'weight':80}
        _, result = self.donation(method='shipping',address=address,parcel=parcel)
        path = '/api/orders/'+result['order']['id']
        rates = {'id':'shp_test','rates':[{'id':'rate_test','carrier':'USPS','rate':'8.50','currency':'USD'}]}
        provider_responses = [
            {'id':'adr_test','verifications':{'delivery':{'success':True}}},
            rates, rates,
            server.APIError('Provider timed out',502),
        ]
        with patch.object(server, 'DEMO', False), patch.dict(server.os.environ, {'SHIP_TO_JSON':json.dumps(address)}), patch.object(server, 'provider', side_effect=provider_responses) as mock:
            self.assertEqual(self.alice.request('POST',path+'/label',{})[0],502)
            self.assertEqual(mock.call_count,4)
        saved = self.alice.request('GET','/api/orders')[1]['orders'][0]
        self.assertEqual(saved['data']['shipment_id'],'shp_test')
        self.assertEqual(self.alice.request('POST',path+'/cancel',{})[0],400)
        purchased = {'id':'shp_test','mode':'test','postage_label':{'label_url':'https://easypost.com/test.pdf'},'tracking_code':'TEST123','tracker':{'id':'trk_test','status':'pre_transit'}}
        with patch.object(server, 'DEMO', False), patch.object(server, 'provider', return_value=purchased) as mock, patch.object(server,'mail',return_value='sent'):
            status, result = self.alice.request('POST',path+'/label',{})
            self.assertEqual(status,200)
            self.assertEqual(result['order']['data']['label_mode'],'test')
            mock.assert_called_once_with('shipments/shp_test')


if __name__ == '__main__':
    unittest.main(verbosity=2)
