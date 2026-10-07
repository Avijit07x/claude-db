import { utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { scanRepository } from '../../dist/graph/index.js';
import { cacheHome } from '../../dist/graph/scan/cache.js';
import { scopeToken } from '../../dist/util/scope.js';

const LATER_S = 120;

const JAVA = {
  'src/a/Base.java': 'package a;\n\npublic class Base {\n  public void close() {}\n}\n',
  'src/a/Item.java':
    'package a;\n\npublic class Item {\n  public String name() { return ""; }\n}\n',
  'src/a/Store.java':
    'package a;\n\npublic class Store extends Base {\n  public Item find(String id) { return null; }\n  public static Store of(int n) { return null; }\n  public static Store of(String s) { return null; }\n  public void save(Item item) { close(); }\n  public void close() { super.close(); }\n  interface Listener {\n    void changed();\n  }\n}\n',
  'src/b/Other.java':
    'package b;\n\npublic class Other {\n  public Object find(String id) { return null; }\n  public void close() {}\n  public void changed() {}\n  public int length() { return 0; }\n  public String name() { return ""; }\n}\n',
  'src/b/Use.java':
    'package b;\n\nimport a.Item;\nimport a.Store;\nimport java.util.List;\n\nclass Use {\n  private final Store store = new Store();\n  void run(Store s, String text, List<Item> items, Store.Listener listener) {\n    s.find("x");\n    store.find("y").name();\n    this.store.close();\n    text.length();\n    Store.of(1);\n    var made = new Store();\n    made.close();\n    var found = s.find("z");\n    found.name();\n    listener.changed();\n    items.forEach(item -> item.name());\n  }\n}\n',
};

async function cachedReceivers() {
  const { repo, git } = newRepo('graph-receivers-');
  for (const [path, text] of Object.entries(JAVA)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git('add', '-A');
  const fresh = await scanRepository({ root: repo, project: repo, force: true });
  const later = Date.now() / 1000 + LATER_S;
  utimesSync(join(cacheHome(), `${scopeToken(repo)}.json`), later, later);
  const warm = await scanRepository({ root: repo, project: repo });
  const key = (edge) => `${edge.id}|${edge.dstId}|${edge.confidence}`;
  const before = fresh.edges.map(key).sort();
  const after = warm.edges.map(key).sort();
  check(
    'receivers read back from the cache file link every call the same way',
    warm.changed.length === 0 &&
      before.length === after.length &&
      before.every((edge, index) => edge === after[index]),
    `${warm.changed.length} reparsed, ${before.length} vs ${after.length} edges`,
  );
}

export default async function run() {
  await cachedReceivers();
}
