// Package rtk is a Go port of open-sse/rtk (the JS port of Rust rtk).
// Parity target is the JS implementation: fixtures are generated from it
// (scripts/rtk-fixtures.mjs) and compared byte-for-byte in tests.
package rtk

const (
	RawCap                = 10 * 1024 * 1024
	MinCompressSize       = 500
	DetectWindow          = 1024
	GitDiffHunkMax        = 100
	GitLogMaxLines        = 200
	DedupLineMax          = 2000
	GrepPerFileMax        = 10
	FindPerDirMax         = 10
	FindTotalDirMax       = 20
	StatusMaxFiles        = 10
	StatusMaxUntracked    = 10
	LsExtSummaryTop       = 5
	TreeMaxLines          = 200
	SearchListPerDir      = 10
	SearchListTotalDir    = 20
	SmartTruncateHead     = 120
	SmartTruncateTail     = 60
	SmartTruncateMinLines = 250
	ReadNumberedMinRatio  = 0.7
	DeprecationKeep       = 3
)

// LS_NOISE_DIRS mirrors constants.js LS_NOISE_DIRS (order irrelevant — membership only).
var LsNoiseDirs = map[string]bool{
	"node_modules": true, ".git": true, "target": true, "__pycache__": true,
	".next": true, "dist": true, "build": true, ".cache": true, ".turbo": true,
	".vercel": true, ".pytest_cache": true, ".mypy_cache": true, ".tox": true,
	".venv": true, "venv": true, "env": true,
	"coverage": true, ".nyc_output": true, ".DS_Store": true, "Thumbs.db": true,
	".idea": true, ".vscode": true, ".vs": true, "*.egg-info": true, ".eggs": true,
}
