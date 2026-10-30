"use strict";
window.ByteBackShop = (() => {
  const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const options={brand:['Apple','Dell','Lenovo','HP','ASUS','Acer','Microsoft'],os:['macOS','Windows','Linux','iPadOS'],cpu:['Intel','AMD','Apple silicon'],gpu:['Intel','AMD','NVIDIA','Apple']};
  function card(p,{reserve=false}={}) {
    return `<article class="product-card" data-product="${esc(p.id)}"><a class="product-image" href="app.html?item=${encodeURIComponent(p.id)}#catalog" ${reserve?`data-product-details="${esc(p.id)}"`:''} aria-label="View ${esc(p.name)}">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)} — reference photograph" loading="lazy" width="600" height="420">` : '<span class="no-product-photo">Photo not yet provided</span>'}<span class="product-badge">${esc(p.badge||'Community donation')}</span></a><div class="product-body"><div class="product-brand">${esc(p.brand||'Computer')} <span>· ${esc(p.os||'OS not listed')}</span></div><h3><a href="app.html?item=${encodeURIComponent(p.id)}#catalog" ${reserve?`data-product-details="${esc(p.id)}"`:""}>${esc(p.name)}</a></h3><p class="product-specs">${esc(p.specs)}</p><div class="spec-chips">${[p.cpu,p.gpu==='NVIDIA'?'NVIDIA graphics':p.ram?`${p.ram} GB RAM`:null,p.screen].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div>${p.student_note?`<blockquote class="donor-note">“${esc(p.student_note)}”<cite>— ${esc(p.donor_name)}</cite></blockquote>`:''}<div class="product-buy"><div><span class="product-price">${p.price?'$'+p.price:'Free'}</span><span class="price-caption">${p.price?'at local pickup':'community donation'}</span></div>${reserve?`<button class="text-button product-details-button" type="button" data-product-details="${esc(p.id)}">View details</button><button class="button" type="button" data-reserve="${esc(p.id)}">Reserve <span aria-hidden="true">↗</span></button>`:`<a class="product-link" href="app.html?item=${encodeURIComponent(p.id)}#catalog">View computer <span aria-hidden="true">↗</span></a>`}</div></div></article>`;
  }
  function inspectionDetails(p) {
    const i=p.inspection||{};
    const measured=Number.isInteger(i.battery_health);
    return `<dl class="inspection-grid"><div><dt>Battery health</dt><dd>${measured?`${i.battery_health}% of design capacity`:esc(i.battery_status||'Not measured')}</dd></div><div><dt>Product condition</dt><dd>${esc(i.condition||'Not recorded')}</dd></div><div><dt>Included accessories</dt><dd>${esc(i.accessories||'Not recorded—ask the organizer before reserving.')}</dd></div><div><dt>Inspection notes</dt><dd>${esc(i.notes||'Detailed inspection notes have not been recorded.')}</dd></div></dl>`;
  }
  function filters(params=new URLSearchParams()) {
    const select=(key,label)=>`<label>${label}<select data-shop-filter="${key}" id="filter-${key}"><option value="">Any ${label==='OS'?'OS':label.toLowerCase()}</option>${options[key].map(v=>`<option value="${esc(v)}" ${params.get(key)===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
    return `<form class="catalog-search" id="catalog-search-form"><label class="sr-only" for="catalog-search">Search computers</label><input id="catalog-search" type="search" value="${esc(params.get('q')||'')}" placeholder="Search computers"><button class="button" type="submit">Search</button></form><div class="catalog-filter-grid">${select('brand','Brand')}${select('os','OS')}${select('cpu','Processor')}${select('gpu','Graphics')}<label>Budget<select data-shop-filter="budget" id="filter-budget"><option value="">Any price</option>${[100,200,300,500].map(n=>`<option value="${n}" ${Number(params.get('budget'))===n?'selected':''}>Up to $${n}</option>`).join('')}</select></label><label>Sort by<select id="catalog-sort"><option value="default">Recommended</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="ram">Most memory</option></select></label></div><div class="filter-summary"><span id="result-count" role="status"></span><button class="text-button" type="button" id="clear-filters">Clear filters</button></div>`;
  }
  function filter(items,f) {
    const q=(f.q||'').toLowerCase().trim();
    return items.filter(p=>(!q||[p.name,p.specs,p.brand,p.os,p.cpu,p.gpu].join(' ').toLowerCase().includes(q))&&['brand','os','cpu','gpu'].every(k=>!f[k]||p[k]===f[k])&&(!f.budget||p.price<=Number(f.budget))&&(!f.item||p.id===f.item));
  }
  function facets(items, selected={}) {
    const result={};
    for(const field of ['brand','os','cpu','gpu','budget']) {
      const others={...selected};
      delete others[field];
      const compatible=filter(items,others);
      result[field]=field==='budget'?[100,200,300,500].filter(limit=>compatible.some(item=>item.price<=limit)):[...new Set(compatible.map(item=>item[field]).filter(Boolean))];
    }
    return result;
  }
  return {esc,card,filters,filter,options,inspectionDetails,facets};
})();
