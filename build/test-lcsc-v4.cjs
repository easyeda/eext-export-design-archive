const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseIds, findDevice, queryDevices, createArchive } = require('../iframe/js/lcsc-export-v4');

(async () => {
	assert.deepEqual(parseIds(' c25804，C2040; C25804\nC0 BAD C12x '), {
		ids: ['C25804', 'C2040'],
		invalid: ['C0', 'BAD', 'C12X'],
		duplicates: 1,
	});
	assert.deepEqual(parseIds(' \n '), { ids: [], invalid: [], duplicates: 0 });
	const match = { uuid: 'device', supplierId: 'C25804', name: 'Resistor' };
	assert.equal(await findDevice({ lib_Device: { search: async () => [{ uuid: 'wrong', supplierId: 'C258040' }, match] } }, 'C25804', 'lib'), match);
	const fullPage = Array.from({ length: 50 }, (_, i) => ({ uuid: String(i), supplierId: 'C999' }));
	assert.equal(await findDevice({ lib_Device: { search: async (...args) => (args[5] === 1 ? fullPage : [match]) } }, 'C25804', 'lib'), match);
	await assert.rejects(findDevice({ lib_Device: { search: async () => fullPage } }, 'C25804', 'lib'), /pagination/);
	const api = {
		lib_LibrariesList: { getSystemLibraryUuid: async () => 'lib' },
		lib_Device: {
			search: async (id) => {
				if (id === 'C3') throw new Error('Network unavailable');
				return id === 'C25804' ? [match] : [];
			},
		},
		sys_FileManager: {
			getDeviceFileByDeviceUuid: async (ids, lib, format) => {
				assert.deepEqual(ids, ['device']);
				assert.equal(lib, 'lib');
				assert.equal(format, 'elibz2');
				return { size: 100, name: 'test.elibz2' };
			},
		},
	};
	const progress = [];
	const result = await queryDevices(api, ['C25804', 'C2', 'C3'], (rows) => progress.push(rows.length));
	assert.deepEqual(progress, [1, 2, 3]);
	assert.deepEqual(
		result.rows.map((row) => row.status),
		['matched', 'missing', 'error'],
	);
	assert.equal((await createArchive(api, result)).size, 100);
	await assert.rejects(createArchive(api, { rows: [] }), /No matched/);
	await assert.rejects(createArchive({ sys_FileManager: { getDeviceFileByDeviceUuid: async () => undefined } }, result), /Empty/);
	const compiled = fs.readFileSync(require.resolve('../dist/index.js'), 'utf8');
	for (const version of ['2.2.34', '3.2.0', '4.1.72.f96aaf3a', 'v4.0.0', '10.0.0']) {
		const opened = [];
		const context = vm.createContext({
			eda: {
				sys_Environment: { getEditorCurrentVersion: async () => version },
				sys_IFrame: { openIFrame: async (...args) => opened.push(args) },
			},
		});
		vm.runInContext(compiled, context);
		await context.edaEsbuildExportName.exportDeviceArchiveWithLcscId();
		assert.equal(opened.length, 1);
		assert.equal(opened[0][0].endsWith('-v4.html'), !['2.2.34', '3.2.0'].includes(version));
	}
	console.log('PASS: input validation, exact matching, pagination, partial failures, archive format, empty archives and V2/V3/V4/V10 routing');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
