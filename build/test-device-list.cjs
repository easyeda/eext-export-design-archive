const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { filterIndices, selectedVisible } = require('../iframe/js/device-list-model');
const XLSX = require('../iframe/js/xlsx.full.min');
const rows = [
	['Resistor', 'C1', '0603', '10k'],
	['Capacitor', 'C2', '0402', '1uF'],
	['resistor', 'C3', '0603', '1k'],
];
const rule = (field, mode, value) => ({ field, mode, value });
assert.deepEqual(filterIndices(rows, [rule(0, 'contains', 'resistor'), rule(3, 'equals', '10k')], false), [0]);
assert.deepEqual(filterIndices(rows, [rule(-1, 'excludes', '0603')], false), [1]);
assert.deepEqual(filterIndices(rows, [rule(0, 'equals', 'Resistor')], true), [0]);
assert.deepEqual(filterIndices(rows, [rule(3, 'equals', '')], false), [0, 1, 2]);
assert.deepEqual(filterIndices([['C[13]'], ['C1']], [rule(0, 'contains', '[13]')], false), [0]);
assert.deepEqual(selectedVisible([2, 0], new Set([1, 2])), [2]);

(async () => {
	const item = {
		uuid: 'one',
		name: 'Test',
		supplierId: 'C10',
		classification: ['一级', '二级'],
		otherProperty: { Custom: 'Value', Empty: '', Zero: 0 },
	};
	const context = vm.createContext({
		window: { location: { origin: 'https://example.test' } },
		fetch: async () => {
			throw new Error('offline');
		},
		setTimeout,
		console,
	});
	vm.runInContext(fs.readFileSync('iframe/js/device-list-source.js', 'utf8'), context);
	const source = context.deviceListSource.createSource({ lib_Device: { search: async () => [item] } });
	const result = await source.load('project', () => {});
	assert.equal(result.rows.length, 1);
	assert.equal(result.rows[0][result.headers.indexOf('Custom')], 'Value');
	assert.equal(result.rows[0][result.headers.indexOf('Zero')], '0');
	assert.equal(result.rows[0][result.headers.indexOf('Primary Category')], '一级');
	assert.equal(result.rows[0][result.headers.indexOf('Supplier Part')], 'C10');
	const headers = ['Device', 'Supplier Part', 'Footprint', 'Value'];
	const chosen = selectedVisible([0, 2], new Set([1, 2]));
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...chosen.map((id) => rows[id])]), 'DeviceList');
	const loaded = XLSX.read(XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' });
	assert.deepEqual(XLSX.utils.sheet_to_json(loaded.Sheets.DeviceList, { header: 1 }), [headers, rows[2]]);
	console.log(
		'PASS: compound filters, literal text matching, case sensitivity, hidden selections excluded, local-library fallback, custom fields and XLSX roundtrip',
	);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
