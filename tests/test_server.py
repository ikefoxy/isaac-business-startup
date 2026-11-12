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
            for table in ['orders', 'sessions', 'messages', 'links', 'throttles', 'inventory', 'rewards']:
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
        for path in ['/', '/app.html', '/app.js', '/app.css', '/playbook.html', '/playbook.css', '/playbook.js']:
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

    def test_storefront_metadata_and_restart_preserves_reservations(self):
        status, result = self.alice.request('GET', '/api/catalog?limit=48')
        self.assertEqual(status, 200)
        items = result['items']
        self.assertTrue({'Apple', 'Dell', 'Lenovo', 'HP', 'ASUS', 'Acer', 'Microsoft'} <= {p['brand'] for p in items})
        self.assertTrue({'macOS', 'Windows', 'Linux'} <= {p['os'] for p in items})
        self.assertTrue({'Intel', 'AMD', 'Apple silicon'} <= {p['cpu'] for p in items})
        self.assertIn('NVIDIA', {p['gpu'] for p in items})
        for p in items:
            self.assertTrue((server.ROOT / p['photo']).is_file())
        status, _ = self.alice.request('POST', '/api/orders', {
            'kind':'reservation', 'item_id':'demo-asus', 'student':True,
            'request_key':'storefront-restart-check'})
        self.assertEqual(status, 200)
        server.init_db()
        available = self.alice.request('GET', '/api/catalog?limit=48')[1]['items']
        self.assertNotIn('demo-asus', {p['id'] for p in available})
        with patch.object(server, 'DEMO', False):
            self.assertFalse(self.alice.request('GET', '/api/catalog?limit=48')[1]['items'])

    def test_full_donor_student_handoff_and_incentive(self):
        order = self.donation()[1]['order']
        path = '/api/orders/' + order['id']
        for expected in server.STAGES[1:5]:
            status, result = self.alice.request('POST', path+'/advance', {})
            self.assertEqual((status, result['order']['status']), (200, expected))
        self.assertEqual(self.alice.request('POST', path+'/cancel', {})[0], 400)
        self.assertEqual(self.alice.request('POST', path+'/advance', {})[0], 400)
        item = next(i for i in self.bob.request('GET', '/api/catalog?limit=48')[1]['items'] if i['source']==order['id'])
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
        self.assertIn('demo-dell', [i['id'] for i in client.request('GET','/api/catalog?limit=48')[1]['items']])

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
            self.assertEqual(self.alice.request('GET','/api/catalog?limit=48')[1]['items'],[])

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

    def earn_reward(self, choice='keep'):
        _, result = self.donation(reward_choice=choice, first_name='Alex', student_note='Good luck this semester!')
        order_id = result['order']['id']
        for _ in range(4):
            self.assertEqual(self.alice.request('POST', '/api/orders/'+order_id+'/advance', {})[0], 200)
        item = next(i for i in self.bob.request('GET','/api/catalog?limit=48')[1]['items'] if i['source']==order_id)
        self.assertEqual(item['donor_name'], 'Alex')
        self.assertEqual(item['student_note'], 'Good luck this semester!')
        self.assertEqual(self.alice.request('GET','/api/rewards')[1]['rewards'], [])
        _, result = self.bob.request('POST','/api/orders', {'kind':'reservation','request_key':'earn-reward-1234','item_id':item['id'],'student':True})
        self.assertEqual(self.bob.request('POST','/api/orders/'+result['order']['id']+'/advance',{})[0],200)
        self.assertEqual(self.bob.request('GET','/api/rewards')[1]['rewards'], [])
        rewards = self.alice.request('GET','/api/rewards')[1]['rewards']
        self.assertEqual(len(rewards),1)
        self.assertEqual(rewards[0]['amount'],20)
        return rewards[0]['code']

    def test_personal_reward_is_private_single_use_and_restored_on_cancel(self):
        code = self.earn_reward()
        payload = {'kind':'reservation','request_key':'use-reward-1234','item_id':'demo-dell','student':True,'reward_code':code}
        self.assertEqual(self.bob.request('POST','/api/orders',payload)[0],400)
        status,result = self.alice.request('POST','/api/orders',payload)
        self.assertEqual((status,result['order']['data']['price']), (200,99))
        self.assertEqual(result['order']['data']['discount'],20)
        self.assertEqual(self.alice.request('POST','/api/orders',{**payload,'request_key':'double-reward-123','item_id':'demo-ipad'})[0],400)
        self.assertEqual(self.alice.request('POST','/api/orders/'+result['order']['id']+'/cancel',{})[0],200)
        status,result = self.alice.request('POST','/api/orders',{**payload,'request_key':'retry-reward-1234'})
        self.assertEqual(status,200)
        self.assertEqual(self.alice.request('POST','/api/orders/'+result['order']['id']+'/advance',{})[0],200)
        self.assertEqual(self.alice.request('GET','/api/rewards')[1]['rewards'][0]['state'],'used')

    def test_gift_reward_can_be_used_by_friend_but_not_donor(self):
        code = self.earn_reward('gift')
        payload = {'kind':'reservation','request_key':'gift-reward-1234','item_id':'demo-ipad','student':True,'reward_code':code}
        self.assertEqual(self.alice.request('POST','/api/orders',payload)[0],400)
        status,result = self.bob.request('POST','/api/orders',payload)
        self.assertEqual((status,result['order']['data']['price']), (200,39))
        self.assertEqual(self.alice.request('GET','/api/rewards')[1]['rewards'][0]['state'],'held')

    def test_organizer_listing_price_and_specifications(self):
        _, result = self.donation()
        path = '/api/orders/'+result['order']['id']+'/advance'
        for _ in range(3):
            self.assertEqual(self.alice.request('POST',path,{})[0],200)
        self.assertEqual(self.alice.request('POST',path,{'listings':[{'price':-20}]})[0],400)
        self.assertEqual(self.alice.request('POST',path,{'listings':[{'price':79,'specs':'8 GB RAM · 256 GB SSD · Linux Mint'}]})[0],200)
        item=next(i for i in self.bob.request('GET','/api/catalog?limit=48')[1]['items'] if i['source']==result['order']['id'])
        self.assertEqual(item['price'],79)
        self.assertEqual(item['specs'],'8 GB RAM · 256 GB SSD · Linux Mint')


    def test_reward_quote_matches_confirmation_and_does_not_hold_credit(self):
        code = self.earn_reward()
        for body, expected in [({'item_id':'demo-dell'}, 200), ({'item_id':'demo-dell','reward_code':'INVALID'}, 400)]:
            self.assertEqual(self.alice.request('POST','/api/reservation-quote',body)[0], expected)
        status, quote = self.alice.request('POST','/api/reservation-quote',{'item_id':'demo-dell','reward_code':code})
        self.assertEqual(status,200)
        self.assertEqual(quote['original_price'] - quote['discount'], quote['price'])
        self.assertEqual(quote['discount'],20)
        self.assertEqual(self.alice.request('GET','/api/rewards')[1]['rewards'][0]['state'],'available')
        payload={'kind':'reservation','request_key':'quoted-reservation-123','item_id':'demo-dell','reward_code':code,'student':True,'quoted_price':quote['price']+1}
        self.assertEqual(self.alice.request('POST','/api/orders',payload)[0],409)
        status, result = self.alice.request('POST','/api/orders',{**payload,'quoted_price':quote['price']})
        self.assertEqual(status,200)
        for field in ['original_price','discount','price']:
            self.assertEqual(result['order']['data'][field],quote[field])
        self.assertEqual(self.alice.request('POST','/api/reservation-quote',{'item_id':'demo-asus','reward_code':code})[0],400)
        self.assertEqual(Client(self.port).request('POST','/api/reservation-quote',{'item_id':'demo-asus'})[0],401)
        self.assertEqual(self.alice.request('POST','/api/reservation-quote',{'item_id':'demo-asus'},**{'X-CSRF-Token':'wrong'})[0],403)

    def test_reward_quote_caps_discount_and_rejects_free_devices(self):
        code=self.earn_reward()
        with server.connect() as db:
            db.execute("UPDATE inventory SET price=10 WHERE id='demo-dell'")
            db.execute("UPDATE inventory SET price=0 WHERE id='demo-asus'")
        status,quote=self.alice.request('POST','/api/reservation-quote',{'item_id':'demo-dell','reward_code':code})
        self.assertEqual(status,200)
        self.assertEqual((quote['original_price'],quote['discount'],quote['price']),(10,10,0))
        self.assertEqual(self.alice.request('POST','/api/reservation-quote',{'item_id':'demo-asus','reward_code':code})[0],400)
        status,quote=self.alice.request('POST','/api/reservation-quote',{'item_id':'demo-asus'})
        self.assertEqual((status,quote['price']),(200,0))

    def test_gift_quote_respects_recipient_permissions(self):
        gift=self.earn_reward('gift')
        self.assertEqual(self.alice.request('POST','/api/reservation-quote',{'item_id':'demo-dell','reward_code':gift})[0],400)
        self.assertEqual(self.bob.request('POST','/api/reservation-quote',{'item_id':'demo-dell','reward_code':gift})[0],200)

    def test_recorded_inspection_survives_publication_and_legacy_is_unknown(self):
        order=self.donation()[1]['order']; path='/api/orders/'+order['id']+'/advance'
        for _ in range(3):
            self.assertEqual(self.alice.request('POST',path,{})[0],200)
        inspection={'specs':'8 GB RAM · Linux Mint','price':179,'condition':'Fair','condition_notes':'Small scratches on lid; keyboard tested.','battery_health':84,'accessories':'65W charger; no mouse'}
        self.assertEqual(self.alice.request('POST',path,{'listings':[{**inspection,'battery_health':101}]})[0],400)
        self.assertEqual(self.alice.request('POST',path,{'listings':[{**inspection,'battery_health':True}]})[0],400)
        self.assertEqual(self.alice.request('POST',path,{'listings':[inspection]})[0],200)
        item=next(p for p in self.bob.request('GET','/api/catalog?limit=48')[1]['items'] if p['source']==order['id'])
        self.assertEqual(item['inspection']['battery_health'],84)
        self.assertEqual(item['inspection']['condition'],'Fair')
        self.assertEqual(item['inspection']['accessories'],'65W charger; no mouse')
        self.assertIn('Small scratches',item['inspection']['notes'])
        # Legacy callers may publish without inspection fields, but never imply a measurement.
        legacy=self.donation(request_key='legacy-inspection-123')[1]['order']
        for _ in range(4):
            self.assertEqual(self.alice.request('POST','/api/orders/'+legacy['id']+'/advance',{})[0],200)
        unknown=next(p for p in self.bob.request('GET','/api/catalog?limit=48')[1]['items'] if p['source']==legacy['id'])
        self.assertIsNone(unknown['inspection']['battery_health'])
        self.assertEqual(unknown['inspection']['condition'],'Not recorded')



    def test_catalog_pages_are_bounded_filtered_and_disjoint(self):
        status,first=self.alice.request('GET','/api/catalog')
        self.assertEqual(status,200)
        self.assertEqual((len(first['items']),first['total'],first['page'],first['total_pages']),(6,9,1,2))
        status,second=self.alice.request('GET','/api/catalog?page=2')
        self.assertEqual(status,200)
        self.assertEqual(len(second['items']),3)
        self.assertFalse({i['id'] for i in first['items']} & {i['id'] for i in second['items']})
        all_ids={i['id'] for i in first['items']+second['items']}
        self.assertEqual(all_ids,set(server.DEMO_CATALOG))
        _,filtered=self.alice.request('GET','/api/catalog?brand=Apple&os=macOS&budget=500')
        self.assertEqual(filtered['total'],1)
        self.assertTrue(all(i['brand']=='Apple' and i['os']=='macOS' and i['price']<=500 for i in filtered['items']))
        self.assertNotIn('NVIDIA',filtered['facets']['gpu'])
        _,search=self.alice.request('GET','/api/catalog?q=thinkpad&sort=ram')
        self.assertEqual(search['total'],2)
        self.assertEqual(search['items'][0]['ram'],16)
        _,literal=self.alice.request('GET','/api/catalog?q=%25')
        self.assertEqual(literal['total'],0)
        _,empty=self.alice.request('GET','/api/catalog?brand=Apple&gpu=NVIDIA')
        self.assertEqual(empty['total'],0)
        for query in ['limit=0','limit=49','page=-1','page=no','budget=-1','sort=DROP']:
            self.assertEqual(self.alice.request('GET','/api/catalog?'+query)[0],400,query)
        _,clamped=self.alice.request('GET','/api/catalog?page=999')
        self.assertEqual(clamped['page'],2)

    def test_catalog_payload_stays_bounded_with_large_inventory(self):
        with server.connect() as db:
            for i in range(200):
                item_id='scale-'+str(i)
                db.execute('INSERT INTO inventory VALUES (?,?,?,?,?,?)',(item_id,'Scale laptop '+str(i),'8 GB RAM · Linux Mint',100+i,'Scale test','available'))
                server.put_metadata(db,item_id,{'brand':'Lenovo','os':'Linux','cpu':'Intel','gpu':'Intel','ram':8,'photo':''})
        _,page=self.alice.request('GET','/api/catalog?brand=Lenovo&os=Linux&limit=6&page=4')
        self.assertEqual(len(page['items']),6)
        self.assertGreaterEqual(page['total'],200)
        self.assertEqual(page['page'],4)
        _,largest=self.alice.request('GET','/api/catalog?limit=48')
        self.assertEqual(len(largest['items']),48)
        with server.connect() as db:
            names={row['name'] for row in db.execute("PRAGMA index_list('inventory')")}
            self.assertIn('idx_inventory_state_price',names)

    def test_health_readiness_and_private_monitoring(self):
        guest=Client(self.port)
        self.assertEqual(guest.request('GET','/api/health')[1]['status'],'ready')
        self.assertEqual(guest.request('GET','/api/ops')[0],401)
        with patch.object(server,'DEMO',False), patch.dict(server.os.environ,{'BYTEBACK_LOG_REQUESTS':'0'}):
            self.assertEqual(self.alice.request('GET','/api/ops')[0],403)
            with patch.object(server,'ADMINS',{'alice@example.com'}):
                self.assertEqual(self.alice.request('GET','/api/ops')[0],200)
        with patch.object(server,'DB',str(Path(self.temp.name)/'missing.db')):
            status,health=guest.request('GET','/api/health')
            self.assertEqual(status,503)
            self.assertEqual(health['status'],'not_ready')
            self.assertFalse((Path(self.temp.name)/'missing.db').exists())
        self.assertEqual(guest.request('GET','/api/health')[0],200)
        _,ops=self.alice.request('GET','/api/ops')
        self.assertGreater(ops['metrics']['errors'],0)
        self.assertGreater(ops['metrics']['requests'],0)
        serialized=json.dumps(ops['recent_requests'])
        self.assertNotIn('alice@example.com',serialized)
        self.assertNotIn('Cookie',serialized)
        bad=guest.request('POST','/api/auth/verify',{'token':'SECRET-TEST-TOKEN'})[1]
        self.assertTrue(bad['request_id'].startswith('REQ-'))
        _,ops=self.alice.request('GET','/api/ops')
        self.assertNotIn('SECRET-TEST-TOKEN',json.dumps(ops))

    def test_verified_backup_and_safe_restore(self):
        import recovery
        self.donation()
        with tempfile.TemporaryDirectory() as directory, patch.dict(server.os.environ,{'BYTEBACK_BACKUP_DIR':directory}):
            status,result=self.alice.request('POST','/api/ops/backup',{})
            self.assertEqual(status,200)
            backup=result['backup']
            self.assertEqual((backup['integrity'],backup['restore_drill']),('passed','passed'))
            self.assertEqual(backup['verified_records']['orders'],1)
            original=Path(directory)/(backup['id']+'.sqlite3')
            restored=Path(directory)/'restored.sqlite3'
            counts=recovery.restore_copy(original,restored)
            self.assertEqual(counts,backup['verified_records'])
            with self.assertRaises(FileExistsError):
                recovery.restore_copy(original,restored)
            self.assertEqual(self.alice.request('GET','/api/orders')[1]['orders'][0]['kind'],'donation')
            self.assertEqual(self.alice.request('GET','/.data/backups/'+original.name)[0],404)
            self.assertEqual(self.alice.request('POST','/api/ops/backup',{},**{'X-CSRF-Token':'bad'})[0],403)
            self.assertEqual(Client(self.port).request('POST','/api/ops/backup',{})[0],401)
            for _ in range(2):
                recovery.create_backup(server.DB,directory,keep=2)
            (Path(directory)/'backup-malformed.json').write_text('[]')
            (Path(directory)/'backup-incomplete.json').write_text('{"id":"backup-incomplete"}')
            self.assertEqual(len(recovery.list_backups(directory)),2)
            self.assertEqual(len(list(Path(directory).glob('backup-*.sqlite3'))),2)
            broken=Path(directory)/'broken.sqlite3'; broken.write_text('not a database')
            failed=Path(directory)/'failed-restore.sqlite3'
            with self.assertRaises(Exception):
                recovery.restore_copy(broken,failed)
            self.assertFalse(failed.exists())

    def test_backup_failure_keeps_last_verified_snapshot(self):
        import recovery
        with tempfile.TemporaryDirectory() as directory, patch.dict(server.os.environ,{'BYTEBACK_BACKUP_DIR':directory}):
            first=server.backup_once()
            with patch.object(recovery,'restore_copy',side_effect=OSError('drill failed')):
                with self.assertRaises(OSError):
                    server.backup_once()
            self.assertEqual(recovery.list_backups(directory)[0]['id'],first['id'])
            self.assertEqual(len(list(Path(directory).glob('*.partial'))),0)
            self.assertEqual(server.BACKUP_ERROR,'OSError')
            server.backup_once()
            self.assertIsNone(server.BACKUP_ERROR)

    def test_automatic_backup_worker_starts_and_can_stop(self):
        import threading
        called=threading.Event()
        with patch.object(server,'BACKUP_INTERVAL',1), patch.object(server,'backup_once',side_effect=lambda: called.set()):
            stop=server.start_backup_worker()
            self.assertTrue(called.wait(timeout=2))
            stop.set()


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
