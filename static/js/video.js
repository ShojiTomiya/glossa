import { handleTextSelection } from "./selection.js";
import { MAX_CONTEXT_CHARS } from "./context.js";

/* Video mode: YouTube IFrame player + subtitle cues synced to playback.
 *
 * Entry points used by openText / the Library button: openVideo(entry) and
 * closeVideo(). Cues are plain DOM rows built once; playback only toggles an
 * "active" class on one row, so a text selection inside the list survives
 * while the video keeps playing.
 *
 * The cues sit in a fixed-height window next to the player; the active one is
 * kept in its middle. Selecting cue text pauses the video and hands the phrase
 * plus a context of the selected cues and a few neighbours to
 * handleTextSelection(), which owns the translate popup and the Explain panel
 * for every reader.
 */

const videoReader = document.getElementById("video-reader");
const videoPlayerBox = document.getElementById("video-player-box");
const videoError = document.getElementById("video-error");
const cueList = document.getElementById("cue-list");
const videoFollowBtn = document.getElementById("video-follow-btn");
const topbarEl = document.getElementById("topbar");

const VIDEO_POLL_MS = 250;
const CUE_GRACE_S = 1.0; // keep a cue highlighted this long after it ends
const SEEK_LOCK_MS = 600; // after a click-seek, don't let a stale poll flip the highlight back
const SAVE_POS_EVERY_MS = 5000;

const YT_ERROR_MESSAGES = {
  2: "YouTube rejected this video id.",
  5: "The YouTube player hit an error. Try again in a moment.",
  100: "This video was removed or is private.",
  101: "The owner of this video doesn't allow embedding it.",
  150: "The owner of this video doesn't allow embedding it.",
  153: "YouTube refused to embed the player: it needs the HTTP Referer header (a browser extension or privacy setting may be stripping it).",
};

let videoSession = 0; // bumped on every open/close; stale async work checks it
let vs = null; // state of the open video, null when closed

/* ---------- helpers ---------- */

function formatCueTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Index of the cue to highlight at time t, or -1. Cues are sorted by start.
function findCueIndex(cues, t) {
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx >= 0 && t > cues[idx].end + CUE_GRACE_S) return -1;
  return idx;
}

function videoPosKey(textId) {
  return `lexplain-video-pos-${textId}`;
}

function loadVideoPos(textId) {
  const v = parseInt(localStorage.getItem(videoPosKey(textId)), 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function saveVideoPos(t) {
  if (!vs) return;
  const lastEnd = vs.cues.length ? vs.cues[vs.cues.length - 1].end : 0;
  if (t < 3 || (lastEnd && t > lastEnd - 5)) {
    localStorage.removeItem(videoPosKey(vs.entry.id)); // not started, or finished
  } else {
    localStorage.setItem(videoPosKey(vs.entry.id), String(Math.floor(t)));
  }
}

/* ---------- YouTube IFrame API ---------- */

let ytApiPromise = null;

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    let timer = null;
    const fail = (err) => {
      clearTimeout(timer);
      ytApiPromise = null; // allow a retry on the next open
      reject(err);
    };
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof previous === "function") previous();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      script.remove();
      fail(new Error("script failed to load"));
    };
    document.head.appendChild(script);
    timer = setTimeout(() => fail(new Error("timed out")), 15000);
  });
  return ytApiPromise;
}

/* ---------- rendering ---------- */

function renderCues(cues) {
  const fragment = document.createDocumentFragment();
  cues.forEach((cue, i) => {
    const row = document.createElement("div");
    row.className = "cue";
    row.dataset.index = i;

    const time = document.createElement("button");
    time.type = "button";
    time.className = "cue-time";
    time.tabIndex = -1; // a tab stop per cue would make the page unusable by keyboard
    time.textContent = formatCueTime(cue.start);
    time.setAttribute("aria-label", `Jump to ${formatCueTime(cue.start)}`);

    const text = document.createElement("span");
    text.className = "cue-text";
    text.textContent = cue.text; // never innerHTML: subtitles are untrusted input

    row.append(time, text);
    fragment.appendChild(row);
  });
  cueList.replaceChildren(fragment);
}

function showVideoError(message, videoId) {
  videoError.replaceChildren();
  const p = document.createElement("p");
  p.textContent = message;
  videoError.appendChild(p);
  if (videoId) {
    const a = document.createElement("a");
    a.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Watch on YouTube";
    videoError.appendChild(a);
  }
  videoError.classList.remove("hidden");
}

function hideVideoError() {
  videoError.classList.add("hidden");
  videoError.replaceChildren();
}

/* ---------- active cue + scrolling ---------- */

// The player and the cue window are sized from the viewport height (see
// style.css), which needs the topbar's real height.
function syncTopbarHeight() {
  document.documentElement.style.setProperty("--topbar-h", `${topbarEl.offsetHeight}px`);
}

// The cue list is a fixed-height window; keep the cue in its middle, lyrics
// style, so the previous and next cues stay visible around it.
function centerCue(el, smooth) {
  const top = el.offsetTop - (cueList.clientHeight - el.offsetHeight) / 2;
  cueList.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
}

function setActiveCue(index) {
  if (!vs || index === vs.activeIndex) return;
  const prev = vs.activeIndex >= 0 ? cueList.children[vs.activeIndex] : null;
  if (prev) {
    prev.classList.remove("active");
    prev.removeAttribute("aria-current");
  }
  vs.activeIndex = index;
  const el = index >= 0 ? cueList.children[index] : null;
  if (el) {
    el.classList.add("active");
    el.setAttribute("aria-current", "true");
    if (vs.autoScroll && !vs.selecting) centerCue(el, true);
  }
}

// "Follow playback" appears when the user has scrolled the window so far that
// the active cue is out of sight.
function updateFollowButton() {
  let show = false;
  let arrow = "↓";
  if (vs && !vs.autoScroll && vs.activeIndex >= 0) {
    const el = cueList.children[vs.activeIndex];
    const top = el.offsetTop - cueList.scrollTop;
    const bottom = top + el.offsetHeight;
    if (bottom < 8) {
      show = true;
      arrow = "↑";
    } else if (top > cueList.clientHeight - 8) {
      show = true;
    }
  }
  videoFollowBtn.classList.toggle("hidden", !show);
  if (show) videoFollowBtn.textContent = `${arrow} Follow playback`;
}

function playerTime() {
  if (!vs || !vs.player || typeof vs.player.getCurrentTime !== "function") return null;
  const t = vs.player.getCurrentTime();
  return Number.isFinite(t) ? t : null;
}

function videoTick() {
  const t = playerTime();
  if (t === null) return;
  if (performance.now() >= vs.seekLockUntil) setActiveCue(findCueIndex(vs.cues, t));
  updateFollowButton();
  if (performance.now() - vs.lastSavedAt > SAVE_POS_EVERY_MS) {
    vs.lastSavedAt = performance.now();
    saveVideoPos(t);
  }
}

function seekToCue(index) {
  if (!vs || !vs.player || typeof vs.player.seekTo !== "function") return;
  const cue = vs.cues[index];
  if (!cue) return;
  vs.player.seekTo(cue.start, true);
  vs.player.playVideo();
  vs.autoScroll = true;
  vs.seekLockUntil = performance.now() + SEEK_LOCK_MS;
  setActiveCue(index);
}

/* ---------- player events ---------- */

function onPlayerReady(session) {
  if (session !== videoSession || !vs) return;
  if (vs.startAt > 0) {
    // Resuming: show the cue we resume at in the middle, without animation, and
    // don't let a poll that still reports 0:00 right after start undo it.
    vs.seekLockUntil = performance.now() + SEEK_LOCK_MS * 2;
    const el = cueList.children[findCueIndex(vs.cues, vs.startAt)];
    if (el) centerCue(el, false);
  }
  vs.pollTimer = setInterval(videoTick, VIDEO_POLL_MS);
  videoTick();
}

function onPlayerState(session, state) {
  if (session !== videoSession || !vs) return;
  // PLAYING after a pause/start/end resumes following; PLAYING after buffering
  // does not, so a stall doesn't undo the user scrolling ahead.
  const resumed = state === 1 && [-1, 0, 2, 5].includes(vs.lastState);
  if (resumed) vs.autoScroll = true;
  vs.lastState = state;
  if (state === 1 || state === 2) videoTick();
}

function onPlayerError(session, code) {
  if (session !== videoSession || !vs) return;
  showVideoError(YT_ERROR_MESSAGES[code] || `YouTube player error ${code}.`, vs.entry.video_id);
}

/* ---------- open / close ---------- */

function createPlayer(session) {
  const mount = document.createElement("div");
  videoPlayerBox.replaceChildren(mount);
  const playerVars = { playsinline: 1, rel: 0 };
  if (vs.startAt > 0) playerVars.start = vs.startAt;
  if (window.location.protocol.startsWith("http")) playerVars.origin = window.location.origin;

  vs.player = new YT.Player(mount, {
    videoId: vs.entry.video_id,
    width: "100%",
    height: "100%",
    playerVars,
    events: {
      onReady: () => onPlayerReady(session),
      onStateChange: (e) => onPlayerState(session, e.data),
      onError: (e) => onPlayerError(session, e.data),
    },
  });
}

function attachScrollIntent(signal) {
  // Wheel, touch and a press on the list's own scrollbar are the user moving
  // the window; our smooth scrolling triggers none of them, so scroll events
  // alone can't tell the two apart.
  const stop = () => {
    if (vs) vs.autoScroll = false;
  };
  window.addEventListener("resize", syncTopbarHeight, { signal });
  cueList.addEventListener("wheel", stop, { passive: true, signal });
  cueList.addEventListener("touchmove", stop, { passive: true, signal });
  cueList.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target === cueList) stop(); // scrollbar or padding, not a cue
    },
    { signal }
  );
  // Selecting text inside the list also pauses following, until it's cleared.
  document.addEventListener(
    "selectionchange",
    () => {
      if (!vs) return;
      const sel = window.getSelection();
      vs.selecting = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && cueList.contains(sel.anchorNode);
    },
    { signal }
  );
}

export async function openVideo(entry) {
  closeVideo();
  const session = ++videoSession;
  const cues = Array.isArray(entry.segments) ? entry.segments : [];
  vs = {
    entry,
    cues,
    player: null,
    activeIndex: -1,
    autoScroll: true,
    selecting: false,
    lastState: -1,
    seekLockUntil: 0,
    lastSavedAt: performance.now(),
    startAt: loadVideoPos(entry.id),
    pollTimer: null,
    abort: new AbortController(),
  };

  hideVideoError();
  renderCues(cues);
  videoReader.classList.remove("hidden");
  syncTopbarHeight();
  attachScrollIntent(vs.abort.signal);
  if (vs.startAt > 0) setActiveCue(findCueIndex(cues, vs.startAt));

  try {
    await loadYouTubeApi();
  } catch (e) {
    if (session === videoSession) {
      showVideoError("Couldn't load the YouTube player (offline, or blocked by an extension). The subtitles below still work.", entry.video_id);
    }
    return;
  }
  if (session !== videoSession) return; // closed while the API was loading
  createPlayer(session);
}

function closeVideo() {
  videoSession++;
  const state = vs;
  vs = null;
  if (state) {
    clearInterval(state.pollTimer);
    state.abort.abort();
    if (state.player && typeof state.player.getCurrentTime === "function") {
      vs = state; // saveVideoPos reads vs
      try {
        saveVideoPos(state.player.getCurrentTime());
      } catch (e) {
        /* player already gone */
      }
      vs = null;
    }
    try {
      if (state.player && typeof state.player.destroy === "function") state.player.destroy();
    } catch (e) {
      /* ignore */
    }
  }
  videoPlayerBox.replaceChildren();
  cueList.replaceChildren();
  hideVideoError();
  videoFollowBtn.classList.add("hidden");
  videoReader.classList.add("hidden");
}

/* ---------- selection -> translate / explain ---------- */

// Subtitles often have no punctuation to find sentences by (auto-generated
// ones especially), and a cue is often half a sentence, so the context is
// counted in cues instead: this many around the selection, within the same
// MAX_CONTEXT_CHARS as the text readers (context.js).
const CONTEXT_CUES_EACH_SIDE = 4;

// Context for the LLM: the selected cues plus CONTEXT_CUES_EACH_SIDE on each
// side, cut to maxChars. When too long, the outermost context cues go first
// (from the side with more of them), so the selected cues are kept whole.
// Only if the selected cues alone exceed the limit is their text cut, around
// its middle.
function buildVideoContext(cues, first, last, maxChars, radius = CONTEXT_CUES_EACH_SIDE) {
  let lo = Math.max(0, first - radius);
  let hi = Math.min(cues.length - 1, last + radius);
  const join = () => cues.slice(lo, hi + 1).map((c) => c.text).join(" ");
  let text = join();
  while (text.length > maxChars && (lo < first || hi > last)) {
    if (first - lo >= hi - last && lo < first) lo++;
    else hi--;
    text = join();
  }
  if (text.length > maxChars) {
    const start = Math.max(0, (text.length >> 1) - (maxChars >> 1));
    text = text.slice(start, start + maxChars);
  }
  return text.trim();
}

// Index of the cue a range boundary sits in. A boundary can also sit between
// rows (offset inside #cue-list itself) or outside the list (null).
function cueBoundaryIndex(node, offset, isEnd) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const row = el && el.closest ? el.closest(".cue") : null;
  if (row) return Number(row.dataset.index);
  if (el === cueList) {
    const i = isEnd ? offset - 1 : offset;
    return Math.min(Math.max(i, 0), cueList.children.length - 1);
  }
  return null;
}

// The part of `range` inside one cue's text (timestamps excluded), with
// whitespace normalised. Empty when the range only touches the row's edge,
// which is what a triple-click leaves at the start of the next row.
function selectedTextInCue(range, row) {
  const textEl = row.querySelector(".cue-text");
  if (!textEl) return "";
  const bounds = document.createRange();
  bounds.selectNodeContents(textEl);
  const clipped = range.cloneRange();
  if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    clipped.setStart(bounds.startContainer, bounds.startOffset);
  }
  if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    clipped.setEnd(bounds.endContainer, bounds.endOffset);
  }
  return clipped.toString().replace(/\s+/g, " ").trim();
}

// {phrase, first, last} for the cues a range covers, or null when it covers
// no cue text. The phrase is assembled from the cues' own text instead of
// selection.toString(), so it never contains timestamps or row line breaks.
function readVideoSelection(range) {
  const n = cueList.children.length;
  if (!n) return null;
  const a = cueBoundaryIndex(range.startContainer, range.startOffset, false);
  const b = cueBoundaryIndex(range.endContainer, range.endOffset, true);
  // A boundary outside the list (drag released elsewhere): scan every row.
  const from = a !== null && b !== null ? Math.min(a, b) : 0;
  const to = a !== null && b !== null ? Math.max(a, b) : n - 1;

  const parts = [];
  let first = -1;
  let last = -1;
  for (let i = from; i <= to; i++) {
    const text = selectedTextInCue(range, cueList.children[i]);
    if (!text) continue;
    if (first < 0) first = i;
    last = i;
    parts.push(text);
  }
  return parts.length ? { phrase: parts.join(" "), first, last } : null;
}

function handleVideoSelection() {
  if (!vs) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const picked = readVideoSelection(range);
  if (!picked) return;

  // Pause so the sentence stays put while it is being read.
  if (vs.player && typeof vs.player.pauseVideo === "function") vs.player.pauseVideo();

  const context = buildVideoContext(vs.cues, picked.first, picked.last, MAX_CONTEXT_CHARS);
  handleTextSelection(picked.phrase, context, range.getBoundingClientRect());
}

/* ---------- static listeners (registered once) ---------- */

cueList.addEventListener("click", (e) => {
  const button = e.target.closest(".cue-time");
  if (!button) return;
  seekToCue(Number(button.closest(".cue").dataset.index));
});

// Selecting is mousedown in the list ... mouseup anywhere (the drag may end
// outside it). Requiring the mousedown also keeps clicks on the popup's own
// buttons from re-running the translation for the still-selected text.
let videoPointerDown = false;
cueList.addEventListener("mousedown", (e) => {
  if (e.button === 0) videoPointerDown = true;
});
document.addEventListener(
  "mousedown",
  (e) => {
    if (!cueList.contains(e.target)) videoPointerDown = false;
  },
  true
);
document.addEventListener("mouseup", () => {
  if (!videoPointerDown) return;
  videoPointerDown = false;
  handleVideoSelection();
});

videoFollowBtn.addEventListener("click", () => {
  if (!vs || vs.activeIndex < 0) return;
  vs.autoScroll = true;
  centerCue(cueList.children[vs.activeIndex], true);
  videoFollowBtn.classList.add("hidden");
});

document.getElementById("back-btn").addEventListener("click", closeVideo);
