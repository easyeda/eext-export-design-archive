/**
 * 桥接自动导入脚本
 * 扫描桥接端口 → 临时 HTTP 服务托管 .eext → 通过 /execute 导入 → 清理
 */
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

// 1. 导入当前清单对应的构建产物，避免误选历史版本。
const manifest = JSON.parse(readFileSync(join(__dirname, '../extension.json'), 'utf8'));
const eextFile = `${manifest.name}_v${manifest.version}.eext`;
const eextPath = join(distDir, eextFile);
const eextData = readFileSync(eextPath);
console.log(`Found: ${eextFile} (${(eextData.length / 1024).toFixed(1)} KB)`);

// 2. 找到桥接端口
let bridgePort = null;
for (let port = 49620; port <= 49629; port++) {
    try {
        const resp = await fetch(`http://localhost:${port}/health`);
        const json = await resp.json();
        if (json.service === 'easyeda-bridge') {
            bridgePort = port;
            console.log(`Bridge found on port ${port}, edaConnected: ${json.edaConnected}`);
            break;
        }
    } catch (e) { }
}

if (!bridgePort) {
    console.error('Bridge server not found on ports 49620-49629');
    process.exit(1);
}

// 3. 启动临时 HTTP 服务托管 .eext
const HTTP_PORT = 19876;
const server = createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(eextData);
});

await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));
console.log(`Serving .eext on http://127.0.0.1:${HTTP_PORT}/`);

// 4. 通过桥接导入
try {
    const importCode = [
        `var r = await fetch("http://127.0.0.1:${HTTP_PORT}/");`,
        'var b = await r.arrayBuffer();',
        'var f = new File([b], "p.eext", { type: "application/zip" });',
        'return await window.top._MSG_BUS2_EXTAPI_.rpcCall(',
        '  "extensionApi.importExtensionPackages",',
        '  { files: [f], action: "import" },',
        '  30000',
        ');',
    ].join('');

    const resp = await fetch(`http://localhost:${bridgePort}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: importCode, timeout: 120000 }),
    });
    const result = await resp.json();
    console.log('Import result:', JSON.stringify(result, null, 2));

    if (result.success) {
        console.log('✅ Extension imported successfully!');
    } else if (result.error) {
        console.error('❌ Import failed:', result.error);
    } else {
        console.log('Import response:', JSON.stringify(result));
    }
} catch (err) {
    console.error('Import error:', err.message);
}

// 5. 清理
server.close();
console.log('Done.');
