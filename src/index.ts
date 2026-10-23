import * as extensionConfig from '../extension.json';

async function getEditorMajorVersion(): Promise<number> {
	// The bundled API types predate this runtime method.
	const environment = eda.sys_Environment as typeof eda.sys_Environment & {
		getEditorCurrentVersion: () => Promise<string>;
	};
	const version = await environment.getEditorCurrentVersion();
	return Number.parseInt(version.replace(/^v/i, '').split('.')[0], 10);
}

type TActivateStatus =
	| 'onCommands'
	| 'onLanguages'
	| 'onProjectOpened'
	| 'onEditorSchematic'
	| 'onEditorSymbol'
	| 'onEditorPcb'
	| 'onEditorFootprint'
	| 'onEditorPanel'
	| 'onStartupFinished'
	| 'onLogged';

/**
 * 扩展激活方法
 *
 * @param status - 扩展激活时机
 * @param arg - 激活参数
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function activate(status?: TActivateStatus, arg?: string): void {}

/**
 * 导出工程压缩包
 */
export async function exportProjectArchive(): Promise<void> {
	eda.sys_IFrame.openIFrame('/iframe/export-project-archive.html', 350, 180);
}

/**
 * 导出器件压缩包
 */
export async function exportDeviceArchive(): Promise<void> {
	const v3 = (await getEditorMajorVersion()) >= 3;
	if (v3) {
		eda.sys_IFrame.openIFrame('/iframe/export-device-archive-v3.html', 350, 460);
	} else {
		eda.sys_IFrame.openIFrame('/iframe/export-device-archive-v2.html', 350, 280);
	}
}
/**
 * 导出封装压缩包
 */
export async function exportFootprintArchive(): Promise<void> {
	eda.sys_IFrame.openIFrame('/iframe/export-footprint-archive.html', 350, 300);
}

/**
 * 导出器件压缩包（根据立创编号）
 */
export async function exportDeviceArchiveWithLcscId(): Promise<void> {
	const major = await getEditorMajorVersion();
	if (major >= 4) {
		await eda.sys_IFrame.openIFrame('/iframe/export-device-archive-with-lcsc-id-v4.html', 600, 460);
	} else {
		await eda.sys_IFrame.openIFrame('/iframe/export-device-archive-with-lcsc-id.html', 350, 170);
	}
}

/**
 * 导出器件清单
 */
export async function exportDeviceList(): Promise<void> {
	await eda.sys_IFrame.openIFrame('/iframe/export-device-list.html', 850, 620);
}

/**
 * 关于
 */
export async function about(): Promise<void> {
	eda.sys_MessageBox.showInformationMessage(
		eda.sys_I18n.text('Export Design Archive Tool', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('About'),
	);
}
