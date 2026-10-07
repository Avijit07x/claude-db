import com.sun.source.tree.*;
import com.sun.source.util.*;
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;
import java.io.PrintStream;
import javax.lang.model.element.*;
import javax.tools.*;

public class Oracle {
  public static void main(String[] args) throws Exception {
    Path root = Path.of(args[0]).toAbsolutePath().normalize();
    List<Path> files;
    try (Stream<Path> walk = Files.walk(root)) {
      files = walk.filter(p -> p.toString().endsWith(".java") && !p.toString().contains("/.git/")
          && !p.getFileName().toString().equals("module-info.java")).collect(Collectors.toList());
    }
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    StandardJavaFileManager fm = compiler.getStandardFileManager(d -> {}, null, null);
    Iterable<? extends JavaFileObject> units = fm.getJavaFileObjectsFromPaths(files);
    JavacTask task = (JavacTask) compiler.getTask(null, fm, d -> {}, List.of("-proc:none", "-implicit:none", "-Xlint:none"), null, units);
    Trees trees = Trees.instance(task);
    SourcePositions positions = trees.getSourcePositions();
    List<CompilationUnitTree> parsed = new ArrayList<>();
    for (CompilationUnitTree cu : task.parse()) parsed.add(cu);
    task.analyze();
    PrintStream out = System.out;
    for (CompilationUnitTree cu : parsed) {
      String file = root.relativize(Path.of(cu.getSourceFile().toUri())).toString();
      new TreePathScanner<Void, Void>() {
        void report(Tree tree) {
          TreePath path = getCurrentPath();
          Element element = trees.getElement(path);
          if (element == null) return;
          ElementKind kind = element.getKind();
          Element target = element;
          String what;
          if (kind.isClass() || kind.isInterface()) what = "type";
          else if (kind == ElementKind.METHOD) {
            if (element.getEnclosingElement().getKind() == ElementKind.ANNOTATION_TYPE) return;
            what = "method";
          }
          else if (kind == ElementKind.CONSTRUCTOR) { target = element.getEnclosingElement(); what = "type"; }
          else return;
          TreePath declared = trees.getPath(target);
          if (declared == null) return;
          if (target.getSimpleName().length() == 0) return;
          Path declFile = Path.of(declared.getCompilationUnit().getSourceFile().toUri());
          if (!declFile.startsWith(root)) return;
          long pos = positions.getStartPosition(cu, tree);
          if (tree instanceof MemberSelectTree select) {
            long end = positions.getEndPosition(cu, tree);
            pos = end - select.getIdentifier().length();
          }
          if (pos < 0) return;
          long line = cu.getLineMap().getLineNumber(pos);
          boolean isImport = false;
          for (TreePath p = path; p != null; p = p.getParentPath()) if (p.getLeaf() instanceof ImportTree) { isImport = true; break; }
          out.println((isImport ? "import" : "use") + "\t" + file + "\t" + line + "\t" + root.relativize(declFile) + "\t" + target.getSimpleName() + "\t" + what);
        }
        @Override public Void visitIdentifier(IdentifierTree t, Void v) {
          String name = t.getName().toString();
          if (!name.equals("super") && !name.equals("this")) report(t);
          return super.visitIdentifier(t, v);
        }
        @Override public Void visitMemberSelect(MemberSelectTree t, Void v) { report(t); return super.visitMemberSelect(t, v); }
        @Override public Void visitVariable(VariableTree t, Void v) {
          Element element = trees.getElement(getCurrentPath());
          if (element == null || element.getKind() != ElementKind.ENUM_CONSTANT) return super.visitVariable(t, v);
          scan(t.getModifiers(), v);
          scan(t.getInitializer(), v);
          return null;
        }
        @Override public Void visitNewClass(NewClassTree t, Void v) {
          TreePath parentPath = getCurrentPath().getParentPath();
          Element parent = parentPath == null ? null : trees.getElement(parentPath);
          boolean enumConstant = parent != null && parent.getKind() == ElementKind.ENUM_CONSTANT;
          if (enumConstant) {
            scan(t.getArguments(), v);
            if (t.getClassBody() != null) scan(t.getClassBody().getMembers(), v);
            return null;
          }
          if (t.getClassBody() == null) report(t);
          return super.visitNewClass(t, v);
        }
      }.scan(cu, null);
    }
  }
}
