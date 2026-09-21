/**
 * Azazie spec-qa overlay. Boxes follow the live node on scroll / resize / zoom.
 *
 * window.__azazieSpecQaOverlay({
 *   items: [{
 *     id: 'S1', sev: '严重', label: '字号：What happened?  线上为 20px，改为设计稿的 16px',
 *     box: {x,y,w,h},
 *     el: Element,
 *     elA / elB: Element  — 间距: paint the gap strip between A.bottom and B.top (not A's box)
 *     sel: string,
 *     selA / selB: string,
 *     getBox: fn,
 *     mark: 'gap' | undefined — fill the vertical gap band; implied if elA+elB or selA+selB
 *   }],
 *   legendTitle: '全部 10 处',
 *   notes: { aligned: '...', unmeasured: '...', design: '无' },
 *   device: 'PC' | 'M'  — walkthrough device (required from the skill).
 *     Sets window title to 「Azazie 走查标注 · PC」or「· M」.
 *   frameWidth: optional Figma device-frame width. Used only when device is omitted:
 *     ≤520 → M (360 / 375 / 390 / 414 / 428 …)
 *     ≥768 → PC (1024 / 1280 / 1366 / 1440 / 1512 / 1600 / 1680 / 1920 …)
 *     521–767 → no Pad device in this skill; treat as PC unless the user said M
 *     If both omitted, same cut on innerWidth.
 *   panel: 'auto' | 'side' | 'float' | 'page'
 *     auto (default): M → side (docked **to the right of** the page window, no overlap);
 *       PC → float (independent, not covering the page)
 *     side: always to the right of the live window (`screenX + outerWidth + 8`)
 *     float / page: force layout; title still follows device
 *   panelName / panelTitle: optional override for window name / document title
 *   holdOpen: CSS selector or [selectors] — keep dropdowns/panels display:block
 *     while the overlay is on (nav hover menus stay put for alignment)
 *   dismissKey: optional persist key for ignored rows (default pathname|legendTitle)
 * })
 *
 * After paint: __azazieSpecQaOverlay.exportShare() → JSON of remaining (not ×-ignored) items + selectors.
 * __azazieSpecQaOverlay.shareMarkdown() → the same list as chat copy.
 *
 * Remove: window.__azazieSpecQaOverlay.remove()
 *
 * Credit: Created by white.zhang.
 */
(function (root) {
  var scrollUnbind = null;
  var holdOpenUnbind = null;
  var panelWin = null;
  var STORAGE_KEY = "azazie-spec-qa-overlay-toggles";
  var DISMISS_KEY = "azazie-spec-qa-overlay-dismissed";
  var CREATOR_MARK = "white.zhang";
  var CREATOR_LINE = "Created by white.zhang.";
  var NARROW = 520;
  var PANEL_W = 440;
  var PANEL_H = 860;

  function docSize() {
    var de = document.documentElement;
    var b = document.body;
    return Math.max(
      de.scrollHeight,
      b ? b.scrollHeight : 0,
      de.offsetHeight,
      b ? b.offsetHeight : 0,
      window.innerHeight
    );
  }

  function roundMax(n, min) {
    return Math.round(Math.max(n, min));
  }

  function roundBox(box, addScroll) {
    if (!box) return null;
    var x = Number(box.x) || 0;
    var y = Number(box.y) || 0;
    if (addScroll) {
      x += window.scrollX;
      y += window.scrollY;
    }
    return {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(Number(box.w) || 0),
      h: roundMax(Number(box.h) || 0, 4),
    };
  }

  function rectEl(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect();
    var w = r.width || el.offsetWidth || 0;
    var h = r.height || el.offsetHeight || 0;
    if (w < 1 && h < 1) return null;
    return { x: r.left, y: r.top, w: w || 4, h: h || 4 };
  }

  function queryEl(sel) {
    if (!sel) return null;
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function liveEl(it) {
    if (it.el && it.el.isConnected !== false) return it.el;
    return queryEl(it.sel);
  }

  function gapRect(a, b) {
    if (!a || !b) return null;
    var A = a.getBoundingClientRect();
    var B = b.getBoundingClientRect();
    var left = Math.min(A.left, B.left);
    var right = Math.max(A.right, B.right);
    return {
      x: left,
      y: A.bottom,
      w: Math.max(right - left, 4),
      h: Math.max(B.top - A.bottom, 4),
    };
  }

  function livePair(it) {
    var a =
      it.elA && it.elA.isConnected !== false ? it.elA : queryEl(it.selA);
    var b =
      it.elB && it.elB.isConnected !== false ? it.elB : queryEl(it.selB);
    return { a: a, b: b };
  }

  function isGapItem(it) {
    if (it.mark === "gap" || it.kind === "gap") return true;
    var p = livePair(it);
    return !!(p.a && p.b);
  }

  function resolveBox(it) {
    if (typeof it.getBox === "function") {
      var g = it.getBox();
      if (g) return roundBox(g, it.boxSpace !== "document");
    }
    var pair = livePair(it);
    if (pair.a && pair.b) {
      var gap = gapRect(pair.a, pair.b);
      if (gap) return roundBox(gap, true);
    }
    var el = liveEl(it);
    if (el) return roundBox(rectEl(el), true);
    if (it.box) return roundBox(it.box, it.boxSpace === "viewport");
    return null;
  }

  function applyBox(node, box) {
    if (!node) return;
    if (!box || box.w < 1) {
      node.style.display = "none";
      return;
    }
    node.style.display = "block";
    node.style.left = box.x + "px";
    node.style.top = box.y + "px";
    node.style.width = box.w + "px";
    node.style.height = Math.max(box.h, 4) + "px";
  }

  function loadDismissed(key) {
    try {
      var raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
      var ids = raw[key];
      return Array.isArray(ids) ? ids.filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }

  function saveDismissed(key, ids) {
    try {
      var raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
      raw[key] = ids || [];
      localStorage.setItem(DISMISS_KEY, JSON.stringify(raw));
    } catch (e) {}
  }

  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, "\\$&");
  }

  function cssPath(el) {
    if (!el || !el.tagName || el.nodeType !== 1) return "";
    if (el.id) return "#" + cssEscape(el.id);
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 10) {
      if (cur.id) {
        parts.unshift("#" + cssEscape(cur.id));
        break;
      }
      var sel = cur.tagName.toLowerCase();
      var cls = typeof cur.className === "string" ? cur.className.trim() : "";
      if (cls) {
        var bits = cls.split(/\s+/).filter(Boolean).slice(0, 3);
        if (bits.length) sel += "." + bits.map(cssEscape).join(".");
      }
      var parent = cur.parentElement;
      if (parent) {
        var kids = parent.children;
        var same = 0;
        var idx = 0;
        var i;
        for (i = 0; i < kids.length; i++) {
          if (kids[i].tagName === cur.tagName) {
            same++;
            if (kids[i] === cur) idx = same;
          }
        }
        if (same > 1) sel += ":nth-of-type(" + idx + ")";
      }
      parts.unshift(sel);
      cur = parent;
      depth++;
    }
    return parts.join(" > ");
  }

  function copyText(text, doc) {
    doc = doc || document;
    var w = doc.defaultView || window;
    if (w.navigator && w.navigator.clipboard && w.navigator.clipboard.writeText) {
      w.navigator.clipboard.writeText(text);
      return;
    }
    var ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "readonly");
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    doc.body.appendChild(ta);
    ta.select();
    try {
      doc.execCommand("copy");
    } catch (e) {}
    ta.remove();
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { badges: true, boxes: true, legend: true };
      var p = JSON.parse(raw);
      return {
        badges: p.badges !== false,
        boxes: p.boxes !== false,
        legend: p.legend !== false,
      };
    } catch (e) {
      return { badges: true, boxes: true, legend: true };
    }
  }

  function classifyWidth(w) {
    w = Number(w);
    if (!isFinite(w) || w <= 0) return "";
    if (w <= NARROW) return "M";
    return "PC";
  }

  function resolveDevice(opts) {
    var raw = opts && opts.device;
    if (raw != null) {
      var d = String(raw).trim().toUpperCase();
      if (d === "M" || d === "MOBILE") return "M";
      if (d === "PC" || d === "DESKTOP") return "PC";
    }
    var fromFrame = classifyWidth(opts && (opts.frameWidth != null ? opts.frameWidth : opts.viewportWidth));
    if (fromFrame) return fromFrame;
    return classifyWidth(window.innerWidth) || "PC";
  }

  function deviceSuffix(device) {
    return device === "M" ? "M" : "PC";
  }

  function wantSidePanel(opts) {
    var mode = (opts && opts.panel) || "auto";
    if (mode === "page") return false;
    if (mode === "side" || mode === "float") return true;
    return true;
  }

  function isFloatPanel(opts) {
    var mode = (opts && opts.panel) || "auto";
    if (mode === "float") return true;
    if (mode === "side" || mode === "page") return false;
    return resolveDevice(opts) === "PC";
  }

  function panelLeft() {
    var outer = window.outerWidth || window.innerWidth || 0;
    var sx = window.screenX || window.screenLeft || 0;
    return Math.max(0, Math.round(sx + outer + 8));
  }

  function panelTop() {
    return (window.screenY || window.screenTop || 0) + 40;
  }

  function closePanel() {
    if (panelWin && !panelWin.closed) {
      try {
        panelWin.close();
      } catch (e) {}
    }
    panelWin = null;
  }

  function paint(opts) {
    if (Array.isArray(opts)) opts = { items: opts };
    opts = opts || {};
    paint.remove();
    var items = opts.items || [];
    var prefs = loadPrefs();
    var showBadges = prefs.badges;
    var showBoxes = prefs.boxes;
    var showLegend = prefs.legend;
    var hoverId = null;
    var hoverPinned = false;
    var dismissKey =
      (opts && opts.dismissKey) ||
      String(location.pathname || "") + "|" + String((opts && opts.legendTitle) || "spec-qa");
    var dismissed = loadDismissed(dismissKey);
    var device = resolveDevice(opts);
    var useSide = wantSidePanel(opts);
    var floatPanel = isFloatPanel(opts);
    var layer = document.createElement("div");
    layer.id = "azazie-spec-qa-overlay";
    layer.setAttribute("data-creator", CREATOR_MARK);
    layer.style.cssText = [
      "position:absolute",
      "left:0",
      "top:0",
      "width:100%",
      "height:" + docSize() + "px",
      "z-index:2147483647",
      "pointer-events:none",
      "overflow:visible",
      "font-family:Inter,system-ui,sans-serif",
    ].join(";");

    var tracked = [];
    items.forEach(function (it) {
      var color = it.sev === "严重" ? "#C62828" : "#E65100";
      var gapMark = isGapItem(it);
      var node = document.createElement("div");
      node.setAttribute("data-azazie-id", it.id);
      node.style.cssText = [
        "position:absolute",
        "z-index:1",
        "outline:2px solid " + color,
        "outline-offset:" + (gapMark ? "0" : "1px"),
        "background:" +
          (gapMark
            ? it.sev === "严重"
              ? "rgba(198,40,40,.38)"
              : "rgba(46,125,50,.45)"
            : it.sev === "严重"
              ? "rgba(198,40,40,.12)"
              : "rgba(230,81,0,.10)"),
      ].join(";");
      var badge = document.createElement("div");
      badge.setAttribute("data-azazie-badge", "1");
      badge.textContent = it.id;
      badge.style.cssText =
        "position:absolute;left:-2px;top:" +
        (gapMark ? "50%;transform:translateY(-50%)" : "-16px") +
        ";background:" +
        color +
        ";color:#fff;font-size:11px;line-height:16px;padding:0 5px;font-weight:600;white-space:nowrap;";
      node.appendChild(badge);
      applyBox(node, resolveBox(it));
      layer.appendChild(node);
      tracked.push({ it: it, node: node });
    });

    function setHover(id, pin) {
      hoverId = id || null;
      hoverPinned = !!id && pin === true;
      applyVisibility();
      paintLegendRows();
    }
    function clearHover() {
      hoverId = null;
      hoverPinned = false;
      applyVisibility();
      paintLegendRows();
    }
    function isDismissed(id) {
      return dismissed.indexOf(id) !== -1;
    }
    function visibleCount() {
      return items.filter(function (it) {
        return !isDismissed(it.id);
      }).length;
    }
    function legendTitleText() {
      var n = visibleCount();
      return "全部 " + n + " 处";
    }
    function applyVisibility() {
      tracked.forEach(function (t) {
        if (isDismissed(t.it.id)) {
          t.node.style.visibility = "hidden";
          return;
        }
        var on = hoverId ? t.it.id === hoverId : showBoxes;
        t.node.style.visibility = on ? "visible" : "hidden";
      });
    }
    function missingIds() {
      var ids = [];
      tracked.forEach(function (t) {
        if (isDismissed(t.it.id)) return;
        if (t.node.style.display === "none") ids.push(t.it.id);
      });
      return ids;
    }
    function persistDismissed() {
      saveDismissed(dismissKey, dismissed);
    }
    function refreshLegendsAndControls() {
      var title = legendTitleText();
      if (legend) fillLegend(legend, title);
      if (panelWin && !panelWin.closed && panelWin.document) {
        var pl = panelWin.document.getElementById("azazie-spec-qa-legend");
        if (pl) fillLegend(pl, title);
      }
      if (controls) renderControlsInto(controls, true);
      if (panelWin && !panelWin.closed && panelWin.document) {
        var pc = panelWin.document.getElementById("azazie-spec-qa-controls");
        if (pc) renderControlsInto(pc, false);
      }
    }
    function dismissItem(id) {
      if (!id || isDismissed(id)) return;
      dismissed.push(id);
      persistDismissed();
      if (hoverId === id) clearHover();
      else applyVisibility();
      refreshLegendsAndControls();
    }
    function restoreDismissed() {
      dismissed = [];
      persistDismissed();
      applyVisibility();
      refreshLegendsAndControls();
    }
    function serializeItem(it) {
      var live = liveEl(it);
      var pair = livePair(it);
      var row = {
        id: it.id,
        sev: it.sev || "",
        label: it.label || "",
      };
      if (it.mark) row.mark = it.mark;
      var sel = it.sel || cssPath(live);
      var selA = it.selA || cssPath(it.elA || (pair && pair.a));
      var selB = it.selB || cssPath(it.elB || (pair && pair.b));
      if (sel) row.sel = sel;
      if (selA) row.selA = selA;
      if (selB) row.selB = selB;
      return row;
    }
    function exportShare() {
      var confirmed = items.filter(function (it) {
        return !isDismissed(it.id);
      });
      return {
        v: 1,
        created: CREATOR_LINE,
        module: (opts && opts.module) || "",
        url: String(location.href || ""),
        viewport: [window.innerWidth, window.innerHeight],
        dpr: window.devicePixelRatio || 1,
        device: device,
        holdOpen: (opts && opts.holdOpen) || null,
        legendTitle: legendTitleText(),
        notes: (opts && opts.notes) || {},
        dismissed: dismissed.slice(),
        items: confirmed.map(serializeItem),
      };
    }
    function shareMarkdown(p) {
      p = p || exportShare();
      var lines = [];
      var title = (p.module || "模块") + " · " + (p.device || "PC");
      lines.push("# 还原走查 · " + title);
      lines.push("");
      lines.push(
        "确认 " +
          p.items.length +
          " 处" +
          (p.dismissed && p.dismissed.length ? "（已忽略 " + p.dismissed.join("、") + "）" : "")
      );
      lines.push("");
      lines.push(
        "环境：视口 " +
          (p.viewport || []).join("×") +
          " · dpr " +
          p.dpr +
          " · " +
          (p.url || "")
      );
      lines.push("");
      lines.push("全部 " + p.items.length + " 处");
      p.items.forEach(function (it) {
        lines.push(it.id + "  " + (it.sev || "") + "  " + (it.label || ""));
      });
      var notes = p.notes || {};
      lines.push("");
      lines.push("对齐的");
      lines.push(notes.aligned || "无");
      lines.push("");
      lines.push("未测 / 不算缺陷");
      lines.push(notes.unmeasured || "无");
      lines.push("");
      lines.push("设计侧备注");
      lines.push(notes.design || "无");
      lines.push("");
      lines.push(CREATOR_LINE);
      return lines.join("\n");
    }
    function jumpTo(id) {
      if (isDismissed(id)) return;
      var hit = tracked.filter(function (t) {
        return t.it.id === id;
      })[0];
      if (!hit) return;
      applyBox(hit.node, resolveBox(hit.it));
      if (hit.node.style.display === "none") return;
      hit.node.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    function savePrefs() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ badges: showBadges, boxes: showBoxes, legend: showLegend })
        );
      } catch (e) {}
    }

    var legend = null;
    var controls = null;

    function applyLegend() {
      if (legend) legend.style.display = showLegend ? "block" : "none";
    }
    function paintLegendRows() {
      var hosts = [];
      if (legend) hosts.push(legend);
      if (panelWin && !panelWin.closed && panelWin.document) {
        var pl = panelWin.document.getElementById("azazie-spec-qa-legend");
        if (pl) hosts.push(pl);
      }
      hosts.forEach(function (host) {
        var rows = host.querySelectorAll("[data-jump]");
        Array.prototype.forEach.call(rows, function (row) {
          var id = row.getAttribute("data-jump");
          var dim = hoverId && hoverId !== id;
          row.style.background = hoverId === id ? "#F6F6F6" : "transparent";
          row.style.opacity = dim ? "0.4" : "1";
        });
      });
    }

    function fillLegend(host, titleText) {
      var doc = host.ownerDocument || document;
      host.innerHTML = "";
      var titleEl = doc.createElement("div");
      titleEl.style.cssText = "font-weight:600;margin-bottom:4px;cursor:pointer";
      titleEl.textContent = titleText;
      titleEl.title = "点击显示全部红框";
      titleEl.addEventListener("click", function () {
        clearHover();
      });
      host.appendChild(titleEl);
      var hint = doc.createElement("div");
      hint.style.cssText = "margin:0 0 8px;font-size:11px;line-height:16px;color:#666666";
      hint.textContent = "hover 只看该条；点击钉住；右侧 × 忽略该条";
      host.appendChild(hint);
      var credit = doc.createElement("div");
      credit.setAttribute("data-creator", CREATOR_MARK);
      credit.style.cssText = "margin:0 0 10px;font-size:11px;line-height:16px;color:#666666";
      credit.textContent = CREATOR_LINE;
      host.appendChild(credit);
      items.forEach(function (it) {
        if (isDismissed(it.id)) return;
        var c = it.sev === "严重" ? "#C62828" : "#E65100";
        var row = doc.createElement("div");
        row.setAttribute("data-jump", it.id);
        row.style.cssText =
          "margin:0 0 6px;cursor:pointer;padding:4px 6px;margin-left:-6px;margin-right:-6px;border-radius:4px;display:flex;align-items:flex-start;gap:8px";
        var body = doc.createElement("div");
        body.style.cssText = "flex:1 1 auto;min-width:0";
        var idSpan = doc.createElement("span");
        idSpan.style.cssText = "color:" + c + ";font-weight:600";
        idSpan.textContent = it.id + "  " + (it.sev || "");
        body.appendChild(idSpan);
        body.appendChild(doc.createTextNode("  " + (it.label || "")));
        var del = doc.createElement("button");
        del.type = "button";
        del.setAttribute("data-dismiss", it.id);
        del.textContent = "×";
        del.title = "忽略这条";
        del.style.cssText =
          "flex:0 0 auto;margin-left:auto;border:0;background:transparent;color:#999;cursor:pointer;font-size:16px;line-height:16px;padding:0 4px";
        del.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          dismissItem(it.id);
        });
        row.appendChild(body);
        row.appendChild(del);
        row.addEventListener("mouseenter", function () {
          setHover(it.id, false);
        });
        row.addEventListener("mouseleave", function (e) {
          if (hoverPinned) return;
          var next = e.relatedTarget;
          if (next && next.closest && next.closest("[data-jump]")) return;
          clearHover();
        });
        row.addEventListener("click", function () {
          setHover(it.id, true);
          jumpTo(it.id);
        });
        host.appendChild(row);
      });
      if (dismissed.length) {
        var ignored = doc.createElement("div");
        ignored.style.cssText = "margin:0 0 8px;font-size:11px;line-height:16px;color:#666666";
        ignored.textContent = "已忽略 " + dismissed.join("、") + "  ";
        var undo = doc.createElement("button");
        undo.type = "button";
        undo.textContent = "恢复";
        undo.style.cssText =
          "border:0;background:transparent;color:#121212;cursor:pointer;font-size:11px;padding:0;text-decoration:underline";
        undo.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          restoreDismissed();
        });
        ignored.appendChild(undo);
        host.appendChild(ignored);
      }
      var notes = opts.notes || {};
      var noteBits = [
        ["对齐的", notes.aligned || "无"],
        ["未测 / 不算缺陷", notes.unmeasured || "无"],
        ["设计侧备注", notes.design || "无"],
      ];
      var noteWrap = doc.createElement("div");
      noteWrap.style.cssText =
        "margin-top:10px;padding-top:8px;border-top:1px solid #e6e6e6;color:#666666;font-size:11px;line-height:16px";
      noteBits.forEach(function (pair) {
        var line = doc.createElement("div");
        line.style.cssText = "margin:0 0 6px";
        var head = doc.createElement("span");
        head.style.cssText = "font-weight:600;color:#121212";
        head.textContent = pair[0] + " ";
        line.appendChild(head);
        line.appendChild(doc.createTextNode(pair[1]));
        noteWrap.appendChild(line);
      });
      host.appendChild(noteWrap);
    }

    function bindControlHost(host) {
      host.addEventListener("change", function (e) {
        var t = e.target && e.target.getAttribute && e.target.getAttribute("data-toggle");
        if (t === "badges") {
          showBadges = e.target.checked;
          var badges = layer.querySelectorAll("[data-azazie-badge]");
          Array.prototype.forEach.call(badges, function (b) {
            b.style.display = showBadges ? "block" : "none";
          });
          savePrefs();
        }
        if (t === "boxes") {
          showBoxes = e.target.checked;
          applyVisibility();
          savePrefs();
        }
        if (t === "legend") {
          showLegend = e.target.checked;
          applyLegend();
          savePrefs();
        }
      });
      host.addEventListener("click", function (e) {
        var t = e.target && e.target.getAttribute && e.target.getAttribute("data-restore");
        if (t) {
          e.preventDefault();
          restoreDismissed();
          return;
        }
        var share = e.target && e.target.getAttribute && e.target.getAttribute("data-share");
        if (!share) return;
        e.preventDefault();
        var payload = exportShare();
        var text = share === "json" ? JSON.stringify(payload, null, 2) : shareMarkdown(payload);
        copyText(text, host.ownerDocument);
        var orig = e.target.textContent;
        e.target.textContent = share === "json" ? "已复制分享包" : "已复制已确认清单";
        setTimeout(function () {
          if (e.target) e.target.textContent = orig;
        }, 1400);
      });
    }

    function renderControlsInto(host, withLegendToggle) {
      var miss = missingIds();
      var html =
        "<div style='font-weight:600;margin-bottom:6px'>标注开关</div>" +
        "<label style='display:block;cursor:pointer'><input type='checkbox' data-toggle='badges'" +
        (showBadges ? " checked" : "") +
        "> 编号标签</label>" +
        "<label style='display:block;cursor:pointer'><input type='checkbox' data-toggle='boxes'" +
        (showBoxes ? " checked" : "") +
        "> 红框</label>";
      if (withLegendToggle) {
        html +=
          "<label style='display:block;cursor:pointer'><input type='checkbox' data-toggle='legend'" +
          (showLegend ? " checked" : "") +
          "> 问题清单</label>";
      }
      if (dismissed.length) {
        html +=
          "<button type='button' data-restore='1' style='display:block;margin-top:8px;cursor:pointer;border:1px solid #ccc;background:#fff;padding:4px 8px;font-size:12px'>恢复已忽略（" +
          dismissed.length +
          "）</button>";
      }
      html +=
        "<button type='button' data-share='md' style='display:block;margin-top:8px;cursor:pointer;border:1px solid #ccc;background:#fff;padding:4px 8px;font-size:12px'>复制已确认清单</button>" +
        "<button type='button' data-share='json' style='display:block;margin-top:6px;cursor:pointer;border:1px solid #ccc;background:#fff;padding:4px 8px;font-size:12px'>复制分享包</button>";
      html +=
        (miss.length
          ? "<div style='margin-top:8px;color:#666;font-size:11px;line-height:16px'>当前页找不到：" +
            miss.join("、") +
            "</div>"
          : "") +
        "<div data-creator='" +
        CREATOR_MARK +
        "' style='margin-top:8px;color:#666;font-size:11px;line-height:16px'>" +
        CREATOR_LINE +
        "</div>";
      host.innerHTML = html;
    }

    function openSidePanel() {
      var floatPanel = isFloatPanel(opts);
      var suffix = deviceSuffix(device);
      var winName = (opts && opts.panelName) || "azazie-spec-qa-panel-" + suffix.toLowerCase();
      var winTitle = (opts && opts.panelTitle) || "Azazie 走查标注 · " + suffix;
      var feat =
        "popup=yes,width=" +
        PANEL_W +
        ",height=" +
        PANEL_H +
        ",left=" +
        (floatPanel ? 80 : panelLeft()) +
        ",top=" +
        (floatPanel ? 80 : panelTop()) +
        ",menubar=no,toolbar=no,location=no,status=no";
      var w = null;
      try {
        w = window.open("about:blank", winName, feat);
      } catch (e) {
        w = null;
      }
      if (!w || w.closed) return false;
      panelWin = w;
      try {
        w.document.open();
        w.document.write(
          "<!doctype html><html><head><meta charset='utf-8'><title>" +
            winTitle +
            "</title></head>" +
            "<body style='margin:0;background:#f6f6f6;color:#121212;font-family:Inter,system-ui,sans-serif'></body></html>"
        );
        w.document.close();
      } catch (e) {
        closePanel();
        return false;
      }
      try {
        if (!floatPanel) {
          w.moveTo(panelLeft(), panelTop());
        }
        w.resizeTo(PANEL_W, PANEL_H);
        w.focus();
      } catch (e) {}
      var doc = w.document;
      var wrap = doc.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;height:100vh;box-sizing:border-box;padding:12px;gap:12px";
      var ctrl = doc.createElement("div");
      ctrl.id = "azazie-spec-qa-controls";
      ctrl.style.cssText =
        "background:#fff;border:1px solid #ccc;padding:8px 10px;font-size:12px;line-height:18px;flex:0 0 auto";
      var list = doc.createElement("div");
      list.id = "azazie-spec-qa-legend";
      list.style.cssText =
        "background:#fff;border:1px solid #ccc;padding:12px;font-size:12px;line-height:18px;overflow:auto;flex:1 1 auto";
      wrap.appendChild(ctrl);
      wrap.appendChild(list);
      doc.body.appendChild(wrap);
      renderControlsInto(ctrl, false);
      bindControlHost(ctrl);
      fillLegend(list, legendTitleText());
      w.addEventListener("beforeunload", function () {
        if (panelWin === w) panelWin = null;
      });
      return true;
    }

    var sideOk = false;
    if (useSide) {
      sideOk = openSidePanel();
      if (sideOk) showLegend = false;
    }

    if (!sideOk) {
      legend = document.createElement("div");
      legend.id = "azazie-spec-qa-legend";
      legend.style.cssText =
        "position:fixed;right:16px;top:80px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 100px);overflow:auto;background:#fff;color:#121212;border:1px solid #ccc;padding:12px;font-size:12px;line-height:18px;pointer-events:auto;z-index:2147483647;";
      fillLegend(legend, legendTitleText());
      if (useSide) showLegend = false;
      applyLegend();
      layer.appendChild(legend);

      controls = document.createElement("div");
      controls.style.cssText =
        "position:fixed;left:16px;top:80px;background:#fff;color:#121212;border:1px solid #ccc;padding:8px 10px;font-size:12px;line-height:18px;pointer-events:auto;z-index:2147483647;";
      renderControlsInto(controls, true);
      bindControlHost(controls);
      layer.appendChild(controls);
    }

    document.body.appendChild(layer);

    paint.hover = setHover;
    paint.jump = jumpTo;
    paint.exportShare = exportShare;
    paint.shareMarkdown = shareMarkdown;

    function relayout() {
      layer.style.height = docSize() + "px";
      tracked.forEach(function (t) {
        applyBox(t.node, resolveBox(t.it));
        var badge = t.node.querySelector("[data-azazie-badge]");
        if (badge) badge.style.display = showBadges ? "block" : "none";
      });
      applyVisibility();
      applyLegend();
      if (controls) renderControlsInto(controls, true);
      if (panelWin && !panelWin.closed) {
        var pc = panelWin.document.getElementById("azazie-spec-qa-controls");
        if (pc) renderControlsInto(pc, false);
        if (!floatPanel) {
          try {
            panelWin.moveTo(panelLeft(), panelTop());
          } catch (e) {}
        }
      }
    }
    window.addEventListener("scroll", relayout, true);
    window.addEventListener("resize", relayout);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", relayout);
      window.visualViewport.addEventListener("scroll", relayout);
    }
    scrollUnbind = function () {
      window.removeEventListener("scroll", relayout, true);
      window.removeEventListener("resize", relayout);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", relayout);
        window.visualViewport.removeEventListener("scroll", relayout);
      }
    };

    (function startHoldOpen() {
      var sels = opts.holdOpen;
      if (!sels) return;
      if (typeof sels === "string") sels = [sels];
      function applyHold() {
        sels.forEach(function (sel) {
          var el = queryEl(sel);
          if (!el) return;
          el.style.setProperty("display", "block", "important");
          el.style.setProperty("visibility", "visible", "important");
          el.style.setProperty("opacity", "1", "important");
        });
      }
      applyHold();
      var obs = new MutationObserver(applyHold);
      try {
        obs.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ["style", "class"],
        });
      } catch (e) {}
      var timer = setInterval(applyHold, 250);
      holdOpenUnbind = function () {
        try {
          obs.disconnect();
        } catch (e) {}
        clearInterval(timer);
      };
    })();

    relayout();
    requestAnimationFrame(relayout);

    return {
      ok: true,
      n: tracked.length,
      missing: missingIds(),
      panel: sideOk ? (floatPanel ? "float" : "side") : "page",
      device: device,
    };
  }

  paint.remove = function () {
    if (scrollUnbind) {
      scrollUnbind();
      scrollUnbind = null;
    }
    if (holdOpenUnbind) {
      holdOpenUnbind();
      holdOpenUnbind = null;
    }
    closePanel();
    var old = document.getElementById("azazie-spec-qa-overlay");
    if (old) old.remove();
  };

  root.__azazieSpecQaOverlay = paint;
  return "azazie-overlay-ready";
})(typeof window !== "undefined" ? window : globalThis);
(function(){
  var P = {"v": 1, "created": "Created by white.zhang.", "module": "Bridesmaids 导航下拉", "url": "https://ft2.azazie.com/", "viewport": [1920, 1080], "dpr": 2, "device": "PC", "holdOpen": "#az_nav_sub_menu_8417", "legendTitle": "全部 14 处", "notes": {"aligned": "链接字号 14/400/#121212；Ships Now 为描边闪电（不报实心）；COMPLETE THE LOOK 14/600/#999999、高 28px、底部分割线 1px #e5e5e5；列间距 50px + 1px #e5e5e5；面板上下内边距 30px；色块 icon 16×16；卡片标题条高 40px、背景 #ede1d3；圆角 0；标题→列表 10px", "unmeasured": "面板高度、各列宽为稿 HUG；BROWSE 线上为 FEATURED；SHOP BY SEASON、Sale、NEW! 无 DOM；底栏文案无节点；稿 2 卡 / 线 3 卡；圈外顶栏未测", "design": "FEATURED 列：普通列表与工具三入口之间是 1px #e5e5e5，两侧 itemSpacing 15。工具三项连续：Ships Now / Home Try On / Swatches，icon 16×16 1px #121212 描边。本模块文字行高 AUTO。同列下一段标题 itemSpacing 30。"}, "dismissed": ["T1", "S1", "S2"], "items": [{"id": "S3", "sev": "严重", "label": "尺寸：底部条  线上没有独立底栏，改为设计稿的 40px"}, {"id": "S4", "sev": "严重", "label": "宽度：运营卡片  线上为 186px，改为设计稿的 230px", "sel": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu:nth-of-type(5) > div.submenu-img-box > div.submenu-img-item:nth-of-type(1) > a.item-link"}, {"id": "S5", "sev": "严重", "label": "高度：运营卡片图  线上为 240px，改为设计稿的 298px", "sel": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu:nth-of-type(5) > div.submenu-img-box > div.submenu-img-item:nth-of-type(1) > a.item-link > img.nav_img_0"}, {"id": "S6", "sev": "严重", "label": "间距：卡片↔卡片  线上为 12px，改为设计稿的 20px", "mark": "gap", "selA": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu:nth-of-type(5) > div.submenu-img-box > div.submenu-img-item:nth-of-type(1) > a.item-link", "selB": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu:nth-of-type(5) > div.submenu-img-box > div.submenu-img-item:nth-of-type(2) > a.item-link"}, {"id": "S7", "sev": "严重", "label": "间距：Mesh↔COMPLETE THE LOOK  线上为 20px，改为设计稿的 30px", "mark": "gap", "selA": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(3) > div.US:nth-of-type(2) > ul > li:nth-of-type(7) > a", "selB": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(3) > div.US:nth-of-type(2) > ul > li:nth-of-type(8) > a.bold.interval"}, {"id": "S8", "sev": "严重", "label": "间距：Gift Guide↔SHOP BY TREND  线上为 20px，改为设计稿的 30px", "mark": "gap", "selA": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(4) > div.US:nth-of-type(2) > ul > li:nth-of-type(7) > a", "selB": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(4) > div.US:nth-of-type(2) > ul > li:nth-of-type(8) > a.bold.interval"}, {"id": "S9", "sev": "严重", "label": "间距：工具入口分割线  线上没有 1px #e5e5e5，改为设计稿的 1px #e5e5e5", "mark": "gap", "selA": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(12)", "selB": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(13)"}, {"id": "S10", "sev": "严重", "label": "Icon：Home Try On  线上为 实心填充图，改为设计稿的 16×16 1px #121212 描边房子", "sel": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(15) > a > img.color-img"}, {"id": "S11", "sev": "严重", "label": "Icon：Swatches  线上为 叉形实心图，改为设计稿的 16×16 1px #121212 描边双方形色卡", "sel": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(16) > a > img.color-img"}, {"id": "S12", "sev": "严重", "label": "间距：工具入口分组  线上被 Flower Girl Dresses 拆开，改为设计稿的 Ships Now / Home Try On / Swatches 连续一组", "sel": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(13)"}, {"id": "T2", "sev": "中等", "label": "间距：列表项  线上为 7px，改为设计稿的 10px", "mark": "gap", "selA": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(1)", "selB": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(2)"}, {"id": "T3", "sev": "中等", "label": "行高：链接  线上为 24px，改为设计稿的 auto", "sel": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(1)"}, {"id": "T4", "sev": "中等", "label": "字号：卡片标题  线上为 13px，改为设计稿的 14px", "sel": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu:nth-of-type(5) > div.submenu-img-box > div.submenu-img-item:nth-of-type(1) > a.item-link > div.item-link-title:nth-of-type(2)"}, {"id": "T5", "sev": "中等", "label": "间距：工具icon↔文案  线上为 4px，改为设计稿的 5px", "mark": "gap", "selA": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(13) > a > img.color-img", "selB": "#az_nav_sub_menu_8417 > div.desktop-wrapper > div.header-submenu.header-submenu-normal.right_divider:nth-of-type(1) > div.US:nth-of-type(2) > ul > li:nth-of-type(13) > a"}]};
  if (P.holdOpen) {
    var sels = typeof P.holdOpen === 'string' ? [P.holdOpen] : (P.holdOpen || []);
    sels.forEach(function(sel){
      var el = document.querySelector(sel);
      if (!el) return;
      el.style.setProperty('display','block','important');
      el.style.setProperty('visibility','visible','important');
      el.style.setProperty('opacity','1','important');
    });
  }
  if (typeof window.__azazieSpecQaOverlay !== 'function') {
    console.error('azazie spec-qa overlay missing');
    return;
  }
  window.__azazieSpecQaOverlay({
    items: P.items || [],
    notes: P.notes || {},
    device: P.device || 'PC',
    holdOpen: P.holdOpen,
    legendTitle: P.legendTitle,
    module: P.module
  });
})();
