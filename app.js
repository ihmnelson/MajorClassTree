(() => {
  const els = {
    majorSelect: document.getElementById("major-select"),
    majorLabel: document.getElementById("major-label"),
    trackButtons: document.getElementById("track-buttons"),
    legend: document.getElementById("legend"),
    tree: document.getElementById("tree"),
    treeWrap: document.getElementById("tree-wrap"),
    edges: document.getElementById("edges"),
    progressText: document.getElementById("progress-text"),
    progressFill: document.getElementById("progress-fill"),
    footer: document.getElementById("footer"),
  };

  let currentData = null;
  let checked = new Set();
  let activeTrack = null; // track id or null for "all"

  function storageKey(majorId) {
    return `classtree:${majorId}:checked`;
  }

  function loadChecked(majorId) {
    try {
      const raw = localStorage.getItem(storageKey(majorId));
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function saveChecked(majorId) {
    try {
      localStorage.setItem(storageKey(majorId), JSON.stringify([...checked]));
    } catch {
      /* storage unavailable (private browsing etc) - state just won't persist */
    }
  }

  function computeLevels(courses) {
    const byCode = new Map(courses.map((c) => [c.code, c]));
    const levelCache = new Map();

    function levelOf(code, stack) {
      if (levelCache.has(code)) return levelCache.get(code);
      if (stack.has(code)) return 0; // guard against accidental cycles
      const course = byCode.get(code);
      if (!course || !course.prereqs.length) {
        levelCache.set(code, 0);
        return 0;
      }
      stack.add(code);
      let max = -1;
      for (const p of course.prereqs) {
        if (!byCode.has(p)) continue; // prereq outside dataset, ignore for layout
        max = Math.max(max, levelOf(p, stack));
      }
      stack.delete(code);
      const lvl = max + 1;
      levelCache.set(code, lvl);
      return lvl;
    }

    for (const c of courses) levelOf(c.code, new Set());
    return levelCache;
  }

  function ancestorsOf(code, byCode, seen = new Set()) {
    const course = byCode.get(code);
    if (!course) return seen;
    for (const p of course.prereqs) {
      if (!seen.has(p)) {
        seen.add(p);
        ancestorsOf(p, byCode, seen);
      }
    }
    return seen;
  }

  function renderLegend(data) {
    els.legend.innerHTML = "";
    for (const [key, cat] of Object.entries(data.categories)) {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<span class="legend-swatch" style="background:${cat.color}"></span>${cat.label}`;
      els.legend.appendChild(item);
    }
  }

  function renderTrackButtons(data) {
    els.trackButtons.innerHTML = "";
    const allBtn = document.createElement("button");
    allBtn.className = "track-btn active";
    allBtn.textContent = "All courses";
    allBtn.onclick = () => setTrack(null);
    els.trackButtons.appendChild(allBtn);

    for (const track of data.tracks || []) {
      const btn = document.createElement("button");
      btn.className = "track-btn";
      btn.textContent = track.label;
      btn.onclick = () => setTrack(track.id);
      btn.dataset.trackId = track.id;
      els.trackButtons.appendChild(btn);
    }
  }

  function setTrack(trackId) {
    activeTrack = trackId;
    for (const btn of els.trackButtons.querySelectorAll(".track-btn")) {
      const isAll = !btn.dataset.trackId;
      btn.classList.toggle("active", isAll ? trackId === null : btn.dataset.trackId === trackId);
    }
    applyTrackHighlight();
  }

  function applyTrackHighlight() {
    if (!currentData) return;
    const byCode = new Map(currentData.courses.map((c) => [c.code, c]));
    let relevant = null;
    if (activeTrack) {
      relevant = new Set();
      for (const c of currentData.courses) {
        if ((c.tracks || []).includes(activeTrack)) {
          relevant.add(c.code);
          for (const a of ancestorsOf(c.code, byCode)) relevant.add(a);
        }
      }
    }
    for (const node of els.tree.querySelectorAll(".node")) {
      const code = node.dataset.code;
      if (!relevant) {
        node.classList.remove("dimmed", "highlight");
      } else {
        node.classList.toggle("dimmed", !relevant.has(code));
        node.classList.toggle("highlight", relevant.has(code) && (byCode.get(code).tracks || []).includes(activeTrack));
      }
    }
  }

  function prereqsMet(course, byCode) {
    if (!course.prereqs.length) return true;
    return course.prereqs.every((p) => !byCode.has(p) || checked.has(p));
  }

  function updateProgress() {
    if (!currentData) return;
    let total = 0;
    let done = 0;
    for (const c of currentData.courses) {
      total += c.credits;
      if (checked.has(c.code)) done += c.credits;
    }
    els.progressText.textContent = `${done} / ${total} credits checked`;
    els.progressFill.style.width = total ? `${(done / total) * 100}%` : "0%";
  }

  function drawEdges(byCode) {
    const svg = els.edges;
    svg.innerHTML = "";
    const treeRect = els.tree.getBoundingClientRect();
    svg.setAttribute("width", els.tree.scrollWidth);
    svg.setAttribute("height", els.tree.scrollHeight);

    const nodeEls = new Map();
    for (const el of els.tree.querySelectorAll(".node")) {
      nodeEls.set(el.dataset.code, el);
    }

    const ns = "http://www.w3.org/2000/svg";
    for (const course of currentData.courses) {
      const targetEl = nodeEls.get(course.code);
      if (!targetEl) continue;
      const targetRect = targetEl.getBoundingClientRect();
      const tx = targetRect.left - treeRect.left;
      const ty = targetRect.top - treeRect.top + targetRect.height / 2;

      for (const p of course.prereqs) {
        const sourceEl = nodeEls.get(p);
        if (!sourceEl) continue;
        const sourceRect = sourceEl.getBoundingClientRect();
        const sx = sourceRect.right - treeRect.left;
        const sy = sourceRect.top - treeRect.top + sourceRect.height / 2;

        const dx = Math.max(40, (tx - sx) / 2);
        const path = document.createElementNS(ns, "path");
        path.setAttribute(
          "d",
          `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
        );
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-opacity", "0.25");
        path.setAttribute("stroke-width", "1.5");
        svg.appendChild(path);
      }
    }
  }

  function render(data) {
    currentData = data;
    checked = loadChecked(data.id);
    activeTrack = null;

    els.majorLabel.textContent = `— ${data.school}, ${data.major}`;
    renderLegend(data);
    renderTrackButtons(data);

    const byCode = new Map(data.courses.map((c) => [c.code, c]));
    const levels = computeLevels(data.courses);
    const maxLevel = Math.max(0, ...levels.values());

    const columns = [];
    for (let i = 0; i <= maxLevel; i++) columns.push([]);
    for (const c of data.courses) columns[levels.get(c.code)].push(c);
    const catOrder = Object.keys(data.categories);
    for (const col of columns) {
      col.sort((a, b) => {
        const ca = catOrder.indexOf(a.category);
        const cb = catOrder.indexOf(b.category);
        if (ca !== cb) return ca - cb;
        return a.code.localeCompare(b.code);
      });
    }

    els.tree.innerHTML = "";
    els.tree.appendChild(els.edges);

    for (const col of columns) {
      const colEl = document.createElement("div");
      colEl.className = "level-col";
      for (const course of col) {
        colEl.appendChild(buildNode(course, byCode, data));
      }
      els.tree.appendChild(colEl);
    }

    updateProgress();
    requestAnimationFrame(() => drawEdges(byCode));
    window.addEventListener("resize", () => requestAnimationFrame(() => drawEdges(byCode)), { once: false });

    const offeredNote = data.offeredMeta
      ? ` Quarter-offered badges: ${data.offeredMeta.mathSource} ${data.offeredMeta.eeSource} ${data.offeredMeta.note}`
      : "";
    els.footer.innerHTML = `Source: ${data.source}. ${data.sourceNote}${offeredNote} Checked-off state is saved only in this browser (localStorage) — nothing is sent anywhere.`;
  }

  const ALL_QUARTERS = ["Au", "Wi", "Sp", "Su"];

  function quartersHtml(course) {
    const offered = course.offered || [];
    if (!offered.length) {
      const note = course.offeredNote || "not seen in recently sampled terms";
      return `<div class="quarters no-data" title="${note}">no recent schedule data</div>`;
    }
    const pills = ALL_QUARTERS.map((q) => {
      const on = offered.includes(q);
      return `<span class="quarter${on ? " active" : ""}">${q}</span>`;
    }).join("");
    const title = course.offeredNote ? ` title="${course.offeredNote}"` : "";
    return `<div class="quarters"${title}>${pills}</div>`;
  }

  function buildNode(course, byCode, data) {
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.code = course.code;
    el.style.borderLeftColor = data.categories[course.category]?.color || "#888";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked.has(course.code);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) checked.add(course.code);
      else checked.delete(course.code);
      saveChecked(data.id);
      refreshNodeStates(byCode);
      updateProgress();
    });

    const info = document.createElement("div");
    info.className = "info";
    info.innerHTML = `
      <div class="code">${course.code}</div>
      <div class="title">${course.title}</div>
      <div class="credits">${course.credits} cr${course.prereqs.length ? ` · needs ${course.prereqs.join(", ")}` : ""}</div>
      ${quartersHtml(course)}
    `;

    el.appendChild(checkbox);
    el.appendChild(info);
    el.addEventListener("click", (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change"));
    });

    return el;
  }

  function refreshNodeStates(byCode) {
    for (const node of els.tree.querySelectorAll(".node")) {
      const course = byCode.get(node.dataset.code);
      const isChecked = checked.has(course.code);
      node.classList.toggle("checked", isChecked);
      node.classList.toggle("locked", !isChecked && !prereqsMet(course, byCode));
    }
  }

  async function loadMajor(entry) {
    const res = await fetch(entry.file);
    const data = await res.json();
    render(data);
    refreshNodeStates(new Map(data.courses.map((c) => [c.code, c])));
  }

  async function init() {
    const res = await fetch("data/majors.json");
    const majors = await res.json();
    for (const m of majors) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.school} — ${m.label}`;
      els.majorSelect.appendChild(opt);
    }
    els.majorSelect.addEventListener("change", () => {
      const entry = majors.find((m) => m.id === els.majorSelect.value);
      if (entry) loadMajor(entry);
    });
    if (majors.length) loadMajor(majors[0]);
  }

  init();
})();
