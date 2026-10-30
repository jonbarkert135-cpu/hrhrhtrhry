/** Raven's source audit: app-authored display text, not record content or transport diagnostics. */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
let hits = 0;
function audit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      audit(file);
      continue;
    }
    if (!file.endsWith('.tsx') || file.includes('.test.')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      const jsx = ts.isJsxText(node);
      const literal =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateTail(node);
      // Dot-delimited keys, addresses and URLs are data, rather than editorial full stops
      if (
        (jsx || (literal && (/\s/.test(node.text) || /^[A-Z]/.test(node.text)))) &&
        /[A-Za-z]\.[\s]*$/.test(node.text) &&
        !node.text.includes('://')
      ) {
        hits += 1;
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        console.error(`${file}:${line}: punct.ui-period ${node.text.trim().replace(/\s+/g, ' ')}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
audit('apps/web/src');
if (hits > 0) process.exitCode = 1;
else console.log('Display copy: no unwanted terminal full stops');
