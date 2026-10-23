(function (root) {
	function createSource(api) {
		var REST_PAGE_SIZE = 5000;
		// 本地库（工程库等未被服务端接口收录的库）走官方本地 API 逐页枚举
		var LOCAL_PAGE_SIZE = 300;
		// ELIB_SymbolType.COMPONENT —— 只枚举器件，排除图纸、电源/接地标识等非器件符号
		var SYMBOL_TYPE_COMPONENT = 2;
		var CHUNK_SIZE = 5000;

		// 这些属性已作为固定列输出，不再重复出现在「自定义属性」中
		var EXCLUDED_ATTRIBUTE_KEYS = new Set([
			'3D Model Title',
			'Add into BOM',
			'Convert to PCB',
			'Device',
			'Primary Category',
			'Secondary Category',
			'Part Number',
			'Designator',
			'Name',
			'Manufacturer',
			'Manufacturer Part',
			'Supplier',
			'Supplier Part',
			'Value',
			'Datasheet',
			'Description',
			'3D Model',
			'3D Model Transform',
			'Comment',
			'Footprint',
			'LCSC Part Name',
			'Supplier Footprint',
			'Symbol',
		]);

		var CLASS_CACHE = new Map();

		/**
		 * 把器件对象归一化成「属性名 -> 值」的表。
		 * 服务端接口用 attributes，官方本地接口用 otherProperty，两者字段意义一致。
		 */
		function toAttributeBag(dev) {
			var bag = {};
			var p = dev.attributes || dev.otherProperty || {};
			for (var k in p) {
				if (Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined && p[k] !== null) {
					bag[k] = p[k];
				}
			}
			function fill(key, value) {
				if (bag[key] === undefined && value !== undefined && value !== null && value !== '') bag[key] = value;
			}
			fill('Manufacturer', dev.manufacturer);
			fill('Manufacturer Part', dev.manufacturerId);
			fill('Supplier', dev.supplier);
			fill('Supplier Part', dev.supplierId);
			fill('Description', dev.description);
			fill('3D Model Title', dev.model3DName);
			return bag;
		}

		/** 关联文档名称：服务端接口给 symbol/footprint 对象，本地接口给 symbolName/footprintName */
		function relatedName(obj, info, flat) {
			if (obj && (obj.display_title || obj.name || obj.title)) return obj.display_title || obj.name || obj.title;
			if (info && (info.display_title || info.name || info.title)) return info.display_title || info.name || info.title;
			return flat || '';
		}

		/** 标签既可能是数组也可能是对象，取首个名称 */
		function tagName(tag) {
			if (!tag) return '';
			if (Array.isArray(tag)) return tag.length ? tag[0].name || tag[0].display_title || '' : '';
			return tag.name || tag.display_title || '';
		}

		/** 分类名称：优先用服务端返回的 tags，其次用本地分类接口解析 */
		async function resolveCategories(dev) {
			var fromTags = {
				primary: tagName(dev.tags && dev.tags.parent_tag),
				secondary: tagName(dev.tags && dev.tags.child_tag),
			};
			if (fromTags.primary || fromTags.secondary) return fromTags;

			var classification = dev.classification;
			if (Array.isArray(classification)) return { primary: classification[0] || '', secondary: classification[1] || '' };
			if (!classification || !classification.primaryClassificationUuid) return { primary: '', secondary: '' };
			var key = [
				classification.libraryUuid,
				classification.libraryType,
				classification.primaryClassificationUuid,
				classification.secondaryClassificationUuid,
			].join('|');
			if (!CLASS_CACHE.has(key)) {
				var value = { primary: '', secondary: '' };
				try {
					var names = await api.lib_Classification.getNameByIndex(classification);
					if (names) {
						value = {
							primary: names.primaryClassificationName || '',
							secondary: names.secondaryClassificationName || '',
						};
					}
				} catch (e) {
					console.error('分类名称解析失败:', classification, e);
				}
				CLASS_CACHE.set(key, value);
			}
			return CLASS_CACHE.get(key);
		}

		/**
		 * 服务端接口拉取：/api/v2/devices?uid=<库UUID>&page=1&pageSize=5000
		 * 一次请求返回全量（count 为总数），仅当超过 pageSize 才继续翻页。
		 * 注意：不要带 path 参数，带了会导致空响应。
		 */
		async function fetchViaRest(libUuid, onProgress) {
			var all = [];
			var page = 1;
			const seen = new Set();
			while (true) {
				var url =
					window.location.origin + '/api/v2/devices?uid=' + encodeURIComponent(libUuid) + '&page=' + page + '&pageSize=' + REST_PAGE_SIZE;
				var res = await fetch(url);
				if (!res.ok) throw new Error('HTTP ' + res.status);
				var data = await res.json();
				var result = data && data.result;
				var lists = (result && result.lists) || [];
				if (!Array.isArray(lists)) throw new Error('Invalid device list response');
				if (!lists.length) break;
				const signature = JSON.stringify(lists);
				if (seen.has(signature)) throw new Error('Device list pagination did not advance');
				seen.add(signature);
				all.push.apply(all, lists);
				if (onProgress) onProgress(all.length, result && result.count);
				var total = result && result.count;
				if (total && all.length >= total) break;
				if (!total && lists.length < REST_PAGE_SIZE) break;
				page++;
			}
			return all;
		}

		/**
		 * 官方本地 API 兜底：工程库等库不在服务端接口里（返回 0），只能本地逐页枚举。
		 */
		async function fetchViaLocal(libUuid, onProgress) {
			var all = [];
			var page = 1;
			const seen = new Set();
			while (true) {
				var devs = await api.lib_Device.search('', libUuid, undefined, SYMBOL_TYPE_COMPONENT, LOCAL_PAGE_SIZE, page);
				if (!devs || devs.length === 0) break;
				const signature = JSON.stringify(devs);
				if (seen.has(signature)) throw new Error('Device list pagination did not advance');
				seen.add(signature);
				all.push.apply(all, devs);
				if (onProgress) onProgress(all.length, null);
				if (devs.length < LOCAL_PAGE_SIZE) break;
				page++;
			}
			return all;
		}

		async function buildRow(item, extraAttributeNames) {
			const attrs = toAttributeBag(item);
			const categories = await resolveCategories(item);
			const pick = (key, fallback) => (attrs[key] !== undefined && attrs[key] !== null ? attrs[key] : fallback || '');
			const supplierPart = pick('Supplier Part', item.supplierId);

			const baseValues = [
				item.display_title || item.name || '',
				relatedName(item.symbol, item.symbol_info, item.symbolName),
				relatedName(item.footprint, item.footprint_info, item.footprintName),
				pick('3D Model Title', relatedName(item.model3D, null, item.model3DName)),
				categories.primary,
				categories.secondary,
				pick('Add into BOM'),
				pick('Convert to PCB'),
				pick('Designator'),
				pick('Name'),
				pick('Manufacturer', item.manufacturer),
				pick('Manufacturer Part', item.manufacturerId),
				pick('Supplier', item.supplier),
				supplierPart,
				supplierPart,
				pick('Value'),
				pick('Datasheet'),
				pick('Description', item.description),
			];

			const extraValues = extraAttributeNames.map((key) => {
				const value = attrs[key];
				if (value === undefined || value === null) return '';
				return typeof value === 'object' ? JSON.stringify(value) : String(value);
			});

			return [...baseValues, ...extraValues];
		}

		const baseHeaders = [
			'Device',
			'Symbol',
			'Footprint',
			'3D Model',
			'Primary Category',
			'Secondary Category',
			'Add into BOM',
			'Convert to PCB',
			'Designator',
			'Name',
			'Manufacturer',
			'Manufacturer Part',
			'Supplier',
			'Supplier Part',
			'Part Number',
			'Value',
			'Datasheet',
			'Description',
		];
		async function load(libraryUuid, onProgress) {
			CLASS_CACHE.clear();
			let devices;
			try {
				devices = await fetchViaRest(libraryUuid, onProgress);
			} catch {
				devices = [];
			}
			if (!devices.length) devices = await fetchViaLocal(libraryUuid, onProgress);
			const extras = new Set();
			for (const device of devices)
				for (const key of Object.keys(toAttributeBag(device))) if (!EXCLUDED_ATTRIBUTE_KEYS.has(key)) extras.add(key);
			const extraNames = [...extras].sort();
			const rows = [];
			for (let i = 0; i < devices.length; i++) {
				rows.push(await buildRow(devices[i], extraNames));
				if (i % 100 === 0 || i === devices.length - 1) {
					onProgress(i + 1, devices.length, true);
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			}
			return { headers: [...baseHeaders, ...extraNames], rows };
		}
		return { load };
	}
	root.deviceListSource = { createSource };
})(globalThis);
