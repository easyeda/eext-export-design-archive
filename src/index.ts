import * as extensionConfig from '../extension.json';

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
	eda.sys_IFrame.openIFrame('/iframe/export-project-archive.html', 350, 195);
}

/**
 * 导出器件压缩包
 */
export async function exportDeviceArchive(): Promise<void> {
	eda.sys_IFrame.openIFrame('/iframe/export-device-archive.html', 350, 280);
}
/**
 * 导出封装压缩包
 */
export async function exportFootprintArchive(): Promise<void> {
	eda.sys_IFrame.openIFrame('/iframe/export-footprint-archive.html', 350, 280);
}

/**
 * 导出器件压缩包（根据立创编号）
 */
export async function exportDeviceArchiveWithLcscId(): Promise<void> {
	eda.sys_IFrame.openIFrame('/iframe/export-device-archive-with-lcsc-id.html', 350, 196);
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
