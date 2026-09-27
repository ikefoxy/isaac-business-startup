"use strict";
(() => {
  const $ = (s) => document.querySelector(s);
  const view = $('#view');
  const modal = $('#modal');
  const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => new Date(value * 1000).toLocaleString([], {dateStyle:'medium', timeStyle:'short'});
  const key = () => crypto.randomUUID();
  const storeKey = 'byteback-donation-draft-v1';
  let config, user = null, orders = [], catalog = [], step = 1, lastOrder, route = 'donate', busy = false, renderQueued = false;
  let draft = {devices: [], method:'dropoff', address:{state:'UT'}, parcel:{}, notes:'', pledge:false, request_key:key()};
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey));
    if (saved && Array.isArray(saved.devices)) draft = {...draft, ...saved};
  } catch { /* Draft storage is optional; the server remains authoritative. */ }

  function message(text, error = false) {
    const target = $(error ? '#error' : '#notice');
    target.textContent = text;
    target.hidden = !text;
    if (error && text) {
      target.tabIndex = -1;
      target.focus({preventScroll:true});
      target.scrollIntoView({block:'center'});
    }
  }
  function clearMessages() { message(''); message('', true); }
  function saveDraft() {
    try {
      // No address or contact information is stored in localStorage.
      localStorage.setItem(storeKey, JSON.stringify({devices:draft.devices, method:draft.method, request_key:draft.request_key}));
    } catch { message('Browser draft saving is unavailable. Keep this tab open; submitted orders are still saved to your account.'); }
  }
  async function api(path, data) {
    const response = await fetch('/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? {} : {'Content-Type':'application/json', 'X-CSRF-Token':user?.csrf || ''},
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('Start the app with python3 server.py, then open http://localhost:4173/app.html. A static preview cannot run accounts or orders.'); }
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('auth/')) { user = null; updateAccount(); }
      throw new Error(result.error || 'The request could not be completed.');
    }
    return result;
  }
  function icon(type='Laptop') {
    const shapes = type === 'Desktop' ? '<rect x="5" y="2" width="26" height="19" rx="2"/><path d="M18 21v7m-7 0h14"/>' : type === 'Tablet' ? '<rect x="10" y="1" width="19" height="29" rx="3"/><path d="M18 27h3"/>' : '<rect x="6" y="3" width="27" height="20" rx="2"/><path d="M6 23 2 28h35l-4-5M16 27h7"/>';
    return `<svg class="device-icon" viewBox="0 0 40 33" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${shapes}</svg>`;
  }
  function intro(eyebrow, title, text, art=false) {
    return `<div class="app-intro"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${text}</p></div>${art ? '<img class="intro-art" src="assets/second-life.svg" alt="A laptop getting a second life">' : ''}</div>`;
  }
  function openModal(content) {
    $('#modal-body').innerHTML = content;
    if (!modal.open) modal.showModal();
  }
  function updateAccount() { $('#account').textContent = user ? user.email : 'Sign in'; }
  function signIn() {
    openModal(`<p class="eyebrow">YOUR NEXT CHAPTER</p><h2 id="modal-title">Welcome to ByteBack.</h2><p>Sign in with a one-time email link. No password to remember.</p><form id="login-form"><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required></label><button class="button" type="submit">Send sign-in link ↗</button></form><p class="small">${config.demo ? 'Local testing mode: your link appears here instead of being emailed. Use a fictional address.' : 'Your link expires in 15 minutes and can only be used once.'}</p><div id="login-result" role="status"></div>`);
  }
  function signedInOrPrompt() { if (user) return true; signIn(); return false; }
  function addressFields(address={}, prefix='') {
    const field = (name, label, placeholder='', required=true) => `<label>${label}<input name="${prefix}${name}" value="${esc(address[name] || '')}" placeholder="${placeholder}" maxlength="${name === 'state' ? 2 : 150}" ${required ? 'required' : ''} ${name === 'zip' ? 'pattern="[0-9]{5}(-[0-9]{4})?" inputmode="numeric"' : ''} ${name === 'state' ? 'pattern="[A-Za-z]{2}"' : ''}></label>`;
    return field('name', 'Full name') + field('street1', 'Street address') + field('street2', 'Apartment / unit (optional)', '', false) + `<div class="field-row">${field('city','City')}${field('state','State code','UT')}</div>` + field('zip','ZIP code','84601');
  }
  function impact() {
    const kg = draft.devices.reduce((sum, d) => sum + ({Laptop:2, Desktop:7, Tablet:.5}[d.type] || 0), 0);
    return `<aside class="app-aside"><div class="app-card"><h3>A little tech. A lot of possibility.</h3><div class="impact-item"><div class="big-number">${draft.devices.length.toString().padStart(2,'0')}</div><span class="muted small">devices in your donation</span></div><div class="impact-item"><div class="big-number">${kg.toFixed(1)} <span class="small">kg</span></div><span class="muted small">estimated device weight</span></div><small>Illustrative estimates: laptop 2 kg, desktop 7 kg, tablet 0.5 kg. Actual reuse depends on inspection.</small><p class="small">Earn 100 community points for each donated device collected by a student. Recognition only; no cash value.</p></div></aside>`;
  }
  function basket() {
    return `<div class="basket">${draft.devices.map((d,i) => `<div class="basket-item"><div><strong>${esc(d.model)}</strong><small>${esc(d.type)} · ${esc(d.condition)} · ${d.charger ? 'Charger included' : 'No charger'}</small></div><button class="text-button" type="button" data-remove="${i}" aria-label="Remove ${esc(d.model)}">Remove</button></div>`).join('')}</div>`;
  }
  function donate() {
    let content;
    if (step === 1) content = `<h2>What’s ready for a second life?</h2><p class="small">Add up to 10 devices. Working computers and repairable devices are welcome.</p><form id="device-form"><fieldset><legend>Choose a device type</legend><div class="device-types">${['Laptop','Desktop','Tablet'].map((t,i) => `<label class="device-choice">${icon(t)}<span><input name="type" type="radio" value="${t}" ${i === 0 ? 'checked' : ''}> ${t}</span></label>`).join('')}</div></fieldset><label>Brand and model<input name="model" minlength="2" maxlength="100" placeholder="e.g. Lenovo ThinkPad T480" required></label><label>Current condition<select name="condition"><option>Working</option><option>Needs repair</option><option>Not powering on</option></select></label><label class="check"><input name="charger" type="checkbox">I’ll include the charger or power cable.</label><label class="check"><input name="safe" type="checkbox" required>The battery is not swollen, leaking, damaged, or recalled. I won’t include hazardous devices.</label><button type="submit" class="button button-outline" ${draft.devices.length >= 10 ? 'disabled' : ''}>+ Add to donation</button></form>${basket()}<div class="actions"><span class="muted small">Device selection is saved in this browser.</span><button class="button push" type="button" data-next="2" ${!draft.devices.length ? 'disabled' : ''}>Continue →</button></div>`;
    else if (step === 2) content = `<h2>Choose your handoff.</h2><p class="small">${config.demo ? 'Try either method. Demo passes and labels are for classroom testing only.' : 'Drop off locally or ship with organizer-funded postage.'}</p><form id="delivery-form"><fieldset><legend>Delivery method</legend><label class="method-card check"><input type="radio" name="method" value="dropoff" ${draft.method === 'dropoff' ? 'checked' : ''}><span><strong>Campus drop-off <span class="pill">FREE</span></strong><small>${esc(config.dropoff)}</small></span></label><label class="method-card check"><input type="radio" name="method" value="shipping" ${draft.method === 'shipping' ? 'checked' : ''} ${!config.shipping ? 'disabled' : ''}><span><strong>Ship your devices <span class="pill">${config.demo ? 'TEST LABEL' : 'PREPAID'}</span></strong><small>${config.shipping ? 'Generate a label after submitting. Pack devices securely in one box.' : 'Shipping is not configured yet. Please use drop-off.'}</small></span></label></fieldset><div id="shipping-fields" ${draft.method !== 'shipping' ? 'hidden' : ''}><fieldset ${draft.method !== 'shipping' ? 'disabled' : ''}><h3>US return address</h3>${addressFields(draft.address)}<h3>Packed box dimensions</h3><p class="small">Measure the final box, including padding. Weight is in ounces (16 oz = 1 lb).</p><div class="field-row">${['length','width','height','weight'].map(k => `<label>${k[0].toUpperCase()+k.slice(1)} (${k === 'weight' ? 'oz' : 'in'})<input type="number" name="${k}" min="1" max="${k === 'weight' ? 1120 : 108}" step="0.1" value="${esc(draft.parcel[k] || '')}" required></label>`).join('')}</div><p class="small">${config.demo ? 'Demo mode checks address format only.' : 'The carrier verifies your address when the label is generated.'}</p></fieldset></div><label>Handoff notes (optional)<textarea name="notes" rows="3" maxlength="1000" placeholder="Anything we should know about your devices?">${esc(draft.notes)}</textarea></label><div class="actions"><button class="text-button" type="button" data-next="1">← Devices</button><button class="button push" type="submit">Review donation →</button></div></form>`;
    else content = `<h2>One last look.</h2><p class="small">Your devices are the start of someone else’s next chapter.</p>${basket()}<dl class="review-list"><dt>Handoff</dt><dd>${draft.method === 'shipping' ? 'Prepaid shipping' : 'Campus drop-off'}</dd><dt>${draft.method === 'shipping' ? 'Return address' : 'Location'}</dt><dd>${draft.method === 'shipping' ? esc([draft.address.name,draft.address.street1,draft.address.street2,draft.address.city,draft.address.state,draft.address.zip].filter(Boolean).join(', ')) : esc(config.dropoff)}</dd><dt>Your cost</dt><dd>$0</dd></dl><form id="donation-form"><label class="check"><input name="pledge" type="checkbox" required ${draft.pledge ? 'checked' : ''}><span><strong>My data wipe pledge.</strong> I will back up my files, sign out, and remove activation locks before handing over my devices. I authorize data erasure and understand that files cannot be recovered after wiping.</span></label><p class="small">${config.demo ? 'This creates a test donation. Do not mail or drop off real devices.' : 'The refurbishment team must verify a data wipe before making a device available to students.'}</p><div class="actions"><button class="text-button" type="button" data-next="2">← Handoff</button><button class="button push" type="submit">${user ? 'Confirm donation ↗' : 'Sign in to confirm ↗'}</button></div></form>`;
    view.innerHTML = intro('GIVE TECHNOLOGY BACK A PURPOSE', 'Your old device.<br>A new beginning.', 'Help a Provo-area college student get the tools to move forward. Start with the computer you no longer use.', true) + `<div class="app-grid"><div><ol class="stepper">${['Your devices','The handoff','Review & confirm'].map((t,i) => `<li class="${step >= i+1 ? 'active' : ''}" ${step === i+1 ? 'aria-current="step"' : ''}><span>0${i+1}</span>${t}</li>`).join('')}</ol><section class="app-card">${content}</section></div>${impact()}</div>`;
  }
  async function renderCatalog() {
    catalog = (await api('catalog')).items;
    view.innerHTML = intro('LESS COST. MORE POSSIBILITY.', 'Ready for your next chapter.', 'Reserve a refurbished computer for local pickup. Pay any listed price at pickup; no online payment is collected.', true) + `<p class="small muted">${config.demo ? 'Sample inventory for testing. Devices, availability, and prices are illustrative.' : 'Inspected and data-wiped devices, listed by the refurbishment team.'}</p><div class="catalog-toolbar"><input id="catalog-search" type="search" aria-label="Search computers" placeholder="Search by model or specifications"><select id="catalog-sort" aria-label="Sort computers"><option value="default">Recently available</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select></div><div id="catalog-results" class="catalog-grid"></div>`;
    filterCatalog();
  }
  function filterCatalog() {
    const search = $('#catalog-search').value.toLowerCase();
    const sort = $('#catalog-sort').value;
    const items = catalog.filter(i => (i.name + i.specs).toLowerCase().includes(search));
    if (sort !== 'default') items.sort((a,b) => sort === 'low' ? a.price-b.price : b.price-a.price);
    $('#catalog-results').innerHTML = items.map(i => `<article class="app-card catalog-card"><div class="catalog-art"><span class="pill">${config.demo ? 'DEMO INVENTORY' : 'REFURBISHED'}</span>${icon(/iPad|Tablet/i.test(i.name+i.specs) ? 'Tablet' : /Desktop/i.test(i.specs) ? 'Desktop' : 'Laptop')}</div><div class="catalog-details"><h2>${esc(i.name)}</h2><p>${esc(i.specs)}</p><div class="catalog-bottom"><span class="price">${i.price ? '$'+i.price : 'Free'}</span><button class="button button-outline" type="button" data-reserve="${esc(i.id)}">Reserve →</button></div></div></article>`).join('') || '<div class="empty"><h2>No computers found.</h2><p>Try a different search or check back after more devices have been refurbished.</p></div>';
  }
  function success(order, status) {
    lastOrder = order;
    route = 'success';
    history.replaceState(null, '', location.pathname+'#success');
    document.querySelectorAll('[data-route]').forEach(a=>a.removeAttribute('aria-current'));
    view.innerHTML = `<div class="app-grid"><section class="app-card"><div class="success-mark">✓</div><p class="eyebrow">A NEW CHAPTER STARTS HERE</p><h1>${order.kind === 'donation' ? 'Your donation is saved.' : 'Your computer is reserved.'}</h1><p>${order.kind === 'donation' ? 'Thank you for putting opportunity in someone else’s hands. Your next step is below.' : 'Your pickup pass is ready. Bring it when you collect your device.'}</p><dl class="review-list"><dt>Receipt ID</dt><dd>${esc(order.id)}</dd><dt>Account</dt><dd>${esc(order.email)}</dd><dt>Email receipt</dt><dd>${status === 'preview' ? 'Created in your local test inbox' : status === 'sent' ? 'Sent to your email' : status === 'failed' ? 'Delivery failed. Retry from your dashboard.' : esc(status)}</dd></dl><div class="pass">${order.data.method === 'shipping' ? 'Next: generate your shipping label below.' : esc(config.dropoff) + '<br>Pass: ' + esc(order.data.pass)}</div><p class="small">${config.demo ? 'Testing only. No physical handoff, purchase, or shipping has been arranged.' : 'Use your dashboard to review updates and pickup details.'}</p><div class="actions">${order.data.method === 'shipping' ? `<button class="button" type="button" data-action="label" data-id="${order.id}">Generate ${config.demo ? 'test' : 'prepaid'} label</button>` : `<button class="button" type="button" data-action="pass" data-id="${order.id}">View pickup / drop-off pass</button>`}<a class="button button-outline" href="#orders">Go to my dashboard →</a><button class="text-button" type="button" data-action="print" data-id="${order.id}">Print receipt</button><button class="text-button" type="button" data-action="share" data-id="${order.id}">Share the idea ↗</button></div></section><aside class="app-aside"><div class="app-card"><h3>Good things come full circle.</h3><p>We’ll record each step from handoff to student collection. Donors earn 100 community points per collected device.</p><small>Community points celebrate participation and cannot be redeemed for money.</small></div></aside></div>`;
  }
  function timeline(order) {
    if (order.status === 'Cancelled') return '<p class="muted">This order was cancelled. No further action is needed.</p>';
    const stages = order.kind === 'donation' ? config.stages : ['Reserved','Collected'];
    const current = stages.indexOf(order.status);
    return `<ol class="timeline" aria-label="Order progress">${stages.map((s,i) => `<li class="${i <= current ? 'done' : ''}" ${i === current ? 'aria-current="step"' : ''}>${esc(s)}</li>`).join('')}</ol>`;
  }
  function orderCard(order, admin=false) {
    const d = order.data;
    const canEdit = ['Submitted','Reserved'].includes(order.status) && !d.shipment_id;
    const active = !['Cancelled','Collected'].includes(order.status);
    const action = (name, label, primary=false) => `<button class="${primary ? 'button button-outline' : 'text-button'}" type="button" data-action="${name}" data-id="${order.id}">${label}</button>`;
    return `<article class="app-card order-card"><div class="order-head"><div><span class="eyebrow">${order.kind === 'donation' ? 'DONATION' : 'STUDENT RESERVATION'}</span><h3>${esc(d.devices?.map(x=>x.model).join(', ') || d.item_name)}</h3><small>${order.id} · ${date(order.created)}${admin ? ' · '+esc(order.email) : ''}</small></div><span class="pill">${esc(order.status)}</span></div>${timeline(order)}<p class="small">${d.method === 'shipping' ? 'Shipping' : esc(config.dropoff)}${d.price ? ' · $'+d.price+' due at pickup' : ''}${d.points ? ' · '+d.points+' community points earned' : ''}</p>${d.tracking ? `<p class="small">Tracking: ${esc(d.tracking)} · ${esc(d.carrier_status || 'Awaiting carrier')}</p>` : ''}${d.notes ? `<p class="small">Notes: ${esc(d.notes)}</p>` : ''}<div class="actions">${active && d.method !== 'shipping' ? action('pass','View pass',true) : ''}${order.status === 'Submitted' && d.method === 'shipping' ? action('label',d.label_url ? 'View label' : 'Generate label',true) : ''}${action('print','Print receipt')}${action('receipt','Resend receipt')}${canEdit ? action('edit','Edit details') + action('cancel','Cancel order') : ''}${active && (config.demo || admin) && order.status !== 'Ready for student' ? action('advance', (config.demo ? 'Test: ' : '') + (order.kind === 'reservation' ? 'confirm collection' : 'advance to '+config.stages[config.stages.indexOf(order.status)+1])) : ''}</div><details><summary class="text-button">View activity history</summary><ul class="event-list">${d.history.map(h=>`<li><time>${date(h.at)}</time>${esc(h.status)}</li>`).join('')}</ul></details></article>`;
  }
  async function dashboard(admin=false) {
    if (!user) {
      view.innerHTML = intro('YOUR BYTEBACK', 'Every device has a story.', 'Sign in to follow yours, view receipts, and see the difference your donations can make.') + '<div class="empty"><h2>Your dashboard is waiting.</h2><p>Your donations and reservations are securely associated with your email account.</p><button class="button" type="button" data-login>Sign in with email ↗</button></div>';
      return;
    }
    orders = (await api(admin ? 'admin/orders' : 'orders')).orders;
    view.innerHTML = intro('YOUR BYTEBACK', admin ? 'Refurbishment workspace.' : 'A little giving. A lasting impact.', admin ? 'Record verified handoffs, data wipes, refurbishment, and student collections.' : 'Your donations, reservations, and next steps, all in one place.') + `<div class="stats"><div class="stat"><strong>${orders.filter(o=>o.kind==='donation' && o.status!=='Cancelled').reduce((n,o)=>n+o.data.devices.length,0)}</strong><span>Devices pledged</span></div><div class="stat"><strong>${orders.filter(o=>o.status==='Collected').length}</strong><span>Completed orders</span></div><div class="stat"><strong>${orders.reduce((n,o)=>n+(o.data.points || 0),0)}</strong><span>Community points · no cash value</span></div></div><div class="actions"><span id="sync-status" class="small muted">Updated ${new Date().toLocaleTimeString()} · refreshes every 15 seconds</span><button class="text-button push" type="button" data-refresh>Refresh now</button>${user.admin ? `<a class="text-button" href="#${admin ? 'orders' : 'admin'}">${admin ? 'My dashboard' : 'Organizer workspace'}</a>` : ''}</div><div id="orders-list">${orders.map(o=>orderCard(o,admin)).join('') || '<div class="empty"><h2>Your first chapter starts here.</h2><p>Donate an unused device or reserve a refurbished computer for your studies.</p><a class="button" href="#donate">Donate a device ↗</a></div>'}</div>${!admin ? '<section class="app-card"><h2>'+ (config.demo ? 'Test email inbox' : 'Email receipts') +'</h2><p class="small">'+(config.demo ? 'Automatic emails appear here during local testing. Nothing is sent to an external mailbox.' : 'View copies and delivery status of your receipts. Use “Resend receipt” if delivery failed.')+'</p><div id="inbox"></div></section>' : ''}`;
    if (!admin) await inbox();
  }
  async function inbox() {
    const result = await api('messages');
    if (!$('#inbox')) return;
    $('#inbox').innerHTML = result.messages.map(m=>`<details class="email-card"><summary>${esc(m.subject)} <span class="pill">${esc(m.status)}</span></summary><p class="small">${date(m.created)} · ${esc(m.email)}</p><pre>${esc(m.body)}</pre></details>`).join('') || '<p class="small muted">Your automatic receipts will appear here.</p>';
  }
  function findOrder(id) { return orders.find(o=>o.id===id) || (lastOrder?.id===id ? lastOrder : null); }
  function receiptText(order) {
    const d = order.data;
    return `${config.demo ? 'DEMO — NOT VALID FOR SHIPPING OR PHYSICAL PICKUP\n\n' : ''}Receipt ID: ${order.id}\nDate: ${date(order.created)}\nAccount: ${order.email}\nStatus: ${order.status}\n\n${d.devices?.map(x=>`${x.model} · ${x.condition}`).join('\n') || d.item_name}\n\nHandoff: ${d.method}\n${d.method==='shipping' ? 'Return address: '+Object.values(d.address).join(', ') : config.dropoff}\nPass: ${d.pass}\nAmount due at pickup: $${d.price || 0}\n\nThis is an order acknowledgement, not a tax receipt. No payment was collected online.`;
  }
  function qr(pass) {
    if (typeof qrcode !== 'function') return '';
    const code = qrcode(0, 'M');
    code.addData(pass); code.make();
    return `<div class="qr-pass" role="img" aria-label="QR code containing pass ${esc(pass)}">${code.createSvgTag({scalable:true, margin:4})}</div>`;
  }
  function printOrder(order, label=false) {
    $('#print-area').innerHTML = `<h1>BYU ByteBack · ${label ? 'DEMO SHIPPING LABEL' : 'Order receipt'}</h1><pre>${esc(label ? 'NOT VALID FOR POSTAGE — DO NOT SHIP\n\n'+receiptText(order)+'\n\nTracking: '+order.data.tracking : receiptText(order))}</pre>${qr(order.data.pass)}`;
    window.print();
  }
  async function orderAction(action, id) {
    const order = findOrder(id);
    if (!order) throw new Error('Refresh the dashboard to load this order.');
    if (action === 'print') return printOrder(order);
    if (action === 'pass') return openModal(`<h2 id="modal-title">Your ${order.kind==='donation' ? 'drop-off' : 'pickup'} pass.</h2><p>${esc(config.dropoff)}</p>${qr(order.data.pass)}<div class="pass">${esc(order.data.pass)}</div><p class="small">${config.demo ? 'Demo pass — no physical collection is arranged.' : 'Show this code to the organizer at handoff.'}</p><button class="button" type="button" data-action="print" data-id="${id}">Print pass</button>`);
    if (action === 'share') {
      const text = 'Give technology back a purpose. Help Provo-area college students through ByteBack.';
      if (navigator.share) { try { await navigator.share({title:'ByteBack', text, url:location.origin+'/index.html'}); } catch (e) { if(e.name!=='AbortError') throw e; } }
      else { openModal(`<h2 id="modal-title">Share the idea.</h2><p>Copy this message to share with your community.</p><textarea rows="5" readonly aria-label="Share message">${esc(text + '\n' + (config.demo ? 'ByteBack is a local academic prototype.' : location.origin+'/index.html'))}</textarea>`); }
      return;
    }
    if (action === 'edit') return openModal(`<h2 id="modal-title">Update your details.</h2><form id="edit-form" data-id="${id}">${order.data.method === 'shipping' ? addressFields(order.data.address) : ''}<label>Handoff notes<textarea name="notes" rows="4" maxlength="1000">${esc(order.data.notes)}</textarea></label><button class="button" type="submit">Save changes</button></form>`);
    if (action === 'cancel' || action === 'advance') return openModal(`<h2 id="modal-title">${action === 'cancel' ? 'Cancel this order?' : 'Record the next step?'}</h2><p>${action==='cancel' ? 'Your order will be closed. Reserved inventory will become available to other students.' : config.demo ? 'This test control simulates the next verified handoff or refurbishment event.' : 'Confirm this physical step has been completed. Data wipes and refurbishment must be verified before listing devices.'}</p><button class="button" type="button" data-confirm="${action}" data-id="${id}">${action==='cancel' ? 'Yes, cancel order' : 'Confirm update'}</button>`);
    const result = await api('orders/'+id+'/'+action, {});
    lastOrder = result.order;
    orders = orders.map(o=>o.id===id ? result.order : o);
    if (action === 'label') {
      if (result.order.data.label_url === 'demo') openModal(`<h2 id="modal-title">Your test label is ready.</h2><p>This is a mock label. It is not prepaid postage and must not be used to mail devices.</p><div class="pass">${esc(result.order.data.tracking)}<br>NOT VALID FOR SHIPPING</div><button class="button" type="button" data-print-label="${id}">Print test label</button>`);
      else {
        const url = new URL(result.order.data.label_url);
        if (url.protocol !== 'https:') throw new Error('The provider returned an invalid label URL.');
        openModal(`<h2 id="modal-title">Your ${result.order.data.label_mode === 'test' ? 'carrier test' : 'prepaid'} label is ready.</h2><p>${result.order.data.label_mode === 'test' ? 'This was generated with a carrier test key. It is not valid postage; do not use it to ship devices.' : 'Print the label, pack your devices securely, and follow the carrier’s instructions for electronics and batteries.'}</p><a class="button" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Open shipping label ↗</a>`);
      }
    } else message(result.email_status === 'failed' ? 'Order saved, but email delivery failed. You can retry the receipt from your dashboard.' : action === 'receipt' ? 'Receipt '+(config.demo ? 'added to your test inbox.' : 'sent.') : 'Order updated.');
    if (route === 'orders' || route === 'admin') await dashboard(route==='admin');
  }
  async function render() {
    if (!config) return;
    clearMessages();
    const hash = location.hash.slice(1);
    if (hash.startsWith('verify=')) {
      const token = hash.slice(7);
      history.replaceState(null, '', location.pathname+'#donate');
      try { user = await api('auth/verify', {token}); updateAccount(); if(modal.open) modal.close(); message('You’re signed in. Continue your donation or visit your dashboard.'); }
      catch(e) { message(e.message,true); }
      route='donate'; donate();
    } else {
      route = ['donate','catalog','orders','admin'].includes(hash) ? hash : 'donate';
      if (route === 'donate') donate();
      if (route === 'catalog') await renderCatalog();
      if (route === 'orders' || route === 'admin') await dashboard(route==='admin');
    }
    document.querySelectorAll('[data-route]').forEach(a=>{
      if (a.dataset.route===route) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
  }
  async function guarded(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); } catch(e) {
      if(modal.open) {
        let el = $('#modal-error');
        if(!el) { el=document.createElement('p'); el.id='modal-error'; el.setAttribute('role','alert'); $('#modal-body').append(el); }
        el.textContent=e.message;
      } else message(e.message,true);
    } finally {
      busy=false;
      if(renderQueued) { renderQueued=false; guarded(render); }
    }
  }
  document.addEventListener('submit', event => {
    const form = event.target;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    const button = event.submitter;
    guarded(async () => {
      if(button) button.disabled=true;
      try {
        if(form.id==='device-form') {
          if(draft.devices.length>=10) throw new Error('You can add up to 10 devices per donation.');
          draft.devices.push({...fields, charger:!!fields.charger, safe:!!fields.safe}); saveDraft(); donate();
        } else if(form.id==='delivery-form') {
          draft.method=fields.method; draft.notes=fields.notes;
          if(draft.method==='shipping') {
            draft.address=Object.fromEntries(['name','street1','street2','city','state','zip'].map(k=>[k,fields[k]]));
            draft.parcel=Object.fromEntries(['length','width','height','weight'].map(k=>[k,Number(fields[k])]));
          }
          step=3; saveDraft(); donate(); $('#app-content').scrollIntoView();
        } else if(form.id==='donation-form') {
          draft.pledge=!!fields.pledge;
          if(!signedInOrPrompt()) return;
          const result=await api('orders',{kind:'donation',...draft});
          draft={devices:[],method:'dropoff',address:{state:'UT'},parcel:{},notes:'',pledge:false,request_key:key()}; step=1; saveDraft();
          success(result.order,result.email_status); $('#app-content').scrollIntoView();
        } else if(form.id==='login-form') {
          const result=await api('auth/request',{email:fields.email});
          $('#login-result').innerHTML=`<p>${esc(result.message)}</p>${result.demo_link ? `<a class="button" href="${esc(result.demo_link)}">Open demo sign-in link →</a>` : ''}`;
        } else if(form.id==='reserve-form') {
          const result=await api('orders',{kind:'reservation',item_id:form.dataset.id,student:!!fields.student,request_key:form.dataset.key});
          modal.close(); success(result.order,result.email_status);
        } else if(form.id==='edit-form') {
          const address=Object.fromEntries(['name','street1','street2','city','state','zip'].map(k=>[k,fields[k]]));
          await api('orders/'+form.dataset.id+'/edit',{notes:fields.notes,address}); modal.close();
          await dashboard(route==='admin'); message('Your changes are saved.');
        }
      } finally { if(button?.isConnected) button.disabled=false; }
    });
  });
  document.addEventListener('click', event => {
    const b=event.target.closest('button');
    if(!b) return;
    if(b.classList.contains('close-modal')) return modal.close();
    guarded(async()=>{
      if(b.id==='account') {
        if(!user) return signIn();
        openModal(`<h2 id="modal-title">Your account.</h2><p>Signed in as ${esc(user.email)}.</p><p class="small">Sign-in sessions last 24 hours. Your orders stay saved after signing out.</p><button class="button button-outline" type="button" data-logout>Sign out</button>`);
      } else if(b.hasAttribute('data-login')) signIn();
      else if(b.hasAttribute('data-logout')) { await api('logout',{}); user=null; orders=[]; lastOrder=null; updateAccount(); modal.close(); await render(); }
      else if(b.dataset.next) { step=Number(b.dataset.next); donate(); $('#app-content').scrollIntoView(); }
      else if(b.dataset.remove!==undefined) { draft.devices.splice(Number(b.dataset.remove),1); saveDraft(); if(!draft.devices.length) step=1; donate(); }
      else if(b.dataset.reserve) {
        if(!signedInOrPrompt()) return;
        const i=catalog.find(x=>x.id===b.dataset.reserve);
        openModal(`<h2 id="modal-title">Reserve your next chapter.</h2><h3>${esc(i.name)}</h3><p>${esc(i.specs)}</p><p><strong>${i.price ? '$'+i.price : 'Free'}</strong> · ${esc(config.dropoff)}</p><form id="reserve-form" data-id="${esc(i.id)}" data-key="${key()}"><label class="check"><input type="checkbox" name="student" required>I’m a Provo-area college student and will present my student ID at pickup.</label><p class="small">${config.demo ? 'This is a test reservation. No payment or physical pickup is arranged.' : 'No online payment. Any listed amount is due at pickup.'}</p><button class="button" type="submit">Confirm reservation ↗</button></form>`);
      } else if(b.dataset.action) await orderAction(b.dataset.action,b.dataset.id);
      else if(b.dataset.confirm) {
        const result=await api('orders/'+b.dataset.id+'/'+b.dataset.confirm,{}); modal.close();
        await dashboard(route==='admin'); message('Order '+result.order.status.toLowerCase()+'.');
      } else if(b.dataset.printLabel) printOrder(findOrder(b.dataset.printLabel),true);
      else if(b.hasAttribute('data-refresh')) await refresh();
    });
  });
  document.addEventListener('change', event=>{
    if(event.target.name==='method') {
      const shipping=event.target.value==='shipping';
      $('#shipping-fields').hidden=!shipping; $('#shipping-fields fieldset').disabled=!shipping;
    }
    if(event.target.id==='catalog-sort') filterCatalog();
  });
  document.addEventListener('input',event=>{if(event.target.id==='catalog-search') filterCatalog();});
  window.addEventListener('hashchange',()=>{
    if(busy) renderQueued=true;
    else guarded(render);
  });
  async function refresh() {
    if(!user || !['orders','admin'].includes(route)) return;
    const result=await api(route==='admin' ? 'admin/orders' : 'orders');
    for(const o of result.orders.filter(o=>o.data.tracker_id && !['Cancelled','Collected'].includes(o.status))) {
      try { const synced=await api('orders/'+o.id+'/track',{}); o.data=synced.order.data; }
      catch { message('Carrier updates are temporarily unavailable. Your last saved status is shown.',true); }
    }
    if(!['orders','admin'].includes(route)) return;
    if(JSON.stringify(orders)!==JSON.stringify(result.orders) && !modal.open) await dashboard(route==='admin');
    const status=$('#sync-status');
    if(status) status.textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes every 15 seconds';
    if(route==='orders') await inbox();
  }
  setInterval(()=>{ if(!document.hidden && !busy && !modal.open) guarded(refresh); },15000);
  guarded(async()=>{
    try { config=await api('config'); }
    catch(e) {
      $('#mode-banner').textContent='The ByteBack server is not connected.';
      view.innerHTML='<div class="empty"><h1>Start your local ByteBack app.</h1><p>In the project terminal, run <code>python3 server.py</code>, then open <a href="http://localhost:4173/app.html">http://localhost:4173/app.html</a>. Accounts and orders require this server.</p><a class="button button-outline" href="index.html">Back to the home page</a></div>';
      throw e;
    }
    $('#mode-banner').textContent=config.demo ? 'LOCAL TEST MODE · Sample devices, email previews & mock postage. No real shipments or payments.' : 'PROVO STUDENTS · Donate locally. Give technology a second life.';
    try {user=await api('me');} catch {/* Signed-out visitors can browse and prepare donations. */}
    updateAccount(); await render();
  });
})();
