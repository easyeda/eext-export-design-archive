(function (root) {
	'use strict';

	function parseIds(value) {
		const tokens = value
			.trim()
			.toUpperCase()
			.split(/[\s,，;；、]+/)
			.filter(Boolean);
		const unique = [...new Set(tokens)];
		return {
			ids: unique.filter((id) => /^C[1-9]\d*$/.test(id)),
			invalid: unique.filter((id) => !/^C[1-9]\d*$/.test(id)),
			duplicates: tokens.length - unique.length,
		};
	}

	async function findDevice(api, id, libraryUuid) {
		// V4 currently returns no system-library matches from getByLcscIds.
		// Search without a symbol-type restriction, then require an exact supplier ID.
		const seen = new Set();
		for (let page = 1; ; page++) {
			const results = await api.lib_Device.search(id, libraryUuid, undefined, undefined, 50, page);
			if (!Array.isArray(results)) throw new Error('Invalid device search response');
			const match = results.find(
				(item) =>
					String(item.supplierId || '')
						.trim()
						.toUpperCase() === id && item.uuid,
			);
			if (match) return match;
			if (results.length < 50) return undefined;
			const signature = results.map((item) => item.uuid).join(',');
			if (seen.has(signature)) throw new Error('Device search pagination did not advance');
			seen.add(signature);
		}
	}

	async function queryDevices(api, ids, onProgress) {
		const libraryUuid = await api.lib_LibrariesList.getSystemLibraryUuid();
		if (!libraryUuid) throw new Error('System library unavailable');
		const rows = [];
		for (const id of ids) {
			let row;
			try {
				const device = await findDevice(api, id, libraryUuid);
				row = { id, device, status: device ? 'matched' : 'missing' };
			} catch (error) {
				row = { id, status: 'error', error: String(error.message || error) };
			}
			rows.push(row);
			onProgress(rows.slice());
		}
		return { libraryUuid, rows };
	}

	async function createArchive(api, result) {
		const uuids = [...new Set(result.rows.filter((row) => row.device).map((row) => row.device.uuid))];
		if (!uuids.length) throw new Error('No matched devices');
		const file = await api.sys_FileManager.getDeviceFileByDeviceUuid(uuids, result.libraryUuid, 'elibz2');
		if (!file || !file.size) throw new Error('Empty device archive');
		return file;
	}

	const exports = { parseIds, findDevice, queryDevices, createArchive };
	if (typeof module !== 'undefined' && module.exports) module.exports = exports;
	else root.lcscExportV4 = exports;
})(globalThis);
