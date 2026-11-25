// Package migrations embeds the three independent migration sets.
package migrations

import "embed"

// Files contains control, tenant and platform migrations.
//
//go:embed control/*.sql tenant/*.sql platform/*.sql
var Files embed.FS
