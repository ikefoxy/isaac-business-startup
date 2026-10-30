const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const context = { window: {}, URLSearchParams };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shop.js'), 'utf8'), context);
const shop = context.window.ByteBackShop;
const items = JSON.parse(fs.readFileSync(path.join(root, 'catalog-data.json'), 'utf8'));
const fields = ['brand', 'os', 'cpu', 'gpu', 'budget'];

test('every advertised filter option has sample inventory', () => {
  for (const [field, values] of Object.entries(shop.options)) {
    for (const value of values) assert.ok(shop.filter(items, { [field]: value }).length, `${field}: ${value}`);
  }
  for (const budget of [100, 200, 300, 500]) assert.ok(shop.filter(items, { budget }).length);
});

test('every enabled combination returns computers meeting all selected filters', () => {
  const states = new Map();
  for (const item of items) {
    for (let mask = 0; mask < 32; mask++) {
      for (const budget of [100, 200, 300, 500]) {
        const selected = {};
        fields.forEach((field, index) => { if (mask & (1 << index)) selected[field] = field === 'budget' ? budget : item[field]; });
        if (selected.budget && item.price > selected.budget) continue;
        states.set(JSON.stringify(selected), selected);
      }
    }
  }
  for (const selected of states.values()) {
    const available = shop.facets(items, selected);
    for (const field of fields) {
      for (const value of available[field]) {
        const next = { ...selected, [field]: value };
        const results = shop.filter(items, next);
        assert.ok(results.length, JSON.stringify(next));
        for (const result of results) {
          for (const [key, expected] of Object.entries(next)) {
            if (key === 'budget') assert.ok(result.price <= expected);
            else assert.equal(result[key], expected);
          }
        }
      }
    }
  }
});

test('incompatible combinations never return unrelated computers', () => {
  assert.equal(shop.filter(items, { brand: 'Apple', gpu: 'NVIDIA' }).length, 0);
  assert.ok(!shop.facets(items, { brand: 'Apple' }).gpu.includes('NVIDIA'));
  assert.ok(!shop.facets(items, { cpu: 'AMD' }).os.includes('macOS'));
});

test('search and product links constrain every available option', () => {
  const search = shop.facets(items, { q: 'ThinkPad' });
  assert.deepEqual(Array.from(search.brand), ['Lenovo']);
  const product = shop.facets(items, { item: 'demo-hp' });
  assert.deepEqual(Array.from(product.brand), ['HP']);
  assert.deepEqual(Array.from(product.budget), [200, 300, 500]);
});

test('unavailable inventory does not leave selectable empty filters', () => {
  const available = items.filter(item => item.gpu !== 'NVIDIA');
  assert.ok(!shop.facets(available).gpu.includes('NVIDIA'));
  for (const values of Object.values(shop.facets([]))) assert.equal(values.length, 0);
});
