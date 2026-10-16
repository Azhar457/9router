import { FILTERS } from "../rtk/constants.js";
import { gitDiff } from "../rtk/filters/gitDiff.js";
import { gitStatus } from "../rtk/filters/gitStatus.js";
import { gitLog } from "../rtk/filters/gitLog.js";
import { grep } from "../rtk/filters/grep.js";
import { find } from "../rtk/filters/find.js";
import { dedupLog } from "../rtk/filters/dedupLog.js";
import { ls } from "../rtk/filters/ls.js";
import { tree } from "../rtk/filters/tree.js";
import { smartTruncate } from "../rtk/filters/smartTruncate.js";
import { readNumbered } from "../rtk/filters/readNumbered.js";
import { searchList } from "../rtk/filters/searchList.js";

const REGISTRY = {
  [FILTERS.GIT_DIFF]: gitDiff,
  [FILTERS.GIT_STATUS]: gitStatus,
  [FILTERS.GIT_LOG]: gitLog,
  [FILTERS.GREP]: grep,
  [FILTERS.FIND]: find,
  [FILTERS.DEDUP_LOG]: dedupLog,
  [FILTERS.LS]: ls,
  [FILTERS.TREE]: tree,
  [FILTERS.SMART_TRUNCATE]: smartTruncate,
  [FILTERS.READ_NUMBERED]: readNumbered,
  [FILTERS.SEARCH_LIST]: searchList
};

// Rust resolve_filter aliases (pipe_cmd.rs): grep|rg, find|fd
const ALIASES = {
  rg: grep,
  fd: find
};

export function resolveFilter(name) {
  return REGISTRY[name] || ALIASES[name] || null;
}

export function allFilters() {
  return REGISTRY;
}
