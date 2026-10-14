const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, manifest.side_panel.default_path), 'utf8');
const references = [manifest.background.service_worker, ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap(script => script.js),
  ...Array.from(html.matchAll(/(?:src|href)="([^":]+\.(?:js|css|png))"/g), match => match[1])];
for (const file of references) {
  if (!fs.existsSync(path.join(root, file))) throw new Error('Missing extension asset: ' + file);
}
for (const file of fs.readdirSync(root).filter(file => file.endsWith('.js'))) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), {filename: file});
}
console.log('Browser companion manifest, assets and JavaScript validated.');
