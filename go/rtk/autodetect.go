package rtk

import (
	"regexp"
	"strings"
	"unicode"
)

// JS String.prototype.trimEnd — trailing Unicode whitespace.
func trimRightJS(s string) string {
	return strings.TrimRightFunc(s, unicode.IsSpace)
}

var (
	reDetectGitDiff     = regexp.MustCompile(`(?m)^diff --git `)
	reDetectGitDiffHunk = regexp.MustCompile(`(?m)^@@ `)
	reDetectGitStatus   = regexp.MustCompile(`(?m)^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:`)
	reDetectGitLog      = regexp.MustCompile(`(?m)^[*|/\\ ]*commit [0-9a-f]{7,40}$`)
	reDetectPorcelain   = regexp.MustCompile(`^[ MADRCU?!][ MADRCU?!] \S`)
	reDetectBuild       = regexp.MustCompile(`(?im)^(npm (warn|error|ERR!)|yarn (warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (SUCCESS|FAILED)|\s*Finished\s+|Successfully (installed|built)|ERROR:)`)
	reDetectTreeGlyph   = regexp.MustCompile(`[├└]──|│  `)
	reDetectLsRow       = regexp.MustCompile(`(?m)^[-dlbcps][rwx-]{9}`)
	reDetectLsTotal     = regexp.MustCompile(`(?m)^total \d+$`)
	reDetectDrive       = regexp.MustCompile(`^[A-Za-z]:[\\/]`)
	reDetectGrepNum     = regexp.MustCompile(`^\d+$`)
	reDetectNumbered    = regexp.MustCompile(`^\s*\d+\|`)
)

type filterFn struct {
	name string
	fn   func(string) string
}

func detectFilter(text string) *filterFn {
	head := text
	if runes := []rune(text); len(runes) > DetectWindow {
		head = string(runes[:DetectWindow])
	}

	if reDetectGitLog.MatchString(head) {
		return &filterFn{"git-log", GitLog}
	}
	if reDetectGitDiff.MatchString(head) || reDetectGitDiffHunk.MatchString(head) {
		return &filterFn{"git-diff", GitDiff}
	}
	if reDetectGitStatus.MatchString(head) {
		return &filterFn{"git-status", GitStatus}
	}
	// Build output BEFORE porcelain check (cargo "Compiling" vs git status).
	if reDetectBuild.MatchString(head) {
		return &filterFn{"build-output", BuildOutput}
	}
	if isMostlyPorcelain(head) {
		return &filterFn{"git-status", GitStatus}
	}

	lines := strings.Split(head, "\n")
	var nonEmpty []string
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			nonEmpty = append(nonEmpty, l)
		}
	}

	first5 := nonEmpty
	if len(first5) > 5 {
		first5 = first5[:5]
	}
	for _, l := range first5 {
		if isGrepLine(l) {
			return &filterFn{"grep", Grep}
		}
	}

	if len(nonEmpty) >= 3 {
		allPath := true
		for _, l := range nonEmpty {
			if !isPathLike(l) {
				allPath = false
				break
			}
		}
		if allPath {
			return &filterFn{"find", Find}
		}
	}

	if reDetectTreeGlyph.MatchString(head) {
		return &filterFn{"tree", Tree}
	}
	if reDetectLsTotal.MatchString(head) || countMatches(head, reDetectLsRow) >= 3 {
		return &filterFn{"ls", Ls}
	}
	if searchListHeaderRe.MatchString(head) {
		return &filterFn{"search-list", SearchList}
	}
	if len(lines) >= SmartTruncateMinLines && isLineNumbered(lines) {
		return &filterFn{"read-numbered", ReadNumbered}
	}
	if len(nonEmpty) >= 5 {
		return &filterFn{"dedup-log", DedupLog}
	}
	if strings.Count(text, "\n")+1 >= SmartTruncateMinLines {
		return &filterFn{"smart-truncate", SmartTruncate}
	}
	return nil
}

func isGrepLine(line string) bool {
	first := strings.Index(line, ":")
	if first == -1 {
		return false
	}
	second := strings.Index(line[first+1:], ":")
	if second == -1 {
		return false
	}
	lineno := line[first+1 : first+1+second]
	if lineno == "" {
		return false
	}
	return reDetectGrepNum.MatchString(lineno)
}

func isPathLike(line string) bool {
	t := strings.TrimSpace(line)
	if t == "" {
		return false
	}
	if reDetectDrive.MatchString(t) {
		return true
	}
	if strings.Contains(t, ":") {
		return false
	}
	return strings.HasPrefix(t, ".") || strings.HasPrefix(t, "/") || strings.Contains(t, "/")
}

func isMostlyPorcelain(head string) bool {
	var lines []string
	for _, l := range strings.Split(head, "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) < 3 {
		return false
	}
	hits := 0
	for _, l := range lines {
		if reDetectPorcelain.MatchString(l) {
			hits++
		}
	}
	return float64(hits)/float64(len(lines)) >= 0.6
}

func isLineNumbered(lines []string) bool {
	hits := 0
	nonEmpty := 0
	sample := lines
	if len(sample) > 100 {
		sample = sample[:100]
	}
	for _, l := range sample {
		if len(l) == 0 {
			continue
		}
		nonEmpty++
		if reDetectNumbered.MatchString(l) {
			hits++
		}
	}
	if nonEmpty < 5 {
		return false
	}
	return float64(hits)/float64(nonEmpty) >= ReadNumberedMinRatio
}

func countMatches(text string, re *regexp.Regexp) int {
	return len(re.FindAllString(text, -1))
}
