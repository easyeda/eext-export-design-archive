/* global eda, XLSX, deviceListSource, deviceListModel */
(async function () {
	'use strict';
	const api = typeof eda !== 'undefined' ? eda : window.parent?.eda;
	const $ = (id) => document.getElementById(id);
	const t = (key, ...args) =>
		api?.sys_I18n ? api.sys_I18n.text(key, undefined, undefined, ...args) : key.replace(/\$\{(\d+)\}/g, (_, i) => args[i - 1]);
	document.title = t('Get Device List');
	document.querySelectorAll('[data-i18n]').forEach((el) => {
		el.textContent = t(el.dataset.i18n);
	});
	document.querySelector('table').setAttribute('aria-label', t('Get Device List'));
	const state = { headers: [], rows: [], visible: [], selected: new Set(), page: 0, busy: false, dirty: false, sorting: null };
	const pageSize = 100;
	let rules = [],
		worker,
		timer,
		pendingReject;
	let activeMenu;
	function closeMenu() {
		if (activeMenu) {
			activeMenu.hidden = true;
			activeMenu.trigger.setAttribute('aria-expanded', 'false');
			activeMenu = null;
		}
	}
	document.addEventListener('click', (event) => {
		if (activeMenu && !activeMenu.contains(event.target) && event.target !== activeMenu.trigger) closeMenu();
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') closeMenu();
	});
	document.addEventListener('scroll', closeMenu, true);
	function dropdown(options, initial, onChange, label) {
		const root = document.createElement('div');
		root.className = 'dropdown';
		const trigger = document.createElement('button');
		trigger.className = 'dropdown-trigger';
		trigger.type = 'button';
		trigger.setAttribute('aria-label', label);
		trigger.setAttribute('aria-expanded', 'false');
		trigger.setAttribute('aria-haspopup', 'listbox');
		const menu = document.createElement('div');
		menu.className = 'dropdown-options';
		menu.hidden = true;
		menu.trigger = trigger;
		menu.setAttribute('role', 'listbox');
		let current = initial;
		function update() {
			trigger.textContent = options.find((option) => option.value === current)?.label || '—';
		}
		for (const option of options) {
			const button = document.createElement('button');
			button.textContent = option.label;
			button.type = 'button';
			button.setAttribute('role', 'option');
			button.onclick = () => {
				current = option.value;
				update();
				closeMenu();
				trigger.focus();
				onChange(current);
			};
			button.onkeydown = (e) => {
				if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
					e.preventDefault();
					(e.key === 'ArrowDown' ? button.nextElementSibling : button.previousElementSibling)?.focus();
				}
			};
			menu.append(button);
		}
		trigger.onclick = () => {
			if (activeMenu === menu) {
				closeMenu();
				return;
			}
			closeMenu();
			const rect = trigger.getBoundingClientRect();
			menu.style.left = rect.left + 'px';
			menu.style.top = rect.bottom + 'px';
			menu.style.minWidth = rect.width + 'px';
			menu.style.maxHeight = Math.max(48, Math.min(220, innerHeight - rect.bottom - 8)) + 'px';
			menu.hidden = false;
			activeMenu = menu;
			trigger.setAttribute('aria-expanded', 'true');
			menu.querySelector('button')?.focus();
		};
		root.append(trigger, menu);
		update();
		return root;
	}
	function cancelFilter() {
		if (worker) worker.terminate();
		worker = null;
		clearTimeout(timer);
		if (pendingReject) {
			pendingReject(new Error(t('筛选已取消')));
			pendingReject = null;
		}
	}
	window.addEventListener('pagehide', cancelFilter);
	function dirty() {
		state.dirty = true;
		$('filterError').textContent = t('筛选条件已修改，请应用筛选');
		updateControls();
	}
	function addRule() {
		const rule = { field: -1, mode: 'contains', value: '' };
		const row = document.createElement('div');
		row.className = 'rule';
		row.append(
			dropdown(
				[{ value: -1, label: t('全部字段') }, ...state.headers.map((name, value) => ({ value, label: t(name) }))],
				-1,
				(value) => {
					rule.field = value;
					dirty();
				},
				t('筛选字段'),
			),
		);
		row.append(
			dropdown(
				['contains', 'equals', 'excludes'].map((value, index) => ({
					value,
					label: t(['包含', '完全相等', '不包含'][index]),
				})),
				'contains',
				(value) => {
					rule.mode = value;
					dirty();
				},
				t('匹配方式'),
			),
		);
		const input = document.createElement('input');
		input.type = 'text';
		input.placeholder = t('输入要筛选的文本');
		input.setAttribute('aria-label', t('筛选值'));
		input.oninput = () => {
			rule.value = input.value;
			dirty();
		};
		input.onkeydown = (e) => {
			if (e.key === 'Enter' && !state.busy) applyFilter();
		};
		const remove = document.createElement('button');
		remove.className = 'remove';
		remove.textContent = t('删除');
		remove.onclick = () => {
			rules = rules.filter((item) => item !== rule);
			row.remove();
			dirty();
		};
		row.append(input, remove);
		$('rules').append(row);
		rules.push(rule);
	}
	function updateControls() {
		const count = deviceListModel.selectedVisible(state.visible, state.selected).length;
		$('summary').textContent = t(
			'共 ${1} 项 · 筛选 ${2} 项 · 当前已选 ${3} 项 · 筛选外已选 ${4} 项',
			state.rows.length,
			state.visible.length,
			count,
			state.selected.size - count,
		);
		$('export').disabled = state.busy || state.dirty || count === 0;
		$('selectFiltered').disabled = state.busy || state.dirty || !state.visible.length;
		$('clearSelection').disabled = state.busy || !state.selected.size;
		$('previous').disabled = state.busy || state.page === 0;
		$('next').disabled = state.busy || (state.page + 1) * pageSize >= state.visible.length;
		$('page').textContent = `${state.visible.length ? state.page + 1 : 0} / ${Math.ceil(state.visible.length / pageSize)}`;
	}
	function setBusy(value) {
		state.busy = value;
		closeMenu();
		document.querySelectorAll('.toolbar button, .filters button, .filters input').forEach((el) => {
			el.disabled = value;
		});
		$('load').disabled = value || !libraryUuid;
		$('progress').hidden = !value;
		if (value) $('progress').removeAttribute('value');
		renderTable();
	}
	function renderTable() {
		$('head').replaceChildren();
		$('rows').replaceChildren();
		const indices = state.visible.slice(state.page * pageSize, (state.page + 1) * pageSize);
		const tr = document.createElement('tr'),
			cell = document.createElement('th'),
			check = document.createElement('input');
		check.type = 'checkbox';
		check.setAttribute('aria-label', t('勾选本页'));
		const selected = indices.filter((id) => state.selected.has(id)).length;
		check.checked = indices.length > 0 && selected === indices.length;
		check.indeterminate = selected > 0 && selected < indices.length;
		check.disabled = state.busy || state.dirty || !indices.length;
		check.onchange = () => {
			for (const id of indices) check.checked ? state.selected.add(id) : state.selected.delete(id);
			renderTable();
		};
		cell.append(check);
		tr.append(cell);
		state.headers.forEach((name, column) => {
			const th = document.createElement('th'),
				button = document.createElement('button');
			button.textContent = t(name) + (state.sorting?.column === column ? (state.sorting.direction === 1 ? ' ↑' : ' ↓') : '');
			button.disabled = state.busy;
			button.onclick = () => {
				state.sorting = { column, direction: state.sorting?.column === column ? -state.sorting.direction : 1 };
				sortVisible();
				state.page = 0;
				renderTable();
			};
			th.append(button);
			tr.append(th);
		});
		$('head').append(tr);
		for (const id of indices) {
			const row = document.createElement('tr');
			row.className = state.selected.has(id) ? 'selected' : '';
			const td = document.createElement('td'),
				input = document.createElement('input');
			input.type = 'checkbox';
			input.checked = state.selected.has(id);
			input.disabled = state.busy || state.dirty;
			input.setAttribute('aria-label', t('选择 ${1}', String(state.rows[id][0] || id + 1)));
			input.onchange = () => {
				input.checked ? state.selected.add(id) : state.selected.delete(id);
				renderTable();
			};
			td.append(input);
			row.append(td);
			for (const value of state.rows[id]) {
				const td = document.createElement('td');
				td.textContent = String(value ?? '');
				td.title = td.textContent;
				row.append(td);
			}
			$('rows').append(row);
		}
		if (!indices.length) {
			const row = document.createElement('tr'),
				td = document.createElement('td');
			td.colSpan = state.headers.length + 1;
			td.className = 'empty';
			td.textContent = t(state.rows.length ? '没有符合筛选条件的器件' : '请选择库并点击“读取”');
			row.append(td);
			$('rows').append(row);
		}
		updateControls();
	}
	function sortVisible() {
		if (state.sorting) {
			const { column, direction } = state.sorting;
			state.visible.sort(
				(a, b) =>
					direction * String(state.rows[a][column] ?? '').localeCompare(String(state.rows[b][column] ?? ''), undefined, { numeric: true }),
			);
		}
	}
	async function applyFilter() {
		if (state.busy) return;
		setBusy(true);
		$('filterError').textContent = '';
		$('messageBar').textContent = t('正在筛选…');
		try {
			const indices = await new Promise((resolve, reject) => {
				pendingReject = reject;
				const source = `const filterIndices = ${deviceListModel.filterIndices.toString()}; onmessage = ({data}) => { try { postMessage({indices:filterIndices(data.rows,data.rules,data.caseSensitive)}); } catch(error) { postMessage({error:error.message}); } };`;
				const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
				try {
					worker = new Worker(url);
				} finally {
					URL.revokeObjectURL(url);
				}
				worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data.indices));
				worker.onerror = () => reject(new Error(t('筛选执行失败')));
				timer = setTimeout(() => reject(new Error(t('筛选耗时过长，请缩小数据范围'))), 5000);
				worker.postMessage({ rows: state.rows, rules, caseSensitive: $('caseSensitive').checked });
			});
			state.visible = indices;
			state.page = 0;
			state.dirty = false;
			sortVisible();
			$('messageBar').textContent = t('筛选完成，请勾选需要导出的器件');
		} catch (error) {
			state.dirty = true;
			$('filterError').textContent = t('筛选未应用：${1}', error.message);
		} finally {
			pendingReject = null;
			cancelFilter();
			setBusy(false);
		}
	}
	function resetFilters() {
		closeMenu();
		rules = [];
		$('rules').replaceChildren();
		$('caseSensitive').checked = false;
		addRule();
		state.visible = state.rows.map((_, i) => i);
		state.page = 0;
		state.dirty = false;
		sortVisible();
		$('filterError').textContent = '';
		renderTable();
	}
	let libraryUuid = '';
	$('addRule').onclick = () => {
		addRule();
		dirty();
	};
	$('caseSensitive').onchange = dirty;
	$('apply').onclick = applyFilter;
	$('reset').onclick = resetFilters;
	$('previous').onclick = () => {
		state.page--;
		renderTable();
	};
	$('next').onclick = () => {
		state.page++;
		renderTable();
	};
	$('selectFiltered').onclick = () => {
		for (const id of state.visible) state.selected.add(id);
		renderTable();
	};
	$('clearSelection').onclick = () => {
		state.selected.clear();
		renderTable();
	};
	$('load').onclick = async () => {
		if (!libraryUuid || state.busy) return;
		state.rows = [];
		state.headers = [];
		state.visible = [];
		state.selected.clear();
		state.sorting = null;
		resetFilters();
		setBusy(true);
		try {
			const result = await deviceListSource.createSource(api).load(libraryUuid, (loaded, total, building) => {
				if (total > 0) {
					$('progress').max = total;
					$('progress').value = loaded;
				} else $('progress').removeAttribute('value');
				$('messageBar').textContent = building ? t('正在建表 ${1}/${2}', loaded, total) : t('已读取 ${1} 项', loaded);
			});
			state.headers = result.headers;
			state.rows = result.rows;
			resetFilters();
			$('messageBar').textContent = t(result.rows.length ? '建表完成，请筛选并勾选导出' : 'No devices in this library');
		} catch (error) {
			$('messageBar').textContent = t('读取失败：${1}', error.message);
		} finally {
			setBusy(false);
		}
	};
	$('export').onclick = async () => {
		if (state.busy || state.dirty) return;
		const selected = deviceListModel.selectedVisible(state.visible, state.selected);
		if (!selected.length) return;
		setBusy(true);
		try {
			let files = 0;
			for (let offset = 0; offset < selected.length; offset += 5000) {
				const ids = selected.slice(offset, offset + 5000);
				$('messageBar').textContent = t('正在生成清单 ${1}/${2}', offset + ids.length, selected.length);
				await new Promise((resolve) => setTimeout(resolve, 0));
				const sheet = XLSX.utils.aoa_to_sheet([state.headers, ...ids.map((id) => state.rows[id])]);
				const book = XLSX.utils.book_new();
				XLSX.utils.book_append_sheet(book, sheet, 'DeviceList');
				const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
				const file = new File([bytes], `DeviceList_${new Date().toISOString().slice(0, 10)}_part${++files}.xlsx`, {
					type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				});
				await api.sys_FileSystem.saveFile(file);
				$('progress').max = selected.length;
				$('progress').value = offset + ids.length;
			}
			$('messageBar').textContent = t('已生成 ${1} 项、${2} 个文件，请确认保存结果', selected.length, files);
		} catch (error) {
			$('messageBar').textContent = t('Export error: ${1}', error.message);
		} finally {
			setBusy(false);
		}
	};
	resetFilters();
	try {
		const [others, personal, project, favorites] = await Promise.all([
			api.lib_LibrariesList.getAllLibrariesList(),
			api.lib_LibrariesList.getPersonalLibraryUuid(),
			api.lib_LibrariesList.getProjectLibraryUuid(),
			api.lib_LibrariesList.getFavoriteLibraryUuid(),
		]);
		const libraries = [
			{ uuid: personal, name: t('Personal') },
			{ uuid: project, name: t('Project') },
			{ uuid: favorites, name: t('Favorites') },
			...(others || []),
		].filter((lib, i, all) => lib.uuid && all.findIndex((item) => item.uuid === lib.uuid) === i);
		$('library').append(
			dropdown(
				[{ value: '', label: t('Please select a library first') }, ...libraries.map((lib) => ({ value: lib.uuid, label: lib.name }))],
				'',
				(value) => {
					libraryUuid = value;
					state.rows = [];
					state.headers = [];
					state.selected.clear();
					state.sorting = null;
					resetFilters();
					$('load').disabled = !value;
					$('messageBar').textContent = t('请选择库并点击“读取”');
				},
				t('Export library:'),
			),
		);
	} catch (error) {
		$('messageBar').textContent = t('读取失败：${1}', error.message);
	}
})();
