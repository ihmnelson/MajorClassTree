(() => {
  const els = {
    majorSelect: document.getElementById("major-select"),
    majorLabel: document.getElementById("major-label"),
    trackSelect: document.getElementById("track-select"),
    trackInfoToggle: document.getElementById("track-info-toggle"),
    trackInfoPanel: document.getElementById("track-info-panel"),
    tree: document.getElementById("tree"),
    treeWrap: document.getElementById("tree-wrap"),
    edges: document.getElementById("edges"),
    progressText: document.getElementById("progress-text"),
    progressFill: document.getElementById("progress-fill"),
    footer: document.getElementById("footer"),
    selectionBar: document.getElementById("selection-bar"),
    selectionText: document.getElementById("selection-text"),
    selectionClear: document.getElementById("selection-clear"),
    legendToggle: document.getElementById("legend-toggle"),
    legendPanel: document.getElementById("legend-panel"),
    courseModalBackdrop: document.getElementById("course-modal-backdrop"),
    courseModalBody: document.getElementById("course-modal-body"),
    courseModalClose: document.getElementById("course-modal-close"),
  };

  let currentData = null;
  let currentByCode = new Map();
  let dependentsMap = new Map();
  let checked = new Set();
  let activeTrack = null; // track id or null for "all"
  let selectedCode = null; // course code focused via click, or null

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

  function buildDependentsMap(courses) {
    const map = new Map(courses.map((c) => [c.code, []]));
    for (const c of courses) {
      for (const p of c.prereqs) {
        if (map.has(p)) map.get(p).push(c.code);
      }
    }
    return map;
  }

  function renderLegend(data) {
    els.legendPanel.innerHTML = "";
    const hint = document.createElement("div");
    hint.className = "legend-hint";
    hint.textContent = "Click any course to see its prerequisites and what it unlocks.";
    els.legendPanel.appendChild(hint);
    for (const cat of Object.values(data.categories)) {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<span class="legend-swatch" style="background:${cat.color}"></span>${cat.label}`;
      els.legendPanel.appendChild(item);
    }
    const markerRequired = document.createElement("div");
    markerRequired.className = "legend-item";
    markerRequired.innerHTML = `<span class="req-marker required">*</span> Required course`;
    els.legendPanel.appendChild(markerRequired);
    const markerElective = document.createElement("div");
    markerElective.className = "legend-item";
    markerElective.innerHTML = `<span class="req-marker elective">*</span> Counts toward elective requirement`;
    els.legendPanel.appendChild(markerElective);
  }

  function setLegendOpen(open) {
    els.legendPanel.hidden = !open;
    els.legendToggle.setAttribute("aria-expanded", String(open));
    els.legendToggle.textContent = open ? "✕" : "?";
  }

  function renderTrackSelect(data) {
    els.trackSelect.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All courses";
    els.trackSelect.appendChild(allOpt);

    for (const track of data.tracks || []) {
      const opt = document.createElement("option");
      opt.value = track.id;
      opt.textContent = track.label;
      els.trackSelect.appendChild(opt);
    }
  }

  function setTrack(trackId) {
    activeTrack = trackId;
    selectedCode = null;
    els.trackSelect.value = trackId || "";
    updateTrackInfoButton();
    updateVisualState();
  }

  function selectCourse(code) {
    selectedCode = selectedCode === code ? null : code;
    if (selectedCode) {
      activeTrack = null;
      els.trackSelect.value = "";
      updateTrackInfoButton();
    }
    updateVisualState();
  }

  function trackInfoHtml(track) {
    const careers = track.careers
      ? `<div class="careers"><strong>Typical jobs / industries</strong>${track.careers}</div>`
      : "";
    return `<h3>${track.label}</h3><p>${track.description || ""}</p>${careers}`;
  }

  function setTrackInfoOpen(open) {
    els.trackInfoPanel.hidden = !open;
    els.trackInfoToggle.setAttribute("aria-expanded", String(open));
  }

  function updateTrackInfoButton() {
    const track = activeTrack && currentData ? (currentData.tracks || []).find((t) => t.id === activeTrack) : null;
    els.trackInfoToggle.hidden = !track;
    if (track) {
      els.trackInfoPanel.innerHTML = trackInfoHtml(track);
    } else {
      setTrackInfoOpen(false);
    }
  }

  // Selection (click) takes priority over the track filter; only one drives
  // node dim/highlight + edge lines at a time. No edges are drawn unless a
  // course is selected.
  function updateVisualState() {
    if (!currentData) return;
    const byCode = currentByCode;
    const nodes = els.tree.querySelectorAll(".node");
    for (const n of nodes) n.classList.remove("dimmed", "highlight", "selected", "rel-prereq", "rel-dependent");

    if (selectedCode && byCode.has(selectedCode)) {
      const course = byCode.get(selectedCode);
      const prereqs = course.prereqs.filter((p) => byCode.has(p));
      const deps = dependentsMap.get(selectedCode) || [];
      const prereqSet = new Set(prereqs);
      const depSet = new Set(deps);
      for (const n of nodes) {
        const code = n.dataset.code;
        if (code === selectedCode) n.classList.add("selected");
        else if (prereqSet.has(code)) n.classList.add("rel-prereq");
        else if (depSet.has(code)) n.classList.add("rel-dependent");
        else n.classList.add("dimmed");
      }
      const edgePairs = [...prereqs.map((p) => [p, selectedCode]), ...deps.map((d) => [selectedCode, d])];
      drawEdgeList(edgePairs);
      els.selectionBar.hidden = false;
      const reqText = prereqs.length ? prereqs.join(", ") : "none";
      const unlockText = deps.length ? deps.join(", ") : "nothing yet";
      els.selectionText.innerHTML = `<strong>${course.code}</strong> — needs: ${reqText} &nbsp;·&nbsp; unlocks: ${unlockText}`;
    } else if (activeTrack) {
      const relevant = new Set();
      for (const c of currentData.courses) {
        if ((c.tracks || []).includes(activeTrack)) {
          relevant.add(c.code);
          for (const a of ancestorsOf(c.code, byCode)) relevant.add(a);
        }
      }
      for (const n of nodes) {
        const code = n.dataset.code;
        n.classList.toggle("dimmed", !relevant.has(code));
        n.classList.toggle("highlight", relevant.has(code) && (byCode.get(code).tracks || []).includes(activeTrack));
      }
      drawEdgeList([]);
      els.selectionBar.hidden = true;
    } else {
      drawEdgeList([]);
      els.selectionBar.hidden = true;
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

  // edgePairs: [[fromCode, toCode], ...] — draws only these, not the full graph.
  function drawEdgeList(edgePairs) {
    const svg = els.edges;
    svg.innerHTML = "";
    if (!edgePairs.length) return;

    const treeRect = els.tree.getBoundingClientRect();
    svg.setAttribute("width", els.tree.scrollWidth);
    svg.setAttribute("height", els.tree.scrollHeight);

    const nodeEls = new Map();
    for (const el of els.tree.querySelectorAll(".node")) {
      nodeEls.set(el.dataset.code, el);
    }

    const ns = "http://www.w3.org/2000/svg";
    for (const [fromCode, toCode] of edgePairs) {
      const sourceEl = nodeEls.get(fromCode);
      const targetEl = nodeEls.get(toCode);
      if (!sourceEl || !targetEl) continue;

      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const sx = sourceRect.right - treeRect.left;
      const sy = sourceRect.top - treeRect.top + sourceRect.height / 2;
      const tx = targetRect.left - treeRect.left;
      const ty = targetRect.top - treeRect.top + targetRect.height / 2;

      const dx = Math.max(40, (tx - sx) / 2);
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--accent)");
      path.setAttribute("stroke-opacity", "0.55");
      path.setAttribute("stroke-width", "2");
      svg.appendChild(path);
    }
  }

  function render(data) {
    currentData = data;
    checked = loadChecked(data.id);
    activeTrack = null;
    selectedCode = null;

    els.majorLabel.textContent = `— ${data.school}, ${data.major}`;
    renderLegend(data);
    renderTrackSelect(data);
    updateTrackInfoButton();

    const byCode = new Map(data.courses.map((c) => [c.code, c]));
    currentByCode = byCode;
    dependentsMap = buildDependentsMap(data.courses);
    const levels = computeLevels(data.courses);
    const maxLevel = Math.max(0, ...levels.values());
    const lanes = data.lanes && data.lanes.length ? data.lanes : [{ id: "major", label: "Courses" }];
    const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));

    const cellMap = new Map(); // "laneIdx:level" -> courses[]
    for (const c of data.courses) {
      const li = laneIndex.has(c.lane) ? laneIndex.get(c.lane) : lanes.length - 1;
      const key = `${li}:${levels.get(c.code)}`;
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key).push(c);
    }
    const catOrder = Object.keys(data.categories);
    for (const arr of cellMap.values()) {
      arr.sort((a, b) => {
        const ca = catOrder.indexOf(a.category);
        const cb = catOrder.indexOf(b.category);
        if (ca !== cb) return ca - cb;
        return a.code.localeCompare(b.code);
      });
    }

    els.tree.innerHTML = "";
    els.tree.style.gridTemplateColumns = `150px repeat(${maxLevel + 1}, 220px)`;
    els.tree.style.gridTemplateRows = `repeat(${lanes.length}, auto)`;

    // Paint order (back to front): lane bands, edge lines, course nodes.
    lanes.forEach((lane, li) => {
      const band = document.createElement("div");
      band.className = "lane-band" + (li % 2 ? " alt" : "");
      band.style.gridColumn = "1 / -1";
      band.style.gridRow = `${li + 1}`;
      const label = document.createElement("div");
      label.className = "lane-label";
      label.textContent = lane.label;
      band.appendChild(label);
      els.tree.appendChild(band);
    });

    els.tree.appendChild(els.edges);

    for (let lvl = 0; lvl <= maxLevel; lvl++) {
      lanes.forEach((lane, li) => {
        const courses = cellMap.get(`${li}:${lvl}`);
        if (!courses || !courses.length) return;
        const cell = document.createElement("div");
        cell.className = "level-cell";
        cell.style.gridColumn = `${lvl + 2}`;
        cell.style.gridRow = `${li + 1}`;
        for (const course of courses) cell.appendChild(buildNode(course, byCode, data));
        els.tree.appendChild(cell);
      });
    }

    updateProgress();
    updateVisualState();

    const offeredNote = data.offeredMeta
      ? ` Quarter-offered badges: ${data.offeredMeta.mathSource} ${data.offeredMeta.eeSource} ${data.offeredMeta.note}`
      : "";
    els.footer.innerHTML = `Source: ${data.source}. ${data.sourceNote}${offeredNote} Checked-off state is saved only in this browser (localStorage) — nothing is sent anywhere.`;
  }

  const ALL_QUARTERS = ["Au", "Wi", "Sp", "Su"];

  function requirementMarker(course) {
    if (course.category === "required-ee") {
      return `<span class="req-marker required" title="Required course">*</span>`;
    }
    if (course.category === "elective-ee") {
      return `<span class="req-marker elective" title="Counts toward the EE elective requirement">*</span>`;
    }
    return "";
  }

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

  function openCourseModal(course) {
    const desc = course.description || "No official description available for this course.";
    els.courseModalBody.innerHTML = `
      <h3>${course.code}</h3>
      <div class="modal-title">${course.title} — ${course.credits} cr</div>
      <div class="modal-desc">${desc}</div>
      <div class="modal-source">UW Bothell official course catalog description.</div>
    `;
    els.courseModalBackdrop.hidden = false;
  }

  function closeCourseModal() {
    els.courseModalBackdrop.hidden = true;
  }

  function buildNode(course, byCode, data) {
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.code = course.code;
    el.style.borderLeftColor = data.categories[course.category]?.color || "#888";

    const infoBtn = document.createElement("button");
    infoBtn.className = "info-btn";
    infoBtn.type = "button";
    infoBtn.textContent = "?";
    infoBtn.title = "UWB course description";
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCourseModal(course);
    });

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
      <div class="code">${course.code}${requirementMarker(course)}</div>
      <div class="title">${course.title}</div>
      <div class="credits">${course.credits} cr${course.prereqs.length ? ` · needs ${course.prereqs.join(", ")}` : ""}</div>
      ${quartersHtml(course)}
    `;

    el.appendChild(infoBtn);
    el.appendChild(checkbox);
    el.appendChild(info);
    el.addEventListener("click", (e) => {
      if (e.target === checkbox || e.target === infoBtn) return;
      selectCourse(course.code);
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
    window.addEventListener("resize", () => requestAnimationFrame(updateVisualState));

    els.trackSelect.addEventListener("change", () => setTrack(els.trackSelect.value || null));

    els.trackInfoToggle.addEventListener("click", () => setTrackInfoOpen(els.trackInfoPanel.hidden));
    document.addEventListener("click", (e) => {
      if (!els.trackInfoPanel.hidden && !e.target.closest(".track-control")) setTrackInfoOpen(false);
    });

    els.selectionClear.addEventListener("click", () => {
      selectedCode = null;
      updateVisualState();
    });

    els.legendToggle.addEventListener("click", () => setLegendOpen(els.legendPanel.hidden));
    document.addEventListener("click", (e) => {
      if (!els.legendPanel.hidden && !e.target.closest("#legend-widget")) setLegendOpen(false);
    });

    els.treeWrap.addEventListener("click", (e) => {
      if (selectedCode && !e.target.closest(".node")) {
        selectedCode = null;
        updateVisualState();
      }
    });

    els.courseModalClose.addEventListener("click", closeCourseModal);
    els.courseModalBackdrop.addEventListener("click", (e) => {
      if (e.target === els.courseModalBackdrop) closeCourseModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !els.courseModalBackdrop.hidden) closeCourseModal();
    });

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
