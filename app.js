"use strict";
(() => {
  const $ = (s) => document.querySelector(s);
  const view = $('#view');
  const modal = $('#modal');
  const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => new Date(value * 1000).toLocaleString([], {dateStyle:'medium', timeStyle:'short'});
  const key = () => crypto.randomUUID();
  const storeKey = 'byteback-donation-draft-v1';
  let rewards = [], returnRoute = 'donate', pendingReservation = null;
  let config, user = null, orders = [], catalog = [], step = 1, lastOrder, route = 'donate', busy = false, renderQueued = false;
  let draft = {devices: [], method:'dropoff', address:{state:'UT'}, parcel:{}, notes:'', pledge:false, reward_choice:'keep', first_name:'', student_note:'', request_key:key()};
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey));
    if (saved && Array.isArray(saved.devices)) draft = {...draft, ...saved};
  } catch { /* Draft storage is optional; the server remains authoritative. */ }
  try {
    const saved=JSON.parse(sessionStorage.getItem('byteback-session-draft-v2'));
    if(saved?.draft && Array.isArray(saved.draft.devices)) {
      draft={...draft,...saved.draft};
      step=draft.devices.length ? Math.min(4,Math.max(1,Number(saved.step)||1)) : 1;
    }
  } catch { /* Session drafts are optional. */ }

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
      localStorage.setItem(storeKey, JSON.stringify({devices:draft.devices, method:draft.method, reward_choice:draft.reward_choice, request_key:draft.request_key}));
      sessionStorage.setItem('byteback-session-draft-v2',JSON.stringify({draft,step}));
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
    return `<div class="app-intro"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${text}</p></div></div>`;
  }
  function openModal(content) {
    $('#modal-body').innerHTML = content;
    if (!modal.open) modal.showModal();
  }
  function updateAccount() { $('#account').textContent = user ? 'My account' : 'Sign in'; $('#account').title = user?.email || 'Sign in with your email'; }
  function signIn() {
    if(config.static) return openModal('<h2 id="modal-title">Try reservations in the local app.</h2><p>This published preview lets you browse sample devices and inspection details. Sign-in, verified reward totals and saved reservations need the ByteBack server.</p><p>Run <code>python3 server.py</code> in the project, then open <a href="http://localhost:4173/app.html#catalog">localhost:4173/app.html#catalog</a>.</p><a class="button button-outline" href="https://github.com/ikefoxy/isaac-business-startup">Get the project ↗</a>');
    returnRoute = route === 'success' ? 'orders' : route;
    try { sessionStorage.setItem('byteback-login-context', JSON.stringify({route:returnRoute, item:pendingReservation, search:location.search})); } catch { /* In-memory context remains available. */ }
    const reservation = pendingReservation ? catalog.find(item=>item.id===pendingReservation) : null;
    openModal(`<p class="eyebrow">${reservation?'ONE STEP BEFORE YOU RESERVE':'NICE TO HAVE YOU HERE'}</p><h2 id="modal-title">${reservation?"Sign in to reserve this computer.":"Let’s save your place."}</h2><p>${reservation?`You chose ${esc(reservation.name)}. Sign in with your email, then review your price and confirm. Signing in alone does not reserve it.`:"We’ll send you a sign-in link so you can find your donation, receipts, and rewards again. No password needed."}</p><form id="login-form"><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required></label><button class="button" type="submit">Send sign-in link ↗</button></form><p class="small">${config.demo ? 'Local testing mode: your link appears here instead of being emailed. Use a fictional address.' : 'Your link expires in 15 minutes and can only be used once.'}</p><div id="login-result" role="status"></div>`);
  }
  function signedInOrPrompt() { if (user) return true; signIn(); return false; }
  function addressFields(address={}, prefix='') {
    const field = (name, label, placeholder='', required=true) => `<label>${label}<input name="${prefix}${name}" value="${esc(address[name] || '')}" placeholder="${placeholder}" maxlength="${name === 'state' ? 2 : 150}" ${required ? 'required' : ''} ${name === 'zip' ? 'pattern="[0-9]{5}(-[0-9]{4})?" inputmode="numeric"' : ''} ${name === 'state' ? 'pattern="[A-Za-z]{2}"' : ''}></label>`;
    return field('name', 'Full name') + field('street1', 'Street address') + field('street2', 'Apartment / unit (optional)', '', false) + `<div class="field-row">${field('city','City')}${field('state','State code','UT')}</div>` + field('zip','ZIP code','84601');
  }
  function impact() {
    const kg = draft.devices.reduce((sum, d) => sum + ({Laptop:2, Desktop:7, Tablet:.5}[d.type] || 0), 0);
    return `<aside class="app-aside"><div class="donation-summary"><span class="eyebrow">YOUR DONATION</span><h3>${draft.devices.length ? draft.devices.length+' device'+(draft.devices.length===1?'':'s')+', a useful second life.' : 'A little room in your drawer.'}</h3>${draft.devices.length ? `<ul class="summary-devices">${draft.devices.map(d=>`<li>${icon(d.type)}<div><strong>${esc(d.model)}</strong><span>${esc(d.condition)}</span></div></li>`).join('')}</ul>` : '<p>Add a device to see your donation here. You can include more than one.</p>'}<div class="summary-line"><span>Your cost</span><strong>$0</strong></div><div class="summary-line"><span>Estimated device weight</span><strong>${kg.toFixed(1)} kg</strong></div><small>Weight estimate only; reuse depends on inspection.</small></div><div class="side-note"><span class="note-symbol" aria-hidden="true">↻</span><h3>${step===3 ? 'A thank-you, your way.' : 'We’ll keep you in the loop.'}</h3><p>${step===3 ? 'Keep your reward for a computer later, or send it to a friend. It unlocks when a student collects your device.' : 'Your dashboard follows your device from the first handoff through its data wipe and into another student’s hands.'}</p><span class="side-signature">— the ByteBack project</span></div></aside>`;
  }
  function preserveStep() {
    const form=$('#delivery-form') || $('#reward-form');
    if(!form) return;
    const f=Object.fromEntries(new FormData(form));
    if(form.id==='reward-form') Object.assign(draft,{reward_choice:f.reward_choice,first_name:f.first_name,student_note:f.student_note});
    else {
      draft.method=f.method; draft.notes=f.notes;
      if(f.method==='shipping') {
        draft.address=Object.fromEntries(['name','street1','street2','city','state','zip'].map(k=>[k,f[k]||'']));
        draft.parcel=Object.fromEntries(['length','width','height','weight'].map(k=>[k,f[k]||'']));
      }
    }
    saveDraft();
  }
  function basket() {
    return `<div class="basket">${draft.devices.map((d,i) => `<div class="basket-item"><div><strong>${esc(d.model)}</strong><small>${esc(d.type)} · ${esc(d.condition)} · ${d.charger ? 'Charger included' : 'No charger'}</small></div><button class="text-button" type="button" data-remove="${i}" aria-label="Remove ${esc(d.model)}">Remove</button></div>`).join('')}</div>`;
  }
  function donationGuide() {
    return `<details class="donation-guide"><summary>Before you donate: who, where & what happens next</summary><div class="donation-guide-grid"><article><span>01 / WHO CAN DONATE</span><h3>A spare device? Start here.</h3><p>You don’t need to be a student to offer a laptop, desktop or tablet you own and can authorize us to erase. Tell us if it needs repair. Do not submit devices with unsafe batteries. Receiving a computer is for Provo-area college students.</p></article><article><span>02 / THE HANDOFF</span><h3>You’ll know your next step.</h3><p>Submit your donation to get a pass and the configured drop-off instructions. Back up files, sign out and remove activation locks first. If mail-in is available, pack securely and follow the label instructions. ${config.demo?'This local demo simulates the handoff; no real collection location or postage is operating.':esc(config.dropoff)}</p></article><article><span>03 / THE INSPECTION</span><h3>Check first. List second.</h3><p>The organizer records receipt, data erasure and refurbishment before listing. Check the screen, keyboard, ports, charging and connectivity; measure battery capacity where possible. Record wear, battery results and actual accessories in the listing. ${config.demo?'Demo controls simulate these steps; they do not inspect or erase hardware.':'Unmeasured details must stay marked as unmeasured.'}</p></article></div></details>`;
  }
  function priceBreakdown(price, discount=0, due=price-discount) {
    return `<dl class="price-breakdown"><div><dt>Original price</dt><dd>$${Number(price)}</dd></div><div><dt>Reward applied</dt><dd>−$${Number(discount)}</dd></div><div class="price-total"><dt>Due at pickup</dt><dd>$${Number(due)}</dd></div></dl>`;
  }
  function productDetails(id) {
    const item=catalog.find(p=>p.id===id);
    if(!item) return;
    openModal(`<div class="product-detail-view"><span class="eyebrow">${config.demo?'SAMPLE DEVICE / DEMO INSPECTION':'DEVICE DETAILS'}</span><h2 id="modal-title">${esc(item.name)}</h2>${item.photo?`<img class="detail-product-photo" src="${esc(item.photo)}" alt="${esc(item.name)} — reference photo">`:''}<p>${esc(item.specs)}</p>${window.ByteBackShop.inspectionDetails(item)}<p class="small muted">${config.demo?'Battery values, wear and accessories are sample data for this demo; reference photos are not pictures of inspected inventory.':'Read the recorded inspection details; a reference photo does not establish condition. Ask the organizer about missing information.'}</p><div class="detail-reserve"><strong>${item.price?'$'+item.price:'Free'} at pickup</strong><button type="button" class="button" data-reserve="${esc(item.id)}">${user?'Reserve this computer':'Sign in to reserve'} →</button></div><p class="small muted">No online payment. Review your reward and final total before confirming.</p></div>`);
  }
  function donate() {
    let content;
    if (step === 1) content = `<div class="form-heading"><span class="eyebrow">STEP 1 OF 4 · YOUR DEVICES</span><h2>What would you like to pass along?</h2><p>Choose a type, enter its model and condition, then tick the battery-safety box. Click “Add device to my donation” to save it below. You can repeat this for up to 10 devices.</p></div><form id="device-form"><fieldset><legend>Device type</legend><div class="device-types">${['Laptop','Desktop','Tablet'].map((t,i) => `<label class="device-choice">${icon(t)}<span><input name="type" type="radio" value="${t}" ${i === 0 ? 'checked' : ''}> ${t}</span></label>`).join('')}</div></fieldset><div class="field-row"><label>Brand and model<input name="model" minlength="2" maxlength="100" placeholder="e.g. Lenovo ThinkPad T480" required></label><label>Current condition<select name="condition"><option>Working</option><option>Needs repair</option><option>Not powering on</option></select></label></div><label class="check"><input name="charger" type="checkbox">I can include the charger or power cable.</label><label class="check"><input name="safe" type="checkbox" required>The battery is not swollen, leaking, damaged, or recalled.</label><button type="submit" class="button button-outline" ${draft.devices.length >= 10 ? 'disabled' : ''}>+ Add device to my donation</button></form>${basket()}<div class="wizard-footer"><span class="small muted">${draft.devices.length ? 'Added below. Add another, or choose your handoff.' : 'First add a device above. Then choose your handoff.'}</span><button class="button" type="button" data-next="2" ${!draft.devices.length ? 'disabled' : ''}>Choose handoff <span aria-hidden="true">→</span></button></div>`;
    else if (step === 2) content = `<div class="form-heading"><span class="eyebrow">STEP 2 OF 4 · THE HANDOFF</span><h2>How would you like to get it to us?</h2><p>Choose the option that fits your week. You’ll get your pass or label after confirming.</p></div><form id="delivery-form"><fieldset><legend>Choose a handoff method</legend><label class="method-card check"><input type="radio" name="method" value="dropoff" ${draft.method === 'dropoff' ? 'checked' : ''}><span><strong>Local drop-off <span class="pill">FREE</span></strong><small>${esc(config.dropoff)}</small></span></label><label class="method-card check"><input type="radio" name="method" value="shipping" ${draft.method === 'shipping' ? 'checked' : ''} ${!config.shipping ? 'disabled' : ''}><span><strong>Send it by mail <span class="pill">${config.demo ? 'DEMO LABEL' : 'PREPAID'}</span></strong><small>${config.shipping ? 'Print your label, pack the devices together, and drop the box with the carrier.' : 'Mail-in donations are not available yet. Please choose local drop-off.'}</small></span></label></fieldset><div id="shipping-fields" ${draft.method !== 'shipping' ? 'hidden' : ''}><fieldset ${draft.method !== 'shipping' ? 'disabled' : ''}><h3>Your return address</h3>${addressFields(draft.address)}<h3>One box, packed and ready</h3><p class="small muted">Measure the box with the padding inside. 16 ounces = 1 pound.</p><div class="field-row">${['length','width','height','weight'].map(k => `<label>${k[0].toUpperCase()+k.slice(1)} (${k === 'weight' ? 'oz' : 'in'})<input type="number" name="${k}" min="1" max="${k === 'weight' ? 1120 : 108}" step="0.1" value="${esc(draft.parcel[k] || '')}" required></label>`).join('')}</div><p class="small muted">${config.demo ? 'The demo checks address format and creates a sample label. Please don’t mail real devices.' : 'The carrier verifies your address before creating a label.'}</p></fieldset></div><label>Anything the team should know? <span class="optional">Optional</span><textarea name="notes" rows="3" maxlength="1000" placeholder="For example: the charger works, but the trackpad is a little sticky.">${esc(draft.notes)}</textarea></label><div class="wizard-footer"><button class="text-button" type="button" data-next="1">← Your devices</button><button class="button" type="submit">Choose your thank-you →</button></div></form>`;
    else if (step === 3) content = `<div class="form-heading"><span class="eyebrow">STEP 3 OF 4 · YOUR THANK-YOU</span><h2>A small thank-you.<br>Who should it go to?</h2><p>After a student collects your device, we’ll issue a code for up to $20 off one ByteBack computer.</p></div><form id="reward-form"><fieldset><legend>Choose your reward</legend><div class="reward-choices"><label class="reward-choice"><input type="radio" name="reward_choice" value="keep" ${draft.reward_choice !== 'gift' ? 'checked' : ''}><span class="reward-symbol" aria-hidden="true">↙</span><strong>Save it for me</strong><span>A little help when it’s your turn to find a computer.</span><small>$20 BYTEBACK CREDIT</small></label><label class="reward-choice"><input type="radio" name="reward_choice" value="gift" ${draft.reward_choice === 'gift' ? 'checked' : ''}><span class="reward-symbol" aria-hidden="true">↗</span><strong>Pass it to a friend</strong><span>Share your code with a student who could use it.</span><small>$20 GIFT CODE</small></label></div></fieldset><p class="reward-terms">One code per collected device. One use; no cash value or remaining balance. ${config.demo ? 'Demo credits are for testing only.' : 'Use the code when reserving a priced computer.'}</p><div class="personal-note-form"><span class="eyebrow">MAKE IT A LITTLE MORE PERSONAL</span><h3>Leave a note for the next student.</h3><p class="small muted">Optional. Your first name and note will appear with the computer in the catalog. Please leave out contact information.</p><label>Your first name <span class="optional">Optional</span><input name="first_name" maxlength="40" value="${esc(draft.first_name || '')}" placeholder="What should we call you?"></label><label>A note to pass along <span class="optional">Optional</span><textarea name="student_note" maxlength="240" rows="3" placeholder="A little encouragement, or something useful about this computer.">${esc(draft.student_note || '')}</textarea></label></div><div class="wizard-footer"><button class="text-button" type="button" data-next="2">← Handoff</button><button class="button" type="submit">Review my donation →</button></div></form>`;
    else content = `<div class="form-heading"><span class="eyebrow">STEP 4 OF 4 · REVIEW</span><h2>Does everything look right${draft.first_name ? ', '+esc(draft.first_name) : ''}?</h2><p>Check the details below. You can go back to change anything before confirming.</p></div>${basket()}<dl class="review-list"><dt>Handoff</dt><dd>${draft.method === 'shipping' ? (config.demo ? 'Shipping · demo label' : 'Prepaid shipping') : 'Local drop-off'} <button class="text-button" type="button" data-next="2">Change</button></dd><dt>${draft.method === 'shipping' ? 'Return address' : 'Location'}</dt><dd>${draft.method === 'shipping' ? esc([draft.address.name,draft.address.street1,draft.address.city,draft.address.state,draft.address.zip].filter(Boolean).join(', ')) : esc(config.dropoff)}</dd><dt>Your thank-you</dt><dd>${draft.reward_choice === 'gift' ? '$20 code to share with a friend' : '$20 credit for a future computer'} <button class="text-button" type="button" data-next="3">Change</button></dd>${draft.student_note ? `<dt>Your note</dt><dd>“${esc(draft.student_note)}”</dd>` : ''}<dt>Your cost</dt><dd><strong>$0</strong></dd></dl><form id="donation-form"><div class="pledge-panel"><h3>Before your computer leaves you</h3><p class="small muted">Back up your files, sign out of your accounts, and remove activation locks.</p><label class="check"><input name="pledge" type="checkbox" required ${draft.pledge ? 'checked' : ''}><span>I’ll prepare my devices and authorize the team to erase their data. I understand that erased files cannot be recovered.</span></label></div><p class="small muted">${config.demo ? 'This is a test donation. No physical handoff is arranged.' : 'Your confirmation and handoff instructions will be sent by email.'}</p><div class="wizard-footer"><button class="text-button" type="button" data-next="3">← Your thank-you</button><button class="button" type="submit">${user ? 'Confirm donation' : 'Sign in & confirm'} <span aria-hidden="true">↗</span></button></div></form>`;
    view.innerHTML = intro('DONATE A DEVICE', 'Let’s get it to the next student.', 'Four short steps. A clear plan for your device.') + donationGuide() + `<div class="app-grid"><div><ol class="stepper">${['Your devices','Handoff','Your thank-you','Review'].map((t,i) => `<li class="${step > i+1 ? 'complete' : step === i+1 ? 'active' : ''}" ${step === i+1 ? 'aria-current="step"' : ''}><button type="button" data-next="${i+1}" ${i+1>step ? 'disabled' : ''}><span>${step > i+1 ? '✓' : i+1}</span>${t}</button></li>`).join('')}</ol><section class="app-card wizard-card">${content}</section></div>${impact()}</div>`;
  }
  let catalogItemFilter='';
  async function renderCatalog() {
    document.body.classList.add('catalog-route');
    catalog=config.static ? await fetch('catalog-data.json').then(response=>{if(!response.ok) throw new Error('The sample collection could not load. Please refresh.');return response.json();}) : (await api('catalog')).items;
    const params=new URLSearchParams(location.search);
    catalogItemFilter=params.get('item')||'';
    view.innerHTML=intro('THE BYTEBACK COMPUTER STORE','Find your fit. Keep your budget.','Choose your brand, operating system, and hardware. Reserve online, then collect locally.')+`<section class="store-catalog"><p class="small muted">${config.demo ? 'Demo collection · Reference photos and sample configurations. No real purchase or pickup is arranged.' : 'Available community devices. Check each listing’s specifications before reserving.'}</p>${window.ByteBackShop.filters(params)}<div id="catalog-results" class="catalog-grid"></div><p class="catalog-disclaimer">Reference photos show the model family; sample hardware configurations may differ. <a href="image-credits.html">Photo credits & licenses</a>.</p></section>`;
    if(['low','high','ram'].includes(params.get('sort'))) $('#catalog-sort').value=params.get('sort');
    filterCatalog(false);
    if(catalogItemFilter) productDetails(catalogItemFilter);
  }
  function filterCatalog(updateURL=true) {
    if(!$('#catalog-search')) return;
    const f={q:$('#catalog-search').value,item:catalogItemFilter};
    document.querySelectorAll('[data-shop-filter]').forEach(x=>f[x.dataset.shopFilter]=x.value);
    let items=window.ByteBackShop.filter(catalog,f);
    const sort=$('#catalog-sort').value;
    if(sort!=='default') f.sort=sort;
    if(sort!=='default') items.sort((a,b)=>sort==='ram'?(b.ram||0)-(a.ram||0):sort==='low'?a.price-b.price:b.price-a.price);
    $('#catalog-results').innerHTML=items.map(i=>window.ByteBackShop.card(i,{reserve:true})).join('')||'<div class="empty catalog-empty"><h2>No computers match those filters.</h2><p>Try another brand or operating system, or clear your filters to see every available device.</p></div>';
    $('#result-count').textContent=items.length+' computer'+(items.length===1?'':'s')+' found'+(catalogItemFilter?' · Selected device':'');
    if(updateURL) {
      const query=new URLSearchParams(Object.entries(f).filter(([k,v])=>v));
      history.replaceState(null,'',location.pathname+(query.size?'?'+query:'')+'#catalog');
    }
  }
  function success(order, status) {
    lastOrder = order; route = 'success';
    document.body.classList.remove('catalog-route');
    history.replaceState(null, '', location.pathname+'#success');
    document.querySelectorAll('[data-route]').forEach(a=>a.removeAttribute('aria-current'));
    const donation = order.kind === 'donation';
    view.innerHTML = `<div class="success-layout"><div class="success-intro"><span class="success-mark">✓</span><p class="eyebrow">${donation ? 'DONATION CONFIRMED' : 'RESERVATION CONFIRMED'}</p><h1>${donation ? 'Thanks'+(order.data.first_name ? ', '+esc(order.data.first_name) : '')+'. We’ll take it from here.' : 'We’ve saved your computer.'}</h1><p>${donation ? 'Your donation has a place in the process. Here’s what to do before the handoff.' : 'Your pickup pass is ready. You can find it again in My ByteBack.'}</p></div><section class="app-card next-step-panel"><span class="eyebrow">YOUR NEXT STEP</span><h2>${order.data.method==='shipping' ? 'Print your label and pack your box.' : donation ? 'Get your device ready for drop-off.' : 'Keep your pickup pass handy.'}</h2><ol class="preparation-list">${donation ? '<li>Back up your files and sign out of your accounts.</li><li>Remove activation locks and include your charger if you have it.</li>' : '<li>Bring your student ID and pickup pass.</li>'}<li>${order.data.method==='shipping' ? 'Print the label below and attach it to your packed box.' : esc(config.dropoff)}</li></ol>${config.demo ? '<p class="pilot-note">Demo only: don’t send or drop off real devices.</p>' : ''}<div class="actions">${order.data.method==='shipping' ? `<button class="button" type="button" data-action="label" data-id="${order.id}">Get ${config.demo ? 'demo' : 'shipping'} label →</button>` : `<button class="button" type="button" data-action="pass" data-id="${order.id}">View my pass →</button>`}<a class="button button-outline" href="#orders">Go to My ByteBack</a></div></section><div class="confirmation-meta"><span>Receipt <strong>${order.id}</strong></span><span>${status==='preview' ? 'Your receipt is in the demo inbox.' : status==='sent' ? 'Receipt sent to '+esc(order.email) : status==='failed' ? 'Email delivery failed. Resend your receipt in My ByteBack.' : esc(status)}</span><button class="text-button" type="button" data-action="print" data-id="${order.id}">Print receipt</button></div>${donation ? `<div class="thank-you-preview"><span class="reward-symbol">✳</span><div><h3>Your thank-you is part of the plan.</h3><p>${order.data.reward_choice==='gift' ? 'Your $20 gift code' : 'Your $20 ByteBack credit'} will unlock when another student collects your device. You’ll find it in My ByteBack.</p></div></div>` : priceBreakdown(order.data.original_price ?? order.data.price,order.data.discount||0,order.data.price)}</div>`;
  }
  function timeline(order) {
    if (order.status === 'Cancelled') return '<p class="muted">This order was cancelled. No further action is needed.</p>';
    const stages = order.kind === 'donation' ? config.stages : ['Reserved','Collected'];
    const current = stages.indexOf(order.status);
    return `<ol class="timeline" aria-label="Order progress">${stages.map((s,i) => `<li class="${i <= current ? 'done' : ''}" ${i === current ? 'aria-current="step"' : ''}>${esc(s)}</li>`).join('')}</ol>`;
  }
  function nextStep(order) {
    if(order.status==='Cancelled') return 'No further action needed. You can start a new donation or reservation whenever you’re ready.';
    if(order.kind==='reservation') return order.status==='Collected' ? 'All set. We hope this computer serves you well.' : 'Have your student ID and pickup pass ready. Your reserved computer is waiting for collection.';
    return {Submitted:order.data.method==='shipping' ? 'Your turn: back up your files, remove account locks, and get your shipping label.' : 'Your turn: back up your files, remove account locks, and save your drop-off pass.', Received:'The team has your device. Next: verify its data wipe.', 'Data wiped':'Your data wipe is recorded. Next: repairs, cleaning, and testing.', Refurbished:'Refurbishment is complete. Next: the team will make it available to students.', 'Ready for student':'Your computer is in the catalog. Your thank-you unlocks after student collection.', Collected:'Your computer is with its next student. Your thank-you reward is ready below.'}[order.status] || '';
  }
  function orderCard(order, admin=false) {
    const d=order.data, active=!['Cancelled','Collected'].includes(order.status);
    const canEdit=['Submitted','Reserved'].includes(order.status)&&!d.shipment_id;
    const action=(name,label,primary=false)=>`<button class="${primary ? 'button button-outline' : 'text-button'}" type="button" data-action="${name}" data-id="${order.id}">${label}</button>`;
    return `<article class="app-card order-card"><div class="order-head"><div><span class="eyebrow">${order.kind==='donation' ? 'YOUR DONATION' : 'YOUR RESERVATION'}</span><h3>${esc(d.devices?.map(x=>x.model).join(', ')||d.item_name)}</h3><small>${date(order.created)} · ${order.id}${admin ? ' · '+esc(order.email) : ''}</small></div><span class="pill">${esc(order.status)}</span></div>${order.kind==='reservation'?priceBreakdown(d.original_price ?? d.price,d.discount||0,d.price):''}${timeline(order)}<div class="order-next"><span class="next-arrow" aria-hidden="true">↳</span><p>${esc(nextStep(order))}</p></div>${d.tracking ? `<p class="small muted tracking-line">Carrier: ${esc(d.carrier_status||'Awaiting carrier')} · ${esc(d.tracking)}</p>` : ''}<div class="actions">${active&&d.method!=='shipping' ? action('pass','View my pass',true) : ''}${order.status==='Submitted'&&d.method==='shipping' ? action('label',d.label_url ? 'View label' : 'Get shipping label',true) : ''}${order.status==='Ready for student' ? '<a class="button button-outline" href="#catalog">See the catalog ↗</a>' : ''}${order.kind==='reservation' ? `<span class="small muted">$${d.price} due at pickup${d.discount ? ' · $'+d.discount+' reward applied' : ''}</span>` : ''}</div><details class="order-details"><summary>Details, receipts & activity</summary><dl class="review-list"><dt>Handoff</dt><dd>${d.method==='shipping' ? 'Shipping' : esc(config.dropoff)}</dd>${d.notes ? `<dt>Team notes</dt><dd>${esc(d.notes)}</dd>` : ''}${order.kind==='donation' ? `<dt>Your thank-you</dt><dd>${d.reward_choice==='gift' ? '$20 code for a friend' : '$20 ByteBack credit'}</dd>` : ''}</dl><div class="actions">${action('print','Print receipt')}${action('receipt','Resend receipt')}${canEdit ? action('edit','Edit details')+action('cancel','Cancel order') : ''}</div><ul class="event-list">${d.history.map(h=>`<li><time>${date(h.at)}</time>${esc(h.status.replace('100 community points earned','Thank-you earned'))}</li>`).join('')}</ul></details>${active&&(config.demo||admin)&&order.status!=='Ready for student' ? `<details class="demo-controls"><summary>${config.demo ? 'Classroom demo controls' : 'Organizer controls'}</summary><p class="small muted">${config.demo ? 'Simulate a completed step to test the student handoff. No real device moves.' : 'Only confirm a step after the team has completed it.'}</p>${action('advance',order.kind==='reservation' ? 'Confirm student collection' : 'Mark '+config.stages[config.stages.indexOf(order.status)+1].toLowerCase())}</details>` : ''}</article>`;
  }
  function rewardsPanel() {
    return `<section class="rewards-section"><div class="section-heading-inline"><div><span class="eyebrow">A THANK-YOU FOR PASSING IT ON</span><h2>Your rewards</h2></div><span class="small muted">${config.demo ? 'Demo credits · testing only' : 'ByteBack credit · no cash value'}</span></div>${rewards.length ? `<div class="reward-wallet">${rewards.map(r=>`<article class="wallet-ticket"><div class="ticket-top"><span>${r.choice==='gift' ? 'FOR A FRIEND' : 'SAVED FOR YOU'}</span><span>${r.state==='available' ? 'READY TO USE' : r.state==='held' ? 'ON A RESERVATION' : 'USED'}</span></div><div class="wallet-value">$${r.amount}<span>off a ByteBack computer</span></div><p>${r.choice==='gift' ? 'Give this code to a friend. They can enter it when reserving a computer.' : 'Enter this code when you reserve a priced computer from this account.'}</p><code>${esc(r.code)}</code>${r.state==='available' ? `<div class="actions"><button class="text-button" type="button" data-copy="${esc(r.code)}">${r.choice==='gift' ? 'Copy gift code' : 'Copy reward code'}</button><a class="text-button" href="#catalog">Browse computers ↗</a></div>` : ''}<small>One use, up to $${r.amount}. Unused value is not carried over.</small></article>`).join('')}</div>` : '<div class="rewards-empty"><span class="reward-symbol" aria-hidden="true">✳</span><div><h3>A little thank-you is on its way.</h3><p>For each donated device a student collects, you’ll receive a $20 reward code. Choose to keep it or give it to a friend during your donation.</p></div></div>'}</section>`;
  }
  async function dashboard(admin=false) {
    if(!user) {
      view.innerHTML=intro('MY BYTEBACK','Good to see you.','Your donations, reservations, and thank-yous have a home here.')+'<div class="empty"><span class="welcome-symbol" aria-hidden="true">↻</span><h2>Pick up where you left off.</h2><p>Sign in with your email to see what’s happening with your devices and what to do next.</p><button class="button" type="button" data-login>Send me a sign-in link →</button></div>';
      return;
    }
    orders=(await api(admin ? 'admin/orders' : 'orders')).orders;
    rewards=admin ? [] : (await api('rewards')).rewards;
    const firstName=orders.find(o=>o.kind==='donation'&&o.data.first_name)?.data.first_name;
    const active=orders.filter(o=>!['Collected','Cancelled'].includes(o.status));
    view.innerHTML=intro('MY BYTEBACK',admin ? 'The refurbishment desk.' : 'Welcome back'+(firstName ? ', '+esc(firstName) : '')+'.',admin ? 'Record each completed handoff, data wipe, and refurbishment step.' : active.length ? 'Here’s where things stand. Your next step is shown on each order.' : 'Thanks for being part of this. Let’s find your next step.')+`<div class="stats"><div class="stat"><strong>${orders.filter(o=>o.kind==='donation'&&o.status!=='Cancelled').reduce((n,o)=>n+o.data.devices.length,0)}</strong><span>Devices you’ve pledged</span></div><div class="stat"><strong>${active.length}</strong><span>Orders in progress</span></div><div class="stat"><strong>${rewards.filter(r=>r.state==='available').length}</strong><span>Thank-yous ready to use</span></div></div><div class="section-heading-inline"><h2>Your activity</h2><div class="dashboard-tools"><span id="sync-status" class="small muted">Updates automatically</span><button class="text-button" type="button" data-refresh>Refresh</button>${user.admin ? `<a class="text-button" href="#${admin ? 'orders' : 'admin'}">${admin ? 'My ByteBack' : 'Organizer desk'}</a>` : ''}</div></div><div id="orders-list">${orders.map(o=>orderCard(o,admin)).join('')||'<div class="empty"><h3>Nothing here just yet.</h3><p>Have a device to pass along, or need one for school?</p><div class="actions"><a class="button" href="#donate">Donate a device</a><a class="button button-outline" href="#catalog">Find a computer</a></div></div>'}</div>${!admin ? rewardsPanel()+'<section class="receipt-section"><details><summary><span>Email & receipts</span><span class="small muted">'+(config.demo ? 'Demo inbox' : 'Delivery history')+'</span></summary><p class="small muted">'+(config.demo ? 'Preview the automatic emails here while testing. They aren’t sent to an external inbox.' : 'Your receipt copies and email delivery status are saved here.')+'</p><div id="inbox"></div></details></section>' : ''}`;
    if(!admin) await inbox();
  }
  async function inbox() {
    const result = await api('messages');
    if (!$('#inbox')) return;
    $('#inbox').innerHTML = result.messages.map(m=>`<details class="email-card"><summary>${esc(m.subject)} <span class="pill">${esc(m.status)}</span></summary><p class="small">${date(m.created)} · ${esc(m.email)}</p><pre>${esc(m.body)}</pre></details>`).join('') || '<p class="small muted">Your automatic receipts will appear here.</p>';
  }
  function findOrder(id) { return orders.find(o=>o.id===id) || (lastOrder?.id===id ? lastOrder : null); }
  function receiptText(order) {
    const d = order.data;
    return `${config.demo ? 'DEMO — NOT VALID FOR SHIPPING OR PHYSICAL PICKUP\n\n' : ''}Receipt ID: ${order.id}\nDate: ${date(order.created)}\nAccount: ${order.email}\nStatus: ${order.status}\n\n${d.devices?.map(x=>`${x.model} · ${x.condition}`).join('\n') || d.item_name}\n\nHandoff: ${d.method}\n${d.method==='shipping' ? 'Return address: '+Object.values(d.address).join(', ') : config.dropoff}\nPass: ${d.pass}\nOriginal price: $${d.original_price ?? d.price ?? 0}\nReward applied: -$${d.discount || 0}\nAmount due at pickup: $${d.price || 0}\n\nThis is an order acknowledgement, not a tax receipt. No payment was collected online.`;
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
      const text = 'I’m trying ByteBack, a student project that helps pass unused computers to college students in Provo.';
      if (navigator.share) { try { await navigator.share({title:'ByteBack', text, url:location.origin+'/index.html'}); } catch (e) { if(e.name!=='AbortError') throw e; } }
      else { openModal(`<h2 id="modal-title">Share the idea.</h2><p>Copy this message to share with your community.</p><textarea rows="5" readonly aria-label="Share message">${esc(text + '\n' + (config.demo ? 'ByteBack is a local academic prototype.' : location.origin+'/index.html'))}</textarea>`); }
      return;
    }
    if (action === 'edit') return openModal(`<h2 id="modal-title">Update your details.</h2><form id="edit-form" data-id="${id}">${order.data.method === 'shipping' ? addressFields(order.data.address) : ''}<label>Handoff notes<textarea name="notes" rows="4" maxlength="1000">${esc(order.data.notes)}</textarea></label><button class="button" type="submit">Save changes</button></form>`);
    if (action === 'advance' && order.status === 'Refurbished') return openModal(`<h2 id="modal-title">Make it ready for a student.</h2><p>Record the verified specifications and an accessible pickup price for each device. Enter $0 to offer it free.</p><form id="listing-form" data-id="${id}">${order.data.devices.map((d,i)=>`<fieldset><legend>${esc(d.model)}</legend><label>Verified specifications<input name="specs-${i}" maxlength="300" placeholder="e.g. 8 GB RAM · 256 GB SSD · Linux Mint" required></label><label>Inspected condition<select name="condition-${i}" required><option value="">Choose after inspection</option><option>Excellent</option><option>Good</option><option>Fair</option></select></label><label>Condition notes<textarea name="condition-notes-${i}" maxlength="350" placeholder="Visible wear, defects and checks completed" required></textarea></label>${d.type!=="Desktop"?`<label>Measured battery health (%) <span class="optional">Leave blank if unmeasured</span><input name="battery-${i}" type="number" min="0" max="100" step="1"></label>`:""}<label>Included accessories<textarea name="accessories-${i}" maxlength="500" placeholder="List actual items, or write None" required></textarea></label><label>Student price ($)<input type="number" name="price-${i}" min="0" max="500" step="1" value="0" required></label></fieldset>`).join('')}<p class="small">${config.demo ? 'This creates a sample listing for classroom testing.' : 'Confirm inspection, data erasure, and refurbishment are complete before publishing.'}</p><button class="button" type="submit">Publish to student catalog</button></form>`);
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
    document.body.classList.toggle('catalog-route',location.hash==='#catalog');
    const hash = location.hash.slice(1);
    if (hash.startsWith('verify=')) {
      const token = hash.slice(7);
      let returnSearch=location.search;
      try {
        const saved=JSON.parse(sessionStorage.getItem('byteback-login-context'));
        if(saved && ['donate','catalog','orders','admin'].includes(saved.route)) {
          returnRoute=saved.route; pendingReservation=saved.item; returnSearch=saved.search || '';
        }
        sessionStorage.removeItem('byteback-login-context');
      } catch { /* Continue with this page’s context. */ }
      history.replaceState(null, '', location.pathname+returnSearch+'#'+returnRoute);
      try {
        user=await api('auth/verify',{token}); updateAccount(); if(modal.open) modal.close();
        route=returnRoute;
        if(route==='catalog') { await renderCatalog(); if(pendingReservation) reserveDialog(pendingReservation); }
        else if(route==='orders'||route==='admin') await dashboard(route==='admin');
        else donate();
        message('You’re signed in. We kept your place.');
      } catch(e) { route='donate'; donate(); message(e.message,true); }
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
    if(form.id==='catalog-search-form') { filterCatalog(); return; }
    const fields = Object.fromEntries(new FormData(form));
    const button = event.submitter;
    guarded(async () => {
      if(button) button.disabled=true;
      try {
        if(form.id==='device-form') {
          if(draft.devices.length>=10) throw new Error('You can add up to 10 devices per donation.');
          draft.devices.push({...fields, charger:!!fields.charger, safe:!!fields.safe}); saveDraft(); donate(); message(fields.model+' added. Add another device, or choose your handoff.');
        } else if(form.id==='delivery-form') {
          draft.method=fields.method; draft.notes=fields.notes;
          if(draft.method==='shipping') {
            draft.address=Object.fromEntries(['name','street1','street2','city','state','zip'].map(k=>[k,fields[k]]));
            draft.parcel=Object.fromEntries(['length','width','height','weight'].map(k=>[k,Number(fields[k])]));
          }
          step=3; saveDraft(); donate(); $('#app-content').scrollIntoView();
        } else if(form.id==='reward-form') {
          draft.reward_choice=fields.reward_choice; draft.first_name=fields.first_name.trim(); draft.student_note=fields.student_note.trim();
          step=4; saveDraft(); donate(); $('#app-content').scrollIntoView();
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
          const code=(fields.reward_code||'').trim().toUpperCase();
          if(code && code!==form.dataset.validatedReward) throw new Error('Apply your reward code first so you can review the final amount.');
          const result=await api('orders',{kind:'reservation',item_id:form.dataset.id,student:!!fields.student,reward_code:code,quoted_price:Number(form.dataset.quotedPrice),request_key:form.dataset.key});
          modal.close(); success(result.order,result.email_status);
        } else if(form.id==='listing-form') {
          const order=findOrder(form.dataset.id);
          const listings=order.data.devices.map((d,i)=>({specs:fields['specs-'+i],price:Number(fields['price-'+i]),condition:fields['condition-'+i],condition_notes:fields['condition-notes-'+i],battery_health:fields['battery-'+i]?Number(fields['battery-'+i]):null,accessories:fields['accessories-'+i]}));
          await api('orders/'+order.id+'/advance',{listings}); modal.close();
          await dashboard(route==='admin'); message('Your device listing is ready for students.');
        } else if(form.id==='edit-form') {
          const address=Object.fromEntries(['name','street1','street2','city','state','zip'].map(k=>[k,fields[k]]));
          await api('orders/'+form.dataset.id+'/edit',{notes:fields.notes,address}); modal.close();
          await dashboard(route==='admin'); message('Your changes are saved.');
        }
      } finally { if(button?.isConnected) button.disabled=false; }
    });
  });
  document.addEventListener('click', event => {
    const detail=event.target.closest('[data-product-details]');
    if(detail) { event.preventDefault(); return guarded(()=>productDetails(detail.dataset.productDetails)); }
    const b=event.target.closest('button');
    if(!b) return;
    if(b.classList.contains('close-modal')) return modal.close();
    guarded(async()=>{
      if(b.id==='apply-reward') {
        const form=$('#reserve-form');
        const code=form.elements.reward_code.value.trim().toUpperCase();
        const quote=await api('reservation-quote',{item_id:form.dataset.id,reward_code:code});
        if(form.elements.reward_code.value.trim().toUpperCase()!==code) return;
        form.dataset.validatedReward=quote.reward_code; form.dataset.quotedPrice=quote.price;
        $('#reservation-price').innerHTML=priceBreakdown(quote.original_price,quote.discount,quote.price);
        $('#modal-error')?.remove();
        $('#reward-status').textContent=code?'Reward verified. Your final total is shown below.':'No reward applied. Your total is shown below.';
        $('#confirm-reservation').disabled=false;
      } else if(b.id==='account') {
        if(!user) return signIn();
        openModal(`<h2 id="modal-title">Your account.</h2><p>Signed in as ${esc(user.email)}.</p><p class="small">Sign-in sessions last 24 hours. Your orders stay saved after signing out.</p><button class="button button-outline" type="button" data-logout>Sign out</button>`);
      } else if(b.hasAttribute('data-login')) signIn();
      else if(b.hasAttribute('data-logout')) { await api('logout',{}); user=null; orders=[]; lastOrder=null; updateAccount(); modal.close(); await render(); }
      else if(b.dataset.next) { preserveStep(); step=Number(b.dataset.next); saveDraft(); donate(); $('#app-content').scrollIntoView(); }
      else if(b.dataset.remove!==undefined) { draft.devices.splice(Number(b.dataset.remove),1); saveDraft(); if(!draft.devices.length) step=1; donate(); }
      else if(b.dataset.reserve) {
        pendingReservation=b.dataset.reserve;
        if(!signedInOrPrompt()) return;
        reserveDialog(pendingReservation);
      } else if(b.dataset.copy) {
        try { await navigator.clipboard.writeText(b.dataset.copy); message('Copied. '+(config.demo ? 'This is a demo reward code.' : 'Your reward code is ready to use or share.')); }
        catch { openModal('<h2 id="modal-title">Your reward code</h2><p>Select and copy this code.</p><input readonly aria-label="Reward code" value="'+esc(b.dataset.copy)+'">'); }
      } else if(b.dataset.action) await orderAction(b.dataset.action,b.dataset.id);
      else if(b.dataset.confirm) {
        const result=await api('orders/'+b.dataset.id+'/'+b.dataset.confirm,{}); modal.close();
        await dashboard(route==='admin'); message('Order '+result.order.status.toLowerCase()+'.');
      } else if(b.dataset.printLabel) printOrder(findOrder(b.dataset.printLabel),true);
      else if(b.hasAttribute('data-refresh')) await refresh();
      else if(b.id==='clear-filters') { catalogItemFilter=''; $('#catalog-search').value=''; document.querySelectorAll('[data-shop-filter]').forEach(x=>x.value=''); $('#catalog-sort').value='default'; filterCatalog(); }
    });
  });
  function reserveDialog(id) {
    const i=catalog.find(x=>x.id===id);
    pendingReservation=null;
    if(!i) return;
    openModal(`<h2 id="modal-title">Review it. Then reserve it.</h2><h3>${esc(i.name)}</h3><p>${esc(i.specs)}</p><form id="reserve-form" data-id="${esc(i.id)}" data-key="${key()}" data-quoted-price="${i.price}" data-validated-reward="">${i.price?'<label>ByteBack reward code <span class="optional">Optional</span><input name="reward_code" maxlength="40" placeholder="THANKS-…" autocomplete="off"></label><button type="button" id="apply-reward" class="button button-outline">Apply reward</button><p id="reward-status" class="small muted" role="status">Have a code? Apply it to check your savings before confirming.</p>':'<p class="small muted">This computer is free. Save your reward for a priced device.</p>'}<div id="reservation-price" aria-live="polite">${priceBreakdown(i.price)}</div><p class="small muted">${esc(config.dropoff)}</p><label class="check"><input type="checkbox" name="student" required>I’m a Provo-area college student and will present my student ID at pickup.</label><p class="small">${config.demo?'This is a test reservation. No payment or physical pickup is arranged.':'Pay the final amount at pickup. No online payment is collected.'}</p><button class="button" id="confirm-reservation" type="submit">Confirm reservation →</button></form>`);
  }
  document.addEventListener('change', event=>{
    if(event.target.name==='method') {
      const shipping=event.target.value==='shipping';
      $('#shipping-fields').hidden=!shipping; $('#shipping-fields fieldset').disabled=!shipping;
      preserveStep();
    }
    if(event.target.id==='catalog-sort'||event.target.matches('[data-shop-filter]')) filterCatalog();
  });
  document.addEventListener('input',event=>{
    if(event.target.name==='reward_code' && event.target.closest('#reserve-form')) {
      const form=$('#reserve-form'); const item=catalog.find(p=>p.id===form.dataset.id);
      form.dataset.validatedReward=''; form.dataset.quotedPrice=item.price;
      $('#reservation-price').innerHTML=priceBreakdown(item.price);
      $('#confirm-reservation').disabled=!!event.target.value.trim();
      $('#reward-status').textContent=event.target.value.trim()?'Apply this code to check your final total.':'No reward applied.';
    } else if(event.target.id==='catalog-search') filterCatalog();
    else if(event.target.closest('#delivery-form, #reward-form')) preserveStep();
  });
  window.addEventListener('hashchange',()=>{
    preserveStep();
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
    const latestRewards=route==='orders' ? (await api('rewards')).rewards : [];
    if((JSON.stringify(orders)!==JSON.stringify(result.orders) || JSON.stringify(rewards)!==JSON.stringify(latestRewards)) && !modal.open) await dashboard(route==='admin');
    const status=$('#sync-status');
    if(status) status.textContent='Updated '+new Date().toLocaleTimeString();
    if(route==='orders') await inbox();
  }
  setInterval(()=>{ if(!document.hidden && !busy && !modal.open) guarded(refresh); },15000);
  guarded(async()=>{
    try { config=await api('config'); }
    catch {
      config={demo:true,static:true,shipping:false,dropoff:'Preview only — no physical handoff is arranged',stages:['Submitted','Received','Data wiped','Refurbished','Ready for student','Collected']};
    }
    $('#mode-banner').textContent=config.static ? 'Website preview · Browse sample devices and donation steps. Start the local server for sign-in, rewards and reservations.' : config.demo ? 'You’re in the demo · Try the full process with sample devices. No real shipments or payments.' : 'For students in Provo · Every device has someone next.';
    if(!config.static) { try {user=await api('me');} catch {/* Signed-out visitors can browse and prepare donations. */} }
    updateAccount(); await render();
  });
})();
