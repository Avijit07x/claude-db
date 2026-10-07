import ast, json, os, subprocess, sys

root = sys.argv[1]
files = subprocess.run(['git', '-C', root, 'ls-files', '*.py', '*.pyi'], capture_output=True, text=True).stdout.split()
pyfiles = [f for f in files if f.endswith('.py')]
fileset = set(pyfiles)

def has_init(d):
    return (d + '/__init__.py' if d else '__init__.py') in fileset

def canonical(path):
    parts = path[:-3].split('/')
    is_pkg = parts[-1] == '__init__'
    if is_pkg:
        parts = parts[:-1]
    top = None
    for i in range(len(parts)):
        d = '/'.join(parts[: i + 1])
        if d != '/'.join(parts) or is_pkg:
            if has_init(d):
                top = i
                break
    if top is None:
        return (parts[-1] if parts else ''), is_pkg
    return '.'.join(parts[top:]), is_pkg

modname = {}
by_name = {}
for f in pyfiles:
    n, pkg = canonical(f)
    modname[f] = (n, pkg)
    by_name.setdefault(n, []).append(f)

def resolve_abs(name):
    c = by_name.get(name, [])
    return c[0] if len(c) == 1 else None

def resolve_rel(frm, level, module):
    n, pkg = modname[frm]
    base = n.split('.') if n else []
    if not pkg:
        base = base[:-1]
    if level - 1 > len(base):
        return None
    base = base[: len(base) - (level - 1)]
    full = '.'.join(base + ([module] if module else []))
    return resolve_abs(full) if full else None

trees = {}
for f in pyfiles:
    try:
        trees[f] = ast.parse(open(os.path.join(root, f), encoding='utf8', errors='replace').read())
    except Exception:
        pass

defs = {}
for f, t in trees.items():
    for node in t.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defs.setdefault(f, {}).setdefault(node.name, node.lineno)

imports = {}
for f, t in trees.items():
    named, mods = {}, {}
    for node in ast.walk(t):
        if isinstance(node, ast.ImportFrom):
            target = resolve_rel(f, node.level, node.module) if node.level else resolve_abs(node.module or '')
            for a in node.names:
                if a.name == '*':
                    continue
                named.setdefault(a.asname or a.name, []).append((target, a.name, node.level, node.module, node.lineno, a.lineno if hasattr(a,'lineno') else node.lineno))
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.asname:
                    mods[a.asname] = resolve_abs(a.name)
                else:
                    mods[a.name.split('.')[0]] = resolve_abs(a.name.split('.')[0])
    imports[f] = (named, mods)

exported = {}
def namespace(f, depth=0):
    if f in exported:
        return exported[f]
    out = dict()
    exported[f] = out
    for name, line in defs.get(f, {}).items():
        out[name] = (f, name)
    t = trees.get(f)
    if t is None or depth > 8:
        return out
    for node in t.body:
        if isinstance(node, ast.ImportFrom):
            target = resolve_rel(f, node.level, node.module) if node.level else resolve_abs(node.module or '')
            for a in node.names:
                if a.name == '*':
                    if target:
                        for k, v in namespace(target, depth + 1).items():
                            out.setdefault(k, v)
                else:
                    local = a.asname or a.name
                    if target:
                        hit = namespace(target, depth + 1).get(a.name)
                        if hit:
                            out.setdefault(local, hit)
    return out

def lookup(f, name):
    return namespace(f).get(name)

def submodule(f, name):
    n, pkg = modname[f]
    if not pkg:
        return None
    return resolve_abs((n + '.' if n else '') + name)

class Walker(ast.NodeVisitor):
    def __init__(self, f):
        self.f = f
        self.named, self.mods = imports[f]
        self.stack = []
        self.hits = set()

    def bound(self, node):
        names = {}
        args = node.args
        for a in args.posonlyargs + args.args + args.kwonlyargs:
            names[a.arg] = None
        if args.vararg: names[args.vararg.arg] = None
        if args.kwarg: names[args.kwarg.arg] = None
        todo = list(node.body) if isinstance(node.body, list) else [node.body]
        glob = set()
        while todo:
            n = todo.pop()
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names[n.name] = None
                continue
            if isinstance(n, ast.Lambda):
                continue
            if isinstance(n, (ast.Global, ast.Nonlocal)):
                glob.update(n.names)
            if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
                names[n.id] = None
            if isinstance(n, ast.ExceptHandler) and n.name:
                names[n.name] = None
            if isinstance(n, ast.ImportFrom):
                target = resolve_rel(self.f, n.level, n.module) if n.level else resolve_abs(n.module or '')
                for a in n.names:
                    if a.name != '*':
                        names[a.asname or a.name] = ('from', target, a.name)
            elif isinstance(n, ast.Import):
                for a in n.names:
                    if a.asname:
                        names[a.asname] = ('mod', resolve_abs(a.name))
                    else:
                        head = a.name.split('.')[0]
                        names[head] = ('mod', resolve_abs(head))
            if isinstance(n, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
                for g in n.generators:
                    for t in ast.walk(g.target):
                        if isinstance(t, ast.Name):
                            names[t.id] = None
            todo.extend(ast.iter_child_nodes(n))
        for g in glob:
            names.pop(g, None)
        return names

    def scoped(self, name):
        for scope in reversed(self.stack):
            if name in scope:
                return True, scope[name]
        return False, None

    def target_of_name(self, name):
        hit, entry = self.scoped(name)
        if hit:
            if entry and entry[0] == 'from' and entry[1]:
                return lookup(entry[1], entry[2])
            return None
        for target, orig, *_ in self.named.get(name, []):
            if target is None:
                continue
            hit = lookup(target, orig)
            if hit:
                return hit
        local = defs.get(self.f, {}).get(name)
        if local is not None and not self.named.get(name):
            return (self.f, name)
        return None

    def module_of(self, node):
        if isinstance(node, ast.Name):
            hit, entry = self.scoped(node.id)
            if hit:
                if entry and entry[0] == 'mod':
                    return entry[1]
                if entry and entry[0] == 'from' and entry[1]:
                    return submodule(entry[1], entry[2])
                return None
            if node.id in self.mods:
                return self.mods[node.id]
            for target, orig, *_ in self.named.get(node.id, []):
                if target is not None:
                    sub = submodule(target, orig)
                    if sub:
                        return sub
            return None
        if isinstance(node, ast.Attribute):
            parent = self.module_of(node.value)
            if parent:
                return submodule(parent, node.attr)
        return None

    def visit_function(self, node):
        for d in node.decorator_list:
            self.visit(d)
        a = node.args
        for dflt in a.defaults + [d for d in a.kw_defaults if d]:
            self.visit(dflt)
        for arg in a.posonlyargs + a.args + a.kwonlyargs + [x for x in (a.vararg, a.kwarg) if x]:
            if arg.annotation:
                self.visit(arg.annotation)
        if node.returns:
            self.visit(node.returns)
        self.stack.append(self.bound(node))
        for child in node.body:
            self.visit(child)
        self.stack.pop()

    visit_FunctionDef = visit_function
    visit_AsyncFunctionDef = visit_function

    def visit_Lambda(self, node):
        self.stack.append({a.arg: None for a in node.args.args + node.args.kwonlyargs})
        self.visit(node.body)
        self.stack.pop()

    def visit_ClassDef(self, node):
        for d in node.decorator_list: self.visit(d)
        for b in node.bases: self.visit(b)
        for k in node.keywords: self.visit(k.value)
        for child in node.body: self.visit(child)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            hit = self.target_of_name(node.id)
            if hit:
                self.hits.add((self.f, node.lineno, hit[0], hit[1]))

    def visit_Attribute(self, node):
        mod = self.module_of(node.value)
        if mod:
            hit = lookup(mod, node.attr)
            if hit:
                self.hits.add((self.f, node.lineno, hit[0], hit[1]))
        self.visit(node.value)

result = []
for f, t in trees.items():
    named, _ = imports[f]
    for entries in named.values():
        for target, orig, _level, _module, _line, aline in entries:
            if target:
                hit = lookup(target, orig)
                if hit:
                    result.append(['import', f, aline, hit[0], hit[1]])
    w = Walker(f)
    for node in t.body:
        w.visit(node)
    for h in w.hits:
        result.append(['use', *h])

json.dump({'defs': defs, 'hits': result}, sys.stdout)
