"use strict";
(() => {
 const shop=window.ByteBackShop;
 let active=0, timer=null, items=[], purpose='all';
 const slides=[...document.querySelectorAll('[data-slide]')];
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function show(index,announce=true){active=(index+slides.length)%slides.length;slides.forEach((s,i)=>{s.hidden=i!==active;s.classList.toggle('is-active',i===active)});document.querySelectorAll('[data-slide-to]').forEach((b,i)=>{if(i===active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current')});if(announce)document.querySelector('#slide-status').textContent=`Collection ${active+1} of ${slides.length}`;}
 function stop(){clearInterval(timer);timer=null;document.querySelector('#slide-play').textContent='Play slides';document.querySelector('#slide-play').setAttribute('aria-label','Start automatic slides')}
 document.querySelector('#slide-prev').onclick=()=>{stop();show(active-1)};
 document.querySelector('#slide-next').onclick=()=>{stop();show(active+1)};
 document.querySelectorAll('[data-slide-to]').forEach(b=>b.onclick=()=>{stop();show(Number(b.dataset.slideTo))});
 document.querySelector('#slide-play').onclick=()=>{if(timer)return stop();timer=setInterval(()=>{if(!document.hidden)show(active+1,false)},6500);document.querySelector('#slide-play').textContent='Pause slides';document.querySelector('#slide-play').setAttribute('aria-label','Pause automatic slides')};
 document.querySelector('.feature-carousel').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();stop();show(active+(e.key==='ArrowLeft'?-1:1))}});
 document.querySelector('.feature-carousel').addEventListener('focusin',e=>{if(e.target.id!=='slide-play')stop()});
 reduced.addEventListener('change',stop);
 function render(){const selected=items.filter(p=>purpose==='all'||(purpose==='budget'?p.price<=200:p.uses?.includes(purpose)));document.querySelector('#recommended-products').innerHTML=selected.map(p=>shop.card(p)).join('')||'<div class="collection-empty">No matching computers are available right now. Try another collection.</div>';document.querySelector('#recommend-count').textContent=`${selected.length} computers · Compare the specs. Find your fit.`;document.querySelector('#recommended-products').scrollTo({left:0,behavior:'instant'});}
 document.querySelectorAll('[data-purpose]').forEach(b=>b.onclick=()=>{purpose=b.dataset.purpose;document.querySelectorAll('[data-purpose]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render()});
 document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>{const rail=document.querySelector('#recommended-products');rail.scrollBy({left:Number(b.dataset.scroll)*rail.clientWidth*.8,behavior:reduced.matches?'instant':'smooth'})});
 (async()=>{try{const response=await fetch('/api/catalog');if(!response.ok)throw Error('static');items=(await response.json()).items;const config=await fetch('/api/config').then(r=>r.json());document.querySelector('#store-status').textContent=config.demo?'Student project demo · Sample devices, prices, and rewards. No real purchases or shipments.':'Provo student pickup · Reserve online and pay at collection.';}catch{try{items=await fetch('catalog-data.json').then(r=>{if(!r.ok)throw Error('load');return r.json()});document.querySelector('#store-status').textContent='Sample collection · Start the ByteBack server to reserve a device or manage donations.';}catch{document.querySelector('#recommended-products').innerHTML='<p class="collection-empty">The collection couldn’t load. Refresh the page or open the app through the ByteBack server.</p>';return;}}render()})();
})();
