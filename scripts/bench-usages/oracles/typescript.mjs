import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const SAMPLE = 500;
const DECLARATIONS = [
  ts.isFunctionDeclaration,
  ts.isClassDeclaration,
  ts.isInterfaceDeclaration,
  ts.isTypeAliasDeclaration,
  ts.isEnumDeclaration,
];

function languageService(root, tsconfig) {
  const configPath = resolve(root, tsconfig);
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!config) throw new Error(`cannot read ${tsconfig}`);
  const host = {
    getScriptFileNames: () => config.fileNames,
    getScriptVersion: () => '1',
    getScriptSnapshot: (file) => {
      const text = ts.sys.readFile(file);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => dirname(configPath),
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  return { service: ts.createLanguageService(host), projectDir: dirname(configPath) };
}

const isExported = (node) =>
  node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

function exportedDeclarations(program, inScope) {
  const found = [];
  for (const source of program.getSourceFiles()) {
    if (!inScope(source.fileName)) continue;
    ts.forEachChild(source, (node) => {
      if (!node.name || !isExported(node) || !DECLARATIONS.some((test) => test(node))) return;
      found.push({ name: node.name.text, file: source.fileName, pos: node.name.getStart(source) });
    });
  }
  const counts = new Map();
  for (const declaration of found) {
    counts.set(declaration.name, (counts.get(declaration.name) ?? 0) + 1);
  }
  return found.filter((declaration) => counts.get(declaration.name) === 1);
}

function evenSample(list, size) {
  const step = Math.max(1, Math.ceil(list.length / size));
  return list.filter((_, index) => index % step === 0);
}

function classify(source, position) {
  let bucket = 'use';
  ts.forEachChild(source, function visit(node) {
    if (node.getStart(source) > position || position >= node.getEnd()) return;
    if (ts.isJsxClosingElement(node)) bucket = 'skip';
    else if (ts.isExportSpecifier(node) && bucket !== 'skip') bucket = 'reexport';
    else if ((ts.isImportSpecifier(node) || ts.isImportClause(node)) && bucket === 'use') {
      bucket = 'import';
    }
    ts.forEachChild(node, visit);
  });
  return bucket;
}

function referencesOf(service, program, declaration, inScope) {
  const found = [];
  for (const group of service.findReferences(declaration.file, declaration.pos) ?? []) {
    for (const reference of group.references) {
      if (reference.isDefinition || !inScope(reference.fileName)) continue;
      const source = program.getSourceFile(reference.fileName);
      if (!source) continue;
      const bucket = classify(source, reference.textSpan.start);
      if (bucket === 'skip') continue;
      const line = source.getLineAndCharacterOfPosition(reference.textSpan.start).line + 1;
      found.push({ bucket, file: reference.fileName, line });
    }
  }
  return found;
}

export function expected({ root, entry }) {
  const { service, projectDir } = languageService(root, entry.tsconfig ?? 'tsconfig.json');
  const program = service.getProgram();
  const inScope = (file) =>
    file.startsWith(`${projectDir}${sep}`) &&
    !file.includes(`${sep}node_modules${sep}`) &&
    !file.endsWith('.d.ts');

  const sample = evenSample(exportedDeclarations(program, inScope), SAMPLE);
  const targets = new Set();
  const entries = [];
  for (const declaration of sample) {
    const target = `${relative(root, declaration.file)}\0${declaration.name}`;
    targets.add(target);
    for (const reference of referencesOf(service, program, declaration, inScope)) {
      entries.push({
        bucket: reference.bucket,
        file: relative(root, reference.file),
        line: reference.line,
        target,
        name: declaration.name,
      });
    }
  }
  return {
    entries,
    inScope: (symbol) => targets.has(`${symbol.file}\0${symbol.name}`),
    note: `${sample.length} exported declarations sampled`,
  };
}
