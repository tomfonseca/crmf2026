package auth

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestIdentityDatabaseImportIsolation(t *testing.T) {
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate module")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(here), "../../.."))
	for _, directory := range []string{"internal", "cmd", "tests"} {
		err := filepath.WalkDir(filepath.Join(root, directory), func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") {
				return nil
			}
			ast, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			for _, imp := range ast.Imports {
				imported, err := strconv.Unquote(imp.Path.Value)
				if err != nil {
					return err
				}
				if imported == "github.com/crmf/crmf/internal/server/db/auth" && !strings.HasPrefix(rel, "internal/server/auth/") {
					t.Errorf("identity database import outside authentication module: %s", rel)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
