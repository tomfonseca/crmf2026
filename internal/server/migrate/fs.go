package migrate

import (
	"github.com/crmf/crmf/migrations"
	"io/fs"
)

func mustSub(scope string) fs.FS {
	files, err := fs.Sub(migrations.Files, scope)
	if err != nil {
		panic(err)
	}
	return files
}
