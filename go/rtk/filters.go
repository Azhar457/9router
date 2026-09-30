package rtk

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ---- git-diff ----

func GitDiff(diff string) string {
	return gitDiffN(diff, 500)
}

func gitDiffN(diff string, maxLines int) string {
	var result []string
	currentFile := ""
	added, removed := 0, 0
	inHunk := false
	hunkShown, hunkSkipped := 0, 0
	wasTruncated := false
	maxHunkLines := GitDiffHunkMax

	lines := strings.Split(diff, "\n")
	breakOuter := false
	for _, line := range lines {
		if breakOuter {
			break
		}
		if strings.HasPrefix(line, "diff --git") {
			if hunkSkipped > 0 {
				result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
				wasTruncated = true
				hunkSkipped = 0
			}
			if currentFile != "" && (added > 0 || removed > 0) {
				result = append(result, fmt.Sprintf("  +%d -%d", added, removed))
			}
			parts := strings.Split(line, " b/")
			if len(parts) > 1 {
				currentFile = strings.Join(parts[1:], " b/")
			} else {
				currentFile = "unknown"
			}
			result = append(result, "\n"+currentFile)
			added, removed = 0, 0
			inHunk = false
			hunkShown = 0
		} else if strings.HasPrefix(line, "@@") {
			if hunkSkipped > 0 {
				result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
				wasTruncated = true
				hunkSkipped = 0
			}
			inHunk = true
			hunkShown = 0
			result = append(result, "  "+line)
		} else if inHunk {
			if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
				added++
				if hunkShown < maxHunkLines {
					result = append(result, "  "+line)
					hunkShown++
				} else {
					hunkSkipped++
				}
			} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
				removed++
				if hunkShown < maxHunkLines {
					result = append(result, "  "+line)
					hunkShown++
				} else {
					hunkSkipped++
				}
			} else if hunkShown < maxHunkLines && !strings.HasPrefix(line, "\\") {
				if hunkShown > 0 {
					result = append(result, "  "+line)
					hunkShown++
				}
			}
		}

		if len(result) >= maxLines {
			result = append(result, "\n... (more changes truncated)")
			wasTruncated = true
			breakOuter = true
		}
	}

	if hunkSkipped > 0 {
		result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
		wasTruncated = true
	}
	if currentFile != "" && (added > 0 || removed > 0) {
		result = append(result, fmt.Sprintf("  +%d -%d", added, removed))
	}
	if wasTruncated {
		result = append(result, "[full diff: rtk git diff --no-compact]")
	}
	return strings.Join(result, "\n")
}

// ---- git-log ----

var (
	reGitLogCommit    = regexp.MustCompile(`(?i)^commit [0-9a-f]{7,40}$`)
	reGitLogGraph     = regexp.MustCompile(`(?i)^[*|/\\ ]+commit [0-9a-f]{7,40}`)
	reGitLogAuthor    = regexp.MustCompile(`(?i)^[*|/\\ ]*(Author|Date):`)
	reGitLogSubj      = regexp.MustCompile(`^[*|/\\ ]*    \S`)
	reGitLogStat      = regexp.MustCompile(`^\d+ file\w* changed`)
	reGitLogDiff      = regexp.MustCompile(`^diff --git `)
	reGitLogOneline   = regexp.MustCompile(`^[*|/\\ ]+([0-9a-f]{7,40}\s+.+)`)
	reGitLogSha       = regexp.MustCompile(`^[0-9a-f]{7,40}\s+`)
	reGitLogGraphOnly = regexp.MustCompile(`^[*|/\\ ]+$`)
	reGitLogGraphChar = regexp.MustCompile(`[*|/\\]`)
)

func GitLog(text string) string {
	if text == "" {
		return ""
	}
	input := text
	lines := strings.Split(input, "\n")
	var out []string
	skipped := 0
	inCommit := false
	subjectSeen := false

	pushLine := func(l string) bool {
		if len(out) < GitLogMaxLines {
			out = append(out, l)
			return true
		}
		skipped++
		return false
	}

	for _, raw := range lines {
		line := trimRightJS(raw)
		trimmed := strings.TrimSpace(line)

		if reGitLogCommit.MatchString(trimmed) || reGitLogGraph.MatchString(trimmed) {
			inCommit = true
			subjectSeen = false
			pushLine(line)
			continue
		}

		if inCommit {
			if reGitLogAuthor.MatchString(trimmed) {
				pushLine(trimmed)
				continue
			}
			if trimmed == "" {
				continue
			}
			if !subjectSeen && reGitLogSubj.MatchString(line) {
				pushLine("  Subject: " + trimmed)
				subjectSeen = true
				continue
			}
			if reGitLogStat.MatchString(trimmed) {
				pushLine("  " + trimmed)
				continue
			}
			if reGitLogDiff.MatchString(trimmed) {
				pushLine("  ... diff body omitted")
				continue
			}
			continue
		}

		if m := reGitLogOneline.FindStringSubmatch(trimmed); m != nil {
			pushLine(m[1])
			continue
		}
		if reGitLogSha.MatchString(trimmed) {
			pushLine(trimmed)
			continue
		}
		if reGitLogGraphOnly.MatchString(trimmed) && reGitLogGraphChar.MatchString(trimmed) {
			continue
		}
		pushLine(trimmed)
	}

	if skipped > 0 {
		out = append(out, fmt.Sprintf("... (%d more lines)", skipped))
	}
	result := strings.Join(out, "\n")
	if result == "" && input != "" {
		return input
	}
	if jsLen(result) > jsLen(input) {
		return input
	}
	return result
}

// ---- git-status ----

var (
	reStatusLongBranch      = regexp.MustCompile(`^On branch (\S+)`)
	reStatusPorcelain       = regexp.MustCompile(`^[ MADRCU?!][ MADRCU?!] `)
	reStatusLong            = regexp.MustCompile(`^\s*(modified|new file|deleted|renamed|both modified):\s+(.+)$`)
	reStatusPorcelainHeader = regexp.MustCompile(`^##\s*`)
	statusTrailingNL        = regexp.MustCompile(`\n+$`)
)

func GitStatus(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 || (len(lines) == 1 && strings.TrimSpace(lines[0]) == "") {
		return "Clean working tree"
	}

	branch := ""
	var stagedFiles, modifiedFiles, untrackedFiles []string
	staged, modified, untracked, conflicts := 0, 0, 0, 0

	for _, raw := range lines {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		if m := reStatusLongBranch.FindStringSubmatch(raw); m != nil {
			branch = m[1]
			continue
		}
		if strings.HasPrefix(raw, "##") {
			branch = reStatusPorcelainHeader.ReplaceAllString(raw, "")
			continue
		}
		if len(raw) >= 3 && reStatusPorcelain.MatchString(raw) {
			x := string(raw[0])
			y := string(raw[1])
			file := raw[3:]
			if raw[:2] == "??" {
				untracked++
				untrackedFiles = append(untrackedFiles, file)
				continue
			}
			if strings.ContainsAny(x, "MADRC") {
				staged++
				stagedFiles = append(stagedFiles, file)
			} else if x == "U" {
				conflicts++
			}
			if y == "M" || y == "D" {
				modified++
				modifiedFiles = append(modifiedFiles, file)
			}
			continue
		}
		if m := reStatusLong.FindStringSubmatch(raw); m != nil {
			kind, path := m[1], strings.TrimSpace(m[2])
			if kind == "both modified" {
				conflicts++
			} else if kind == "modified" || kind == "deleted" {
				modified++
				modifiedFiles = append(modifiedFiles, path)
			} else if kind == "new file" || kind == "renamed" {
				staged++
				stagedFiles = append(stagedFiles, path)
			}
			continue
		}
	}

	var b strings.Builder
	if branch != "" {
		b.WriteString("* " + branch + "\n")
	}
	writeGroup := func(prefix string, n int, files []string, capN int) {
		if n == 0 {
			return
		}
		b.WriteString(fmt.Sprintf("%s %d files\n", prefix, n))
		show := files
		if len(show) > capN {
			show = show[:capN]
		}
		for _, f := range show {
			b.WriteString("   " + f + "\n")
		}
		if len(files) > capN {
			b.WriteString(fmt.Sprintf("   ... +%d more\n", len(files)-capN))
		}
	}
	writeGroup("+ Staged:", staged, stagedFiles, StatusMaxFiles)
	writeGroup("~ Modified:", modified, modifiedFiles, StatusMaxFiles)
	writeGroup("? Untracked:", untracked, untrackedFiles, StatusMaxUntracked)
	if conflicts > 0 {
		b.WriteString(fmt.Sprintf("conflicts: %d files\n", conflicts))
	}
	if staged == 0 && modified == 0 && untracked == 0 && conflicts == 0 {
		b.WriteString("clean — nothing to commit\n")
	}
	return statusTrailingNL.ReplaceAllString(b.String(), "")
}

// ---- build-output ----

var (
	reCargoCont   = regexp.MustCompile(`^\s*(-->|\||\d+\s*\||=)`)
	reNpmErr      = regexp.MustCompile(`(?i)^npm (ERR!|error)`)
	reYarnErr     = regexp.MustCompile(`(?i)^yarn error`)
	reNpmDeprec   = regexp.MustCompile(`(?i)^npm warn deprecated`)
	reNpmWarn     = regexp.MustCompile(`(?i)^npm warn`)
	reYarnWarn    = regexp.MustCompile(`(?i)^yarn warn`)
	reErrBracket  = regexp.MustCompile(`(?i)^error(\[|:)`)
	reWarnBracket = regexp.MustCompile(`(?i)^warning(\[|:)`)
	reErrColon    = regexp.MustCompile(`(?i)^ERROR:`)
	reErrSquare   = regexp.MustCompile(`(?i)^\[ERROR\]`)
	reBuildFailed = regexp.MustCompile(`(?i)^BUILD FAILED`)
	reWarnSquare  = regexp.MustCompile(`(?i)^\[WARNING\]`)
	reCompiling   = regexp.MustCompile(`(?i)^\s*Compiling\s+\S+`)
	reDownloading = regexp.MustCompile(`(?i)^\s*Downloading\s+\S+`)
	reFetching    = regexp.MustCompile(`(?i)^Fetching\s+`)
	rePkgSummary  = regexp.MustCompile(`(?i)^(added|removed|changed|audited|installed)\s+\d+\s+package`)
	reFinished    = regexp.MustCompile(`(?i)^\s*Finished\s+`)
	reBuildOK     = regexp.MustCompile(`(?i)^BUILD SUCCESS`)
	reCounts      = regexp.MustCompile(`(?i)^\d+\s+(vulnerabilities|packages?|warnings?|errors?)`)
	reSuccess     = regexp.MustCompile(`(?i)^Successfully (installed|built)`)
	reToAddress   = regexp.MustCompile(`(?i)^To address .* issues`)
	reRunAudit    = regexp.MustCompile("(?i)^Run `npm (audit|fund)`")
	reFunding     = regexp.MustCompile(`(?i)packages are looking for funding`)
)

func BuildOutput(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return input
	}
	var errors, warnings, deprecations []string
	var summary string
	compiling, downloading := 0, 0
	inCargoError := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if inCargoError {
			if trimmed == "" {
				inCargoError = false
				continue
			}
			if reCargoCont.MatchString(line) {
				errors = append(errors, line)
				continue
			}
			inCargoError = false
		}
		if trimmed == "" {
			continue
		}
		switch {
		case reNpmErr.MatchString(trimmed) || reYarnErr.MatchString(trimmed):
			errors = append(errors, line)
		case reNpmDeprec.MatchString(trimmed):
			deprecations = append(deprecations, line)
		case reNpmWarn.MatchString(trimmed) || reYarnWarn.MatchString(trimmed):
			warnings = append(warnings, line)
		case reErrBracket.MatchString(trimmed) || strings.HasPrefix(trimmed, "error -->"):
			errors = append(errors, line)
			inCargoError = true
		case reWarnBracket.MatchString(trimmed) || strings.HasPrefix(trimmed, "warning -->"):
			warnings = append(warnings, line)
			inCargoError = true
		case reErrColon.MatchString(trimmed):
			errors = append(errors, line)
		case reErrSquare.MatchString(trimmed) || reBuildFailed.MatchString(trimmed):
			errors = append(errors, line)
		case reWarnSquare.MatchString(trimmed):
			warnings = append(warnings, line)
		case reCompiling.MatchString(trimmed):
			compiling++
		case reDownloading.MatchString(trimmed) || reFetching.MatchString(trimmed):
			downloading++
		case rePkgSummary.MatchString(trimmed), reFinished.MatchString(trimmed),
			reBuildOK.MatchString(trimmed), reCounts.MatchString(trimmed),
			reSuccess.MatchString(trimmed), reToAddress.MatchString(trimmed),
			reRunAudit.MatchString(trimmed), reFunding.MatchString(trimmed):
			if summary == "" {
				summary = line
			} else {
				summary = summary + "\n" + line
			}
		}
	}

	var b strings.Builder
	keepDep := deprecations
	if len(keepDep) > DeprecationKeep {
		keepDep = keepDep[:DeprecationKeep]
	}
	for _, d := range keepDep {
		b.WriteString(d + "\n")
	}
	if len(deprecations) > DeprecationKeep {
		b.WriteString(fmt.Sprintf("... +%d more deprecated packages\n", len(deprecations)-DeprecationKeep))
	}
	if compiling > 0 {
		b.WriteString(fmt.Sprintf("Compiled %d packages\n", compiling))
	}
	if downloading > 0 {
		b.WriteString(fmt.Sprintf("Downloaded %d packages\n", downloading))
	}
	for _, e := range errors {
		b.WriteString(e + "\n")
	}
	keepWarn := warnings
	if len(keepWarn) > 5 {
		keepWarn = keepWarn[:5]
	}
	for _, w := range keepWarn {
		b.WriteString(w + "\n")
	}
	if len(warnings) > 5 {
		b.WriteString(fmt.Sprintf("... +%d more warnings\n", len(warnings)-5))
	}
	if summary != "" {
		b.WriteString(summary + "\n")
	}
	out := buildTrailingNL.ReplaceAllString(b.String(), "")
	if out == "" {
		return input
	}
	return out
}

// ---- grep ----

func allDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(s) > 0
}

func Grep(input string) string {
	type hit struct{ num, content string }
	byFile := map[string][]hit{}
	total := 0
	for _, line := range strings.Split(input, "\n") {
		first := strings.Index(line, ":")
		if first == -1 {
			continue
		}
		second := strings.Index(line[first+1:], ":")
		if second == -1 {
			continue
		}
		second += first + 1
		file := line[:first]
		numStr := line[first+1 : second]
		content := line[second+1:]
		if numStr == "" || !allDigits(numStr) {
			continue
		}
		total++
		byFile[file] = append(byFile[file], hit{numStr, content})
	}
	if total == 0 {
		return input
	}
	files := make([]string, 0, len(byFile))
	for f := range byFile {
		files = append(files, f)
	}
	sort.Strings(files)

	var b strings.Builder
	b.WriteString(fmt.Sprintf("%d matches in %dF:\n\n", total, len(files)))
	for _, file := range files {
		matches := byFile[file]
		b.WriteString(fmt.Sprintf("[file] %s (%d):\n", file, len(matches)))
		show := matches
		if len(show) > GrepPerFileMax {
			show = show[:GrepPerFileMax]
		}
		for _, m := range show {
			b.WriteString(fmt.Sprintf("  %4s: %s\n", m.num, strings.TrimSpace(m.content)))
		}
		if len(matches) > GrepPerFileMax {
			b.WriteString(fmt.Sprintf("  +%d\n", len(matches)-GrepPerFileMax))
		}
		b.WriteString("\n")
	}
	return b.String()
}

// ---- find ----

func Find(input string) string {
	var lines []string
	for _, l := range strings.Split(input, "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 {
		return input
	}
	byDir := map[string][]string{}
	for _, path := range lines {
		last := strings.LastIndexAny(path, "/\\")
		var dir, base string
		if last == -1 {
			dir, base = ".", path
		} else {
			dir = path[:last]
			if dir == "" {
				dir = "/"
			}
			base = path[last+1:]
		}
		byDir[dir] = append(byDir[dir], base)
	}
	dirs := make([]string, 0, len(byDir))
	for d := range byDir {
		dirs = append(dirs, d)
	}
	sort.Strings(dirs)

	var b strings.Builder
	b.WriteString(fmt.Sprintf("%d files in %d dirs:\n\n", len(lines), len(dirs)))
	showDirs := dirs
	if len(showDirs) > FindTotalDirMax {
		showDirs = showDirs[:FindTotalDirMax]
	}
	for _, dir := range showDirs {
		files := byDir[dir]
		b.WriteString(fmt.Sprintf("%s/  (%d)\n", strings.ReplaceAll(dir, "\\", "/"), len(files)))
		show := files
		if len(show) > FindPerDirMax {
			show = show[:FindPerDirMax]
		}
		for _, f := range show {
			b.WriteString("  " + f + "\n")
		}
		if len(files) > FindPerDirMax {
			b.WriteString(fmt.Sprintf("  +%d\n", len(files)-FindPerDirMax))
		}
	}
	if len(dirs) > FindTotalDirMax {
		b.WriteString(fmt.Sprintf("\n+%d more dirs\n", len(dirs)-FindTotalDirMax))
	}
	return b.String()
}

// ---- ls ----

var lsDateRe = regexp.MustCompile(`\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+`)

var (
	grepTrailingNL   = regexp.MustCompile(`\n+$`)
	buildTrailingNL  = regexp.MustCompile(`\n+$`)
	searchTrailingNL = regexp.MustCompile(`\n+$`)
)

func humanSize(bytes int64) string {
	if bytes >= 1048576 {
		return fmt.Sprintf("%.1fM", float64(bytes)/1048576)
	}
	if bytes >= 1024 {
		return fmt.Sprintf("%.1fK", float64(bytes)/1024)
	}
	return fmt.Sprintf("%dB", bytes)
}

type lsLine struct {
	fileType string
	size     int64
	name     string
}

func parseLsLine(line string) (lsLine, bool) {
	m := lsDateRe.FindStringIndex(line)
	if m == nil {
		return lsLine{}, false
	}
	name := line[m[1]:]
	beforeDate := line[:m[0]]
	beforeParts := strings.Fields(beforeDate)
	if len(beforeParts) < 4 {
		return lsLine{}, false
	}
	perms := beforeParts[0]
	fileType := string([]rune(perms)[:1])
	var size int64
	for i := len(beforeParts) - 1; i >= 0; i-- {
		p := beforeParts[i]
		if n, err := strconv.ParseInt(p, 10, 64); err == nil && strconv.FormatInt(n, 10) == p {
			size = n
			break
		}
	}
	return lsLine{fileType: fileType, size: size, name: name}, true
}

func Ls(input string) string {
	var dirs []string
	type fileInfo struct{ name, size string }
	var files []fileInfo
	type extCount struct {
		ext string
		n   int
	}
	var extOrder []string
	byExt := map[string]int{}

	for _, line := range strings.Split(input, "\n") {
		if strings.HasPrefix(line, "total ") || len(line) == 0 {
			continue
		}
		parsed, ok := parseLsLine(line)
		if !ok {
			continue
		}
		if parsed.name == "." || parsed.name == ".." {
			continue
		}
		if LsNoiseDirs[parsed.name] {
			continue
		}
		if parsed.fileType == "d" {
			dirs = append(dirs, parsed.name)
		} else if parsed.fileType == "-" || parsed.fileType == "l" {
			dot := strings.LastIndex(parsed.name, ".")
			ext := "no ext"
			if dot > 0 {
				ext = parsed.name[dot:]
			}
			if _, seen := byExt[ext]; !seen {
				extOrder = append(extOrder, ext)
			}
			byExt[ext]++
			files = append(files, fileInfo{parsed.name, humanSize(parsed.size)})
		}
	}
	if len(dirs) == 0 && len(files) == 0 {
		return input
	}
	var b strings.Builder
	for _, d := range dirs {
		b.WriteString(d + "/\n")
	}
	for _, f := range files {
		b.WriteString(fmt.Sprintf("%s  %s\n", f.name, f.size))
	}
	summary := fmt.Sprintf("\nSummary: %d files, %d dirs", len(files), len(dirs))
	if len(byExt) > 0 {
		var entries []extCount
		for _, e := range extOrder {
			entries = append(entries, extCount{e, byExt[e]})
		}
		sort.SliceStable(entries, func(i, j int) bool { return entries[i].n > entries[j].n })
		var parts []string
		top := entries
		if len(top) > LsExtSummaryTop {
			top = top[:LsExtSummaryTop]
		}
		for _, e := range top {
			parts = append(parts, fmt.Sprintf("%d %s", e.n, e.ext))
		}
		summary += " (" + strings.Join(parts, ", ")
		if len(entries) > LsExtSummaryTop {
			summary += fmt.Sprintf(", +%d more", len(entries)-LsExtSummaryTop)
		}
		summary += ")"
	}
	return b.String() + summary
}

// ---- tree ----

func Tree(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return input
	}
	var filtered []string
	for _, line := range lines {
		if strings.Contains(line, "director") && strings.Contains(line, "file") {
			continue
		}
		if strings.TrimSpace(line) == "" && len(filtered) == 0 {
			continue
		}
		filtered = append(filtered, line)
	}
	for len(filtered) > 0 && strings.TrimSpace(filtered[len(filtered)-1]) == "" {
		filtered = filtered[:len(filtered)-1]
	}
	if len(filtered) > TreeMaxLines {
		cut := len(filtered) - TreeMaxLines
		return strings.Join(filtered[:TreeMaxLines], "\n") + fmt.Sprintf("\n... +%d more lines", cut)
	}
	return strings.Join(filtered, "\n")
}

// ---- dedup-log ----

func DedupLog(input string) string {
	lines := strings.Split(input, "\n")
	var out []string
	prev := ""
	hasPrev := false
	runCount := 0
	blankStreak := 0

	flushRun := func() {
		if hasPrev && runCount > 1 {
			out = append(out, fmt.Sprintf("  ... (%d duplicate lines)", runCount-1))
		}
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			if blankStreak < 1 {
				out = append(out, line)
			}
			blankStreak++
			flushRun()
			hasPrev = false
			runCount = 0
			continue
		}
		blankStreak = 0
		if hasPrev && line == prev {
			runCount++
			continue
		}
		flushRun()
		out = append(out, line)
		prev = line
		hasPrev = true
		runCount = 1
		if len(out) >= DedupLineMax {
			out = append(out, fmt.Sprintf("... (truncated at %d lines)", DedupLineMax))
			return strings.Join(out, "\n")
		}
	}
	flushRun()
	return strings.Join(out, "\n")
}

// ---- search-list ----

var searchListHeaderRe = regexp.MustCompile(`^Result of search in '[^']*' \(total (\d+) files?\):`)

func SearchList(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return input
	}
	header := ""
	if len(lines) > 0 {
		header = lines[0]
	}
	var paths []string
	for _, raw := range lines[1:] {
		t := strings.TrimSpace(raw)
		if !strings.HasPrefix(t, "- ") {
			continue
		}
		paths = append(paths, t[2:])
	}
	if len(paths) == 0 {
		return input
	}
	byDir := map[string][]string{}
	for _, p := range paths {
		slash := strings.LastIndex(p, "/")
		var dir, name string
		if slash == -1 {
			dir, name = ".", p
		} else {
			dir = p[:slash]
			if dir == "" {
				dir = "/"
			}
			name = p[slash+1:]
		}
		byDir[dir] = append(byDir[dir], name)
	}
	dirs := make([]string, 0, len(byDir))
	for d := range byDir {
		dirs = append(dirs, d)
	}
	sort.Strings(dirs)

	var b strings.Builder
	b.WriteString(fmt.Sprintf("%s\n%d files in %d dirs:\n\n", header, len(paths), len(dirs)))
	showDirs := dirs
	if len(showDirs) > SearchListTotalDir {
		showDirs = showDirs[:SearchListTotalDir]
	}
	for _, dir := range showDirs {
		names := byDir[dir]
		b.WriteString(fmt.Sprintf("%s/ (%d):\n", dir, len(names)))
		show := names
		if len(show) > SearchListPerDir {
			show = show[:SearchListPerDir]
		}
		for _, n := range show {
			b.WriteString("  " + n + "\n")
		}
		if len(names) > SearchListPerDir {
			b.WriteString(fmt.Sprintf("  +%d\n", len(names)-SearchListPerDir))
		}
		b.WriteString("\n")
	}
	if len(dirs) > SearchListTotalDir {
		b.WriteString(fmt.Sprintf("+%d more dirs\n", len(dirs)-SearchListTotalDir))
	}
	return grepTrailingNL.ReplaceAllString(b.String(), "")
}

// ---- read-numbered / smart-truncate ----

func ReadNumbered(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) < SmartTruncateMinLines {
		return input
	}
	head := lines[:SmartTruncateHead]
	tail := lines[len(lines)-SmartTruncateTail:]
	cut := len(lines) - len(head) - len(tail)
	out := make([]string, 0, len(head)+len(tail)+1)
	out = append(out, head...)
	out = append(out, fmt.Sprintf("... +%d lines truncated (file continues)", cut))
	out = append(out, tail...)
	return strings.Join(out, "\n")
}

func SmartTruncate(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) < SmartTruncateMinLines {
		return input
	}
	head := lines[:SmartTruncateHead]
	tail := lines[len(lines)-SmartTruncateTail:]
	cut := len(lines) - len(head) - len(tail)
	out := make([]string, 0, len(head)+len(tail)+1)
	out = append(out, head...)
	out = append(out, fmt.Sprintf("... +%d lines truncated", cut))
	out = append(out, tail...)
	return strings.Join(out, "\n")
}
