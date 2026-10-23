(function (root) {
	'use strict';
	// Kept self-contained so filtering can run in a terminable worker.
	function filterIndices(rows, rules, caseSensitive) {
		const tests = rules
			.filter((rule) => rule.value !== '')
			.map((rule) => {
				const expected = caseSensitive ? rule.value : rule.value.toLocaleLowerCase();
				return (row) => {
					const cells = rule.field === -1 ? row : [row[rule.field]];
					const found = cells.some((cell) => {
						const text = String(cell ?? '');
						const value = caseSensitive ? text : text.toLocaleLowerCase();
						return rule.mode === 'equals' ? value === expected : value.includes(expected);
					});
					return rule.mode === 'excludes' ? !found : found;
				};
			});
		const indices = [];
		for (let i = 0; i < rows.length; i++) if (tests.every((test) => test(rows[i]))) indices.push(i);
		return indices;
	}
	function selectedVisible(indices, selected) {
		return indices.filter((index) => selected.has(index));
	}
	const exported = { filterIndices, selectedVisible };
	if (typeof module !== 'undefined' && module.exports) module.exports = exported;
	else root.deviceListModel = exported;
})(globalThis);
