const assert = require('node:assert/strict'),
	fs = require('fs'),
	vm = require('vm');
const html = fs.readFileSync('iframe/export-device-archive-with-lcsc-id-v4.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
function element() {
	const attrs = {},
		classes = new Set();
	return {
		value: '',
		className: '',
		disabled: false,
		textContent: '',
		setAttribute(k, v) {
			attrs[k] = v;
		},
		removeAttribute(k) {
			delete attrs[k];
		},
		classList: {
			add(x) {
				classes.add(x);
			},
			remove(x) {
				classes.delete(x);
			},
			contains(x) {
				return classes.has(x);
			},
		},
		append(x) {
			this.lastChild = x;
		},
		replaceChildren() {},
		addEventListener() {},
		focus() {},
	};
}
async function scenario(fail) {
	const nodes = new Map();
	const get = (id) => {
		if (!nodes.has(id)) nodes.set(id, element());
		return nodes.get(id);
	};
	let resolveArchive, rejectArchive, resolveSave;
	const timers = new Map();
	let timerId = 0,
		now = 0;
	const api = {
		sys_I18n: { text: (s, a, b, ...args) => s.replace(/\$\{(\d+)\}/g, (_, i) => args[i - 1]) },
		sys_FileSystem: { saveFile: () => new Promise((r) => (resolveSave = r)) },
	};
	const ctx = vm.createContext({
		eda: api,
		window: { addEventListener() {} },
		document: { getElementById: get, querySelector: () => element(), querySelectorAll: () => [], createElement: element },
		Date: class extends Date {
			static now() {
				return now;
			}
		},
		setInterval(fn) {
			timers.set(++timerId, fn);
			return timerId;
		},
		clearInterval(id) {
			timers.delete(id);
		},
		lcscExportV4: {
			parseIds: () => ({ ids: ['C25804'], invalid: [], duplicates: 0 }),
			queryDevices: async (api, ids, cb) => {
				const rows = [{ id: 'C25804', status: 'matched', device: { name: 'test' } }];
				cb(rows);
				return { rows };
			},
			createArchive: () =>
				new Promise((r, j) => {
					resolveArchive = r;
					rejectArchive = j;
				}),
		},
	});
	vm.runInContext(script, ctx);
	const pending = get('export').onclick();
	await new Promise(setImmediate);
	assert.ok(get('progressTrack').classList.contains('indeterminate'));
	assert.match(get('stage').textContent, /Step 2\/3/);
	assert.equal(timers.size, 1);
	now = 5000;
	for (const fn of timers.values()) fn();
	assert.match(get('status').textContent, /00:00:05/);
	if (fail) {
		rejectArchive(new Error('network'));
		await pending;
		assert.equal(get('stage').textContent, 'Export failed');
		assert.equal(get('progress').value, 0);
	} else {
		resolveArchive({ size: 1 });
		await new Promise(setImmediate);
		assert.match(get('stage').textContent, /Step 3\/3/);
		assert.equal(timers.size, 1);
		resolveSave();
		await pending;
		assert.equal(get('stage').textContent, 'Archive generation completed');
	}
	assert.equal(timers.size, 0);
	assert.equal(get('lcscIds').readOnly, false);
	assert.equal(get('progressTrack').classList.contains('indeterminate'), false);
}
(async () => {
	await scenario(false);
	await scenario(true);
	console.log('PASS: long-running archive animation, elapsed time, save stage, completion/error cleanup and controls restored');
})().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
