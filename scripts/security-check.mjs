import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/graphPanel.ts', import.meta.url), 'utf8');
const extension = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const scanner = readFileSync(new URL('../src/scanner.ts', import.meta.url), 'utf8');
const panelWithoutSvgNamespace = panel.replace('http://www.w3.org/2000/svg', '');

const failures = [];

if (!panel.includes("default-src 'none'")) failures.push('Webview CSP must default to none.');
if (!panel.includes('localResourceRoots: []')) failures.push('Webview local resource access must be disabled.');
if (/https?:\/\//.test(panelWithoutSvgNamespace)) failures.push('Webview must not reference external network resources.');
if (/child_process|exec\(|spawn\(/.test(extension + scanner)) failures.push('Extension must not execute workspace code or processes.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Security invariants passed: no process execution, no remote webview resources, strict CSP.');
