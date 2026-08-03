/* ============================================================
   dm-tracking.js — Verhaltensmessung für alle Seiten.
   Läuft mit defer, nachdem dm-consent.js window.dmTrack bereitgestellt
   hat. Sendet nichts selbst an Google: jedes Ereignis geht durch
   dmTrack() und wird dort gepuffert oder verworfen, solange keine
   Einwilligung vorliegt.

   Gemessen wird:
     page_view · scroll_tiefe · abschnitt_gesehen · abschnitt_dauer
     cta_klick · ausgehender_klick · telefon_klick · email_klick
     whatsapp_klick · datei_download · sprungmarke_klick
     faq_geoeffnet · fassung_gewechselt · design_gewechselt
     formular_gesehen · formular_begonnen · formular_fehler
     formular_abgesendet · formular_abgebrochen · generate_lead*
     web_vitals · seiten_engagement · wut_klick · inhalt_kopiert
     ausstiegsabsicht · js_fehler
   (* generate_lead löst die Seite selbst aus, nicht dieses Modul.)

   Keine personenbezogenen Inhalte: Formularwerte werden nie gelesen,
   nur ob ein Feld ausgefüllt ist. Kopierter Text wird nur gezählt,
   nicht übertragen.
   ============================================================ */
(function () {
  "use strict";
  if (window.dmTrackingReady || typeof window.dmTrack !== "function") return;
  window.dmTrackingReady = true;

  var track = window.dmTrack;
  var doc = document;
  var root = doc.documentElement;

  /* ---------- Hilfsfunktionen ---------- */

  function clean(text, max) {
    if (!text) return "";
    return String(text).replace(/\s+/g, " ").trim().slice(0, max || 100);
  }

  function labelFor(el) {
    if (!el) return "";
    return clean(
      el.getAttribute("data-track") ||
      el.getAttribute("aria-label") ||
      el.textContent ||
      el.getAttribute("title") ||
      el.id ||
      el.className,
      80
    );
  }

  function slug(text) {
    return clean(text, 60)
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  /* In welchem Abschnitt sitzt das Element? Gibt der Auswertung den Ort
     eines Klicks, ohne dass jeder Button ein Attribut braucht. */
  function sectionOf(el) {
    var node = el;
    while (node && node !== doc.body) {
      if (node.tagName === "SECTION" || node.tagName === "HEADER" || node.tagName === "FOOTER") {
        return sectionName(node);
      }
      node = node.parentElement;
    }
    return "sonstiges";
  }

  function sectionName(node) {
    if (node.getAttribute("data-track-section")) return node.getAttribute("data-track-section");
    if (node.id) return node.id;
    if (node.tagName === "HEADER") return "kopfbereich";
    if (node.tagName === "FOOTER") return "fussbereich";
    var h = node.querySelector("h1, h2, h3");
    return h ? slug(h.textContent) || "abschnitt" : "abschnitt";
  }

  function isExternal(href) {
    return /^https?:\/\//i.test(href) && href.indexOf(window.location.origin) !== 0;
  }

  /* ---------- 1. Seitenaufruf ---------- */

  track("page_view", {
    page_location: window.location.href,
    page_title: clean(doc.title, 120),
    page_referrer: doc.referrer || "(direkt)",
    dm_sprache: navigator.language || "",
    dm_bildschirm: window.screen ? window.screen.width + "x" + window.screen.height : ""
  });

  /* ---------- 2. Scrolltiefe ---------- */

  var scrollMarks = [25, 50, 75, 90, 100];
  var scrollHit = {};
  var maxScroll = 0;
  var scrollFrame = 0;

  function scrollPercent() {
    var h = Math.max(1, doc.documentElement.scrollHeight - window.innerHeight);
    return Math.min(100, Math.round((window.pageYOffset / h) * 100));
  }

  function onScroll() {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(function () {
      var pct = scrollPercent();
      if (pct > maxScroll) maxScroll = pct;
      for (var i = 0; i < scrollMarks.length; i++) {
        var mark = scrollMarks[i];
        if (pct >= mark && !scrollHit[mark]) {
          scrollHit[mark] = true;
          track("scroll_tiefe", { dm_tiefe: mark, dm_sekunden: sinceStart() });
        }
      }
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- 3. Abschnitte: gesehen + Verweildauer ---------- */

  var seenSections = {};
  var sectionTimers = {};
  var sectionTotals = {};

  if ("IntersectionObserver" in window) {
    var sections = doc.querySelectorAll("section, [data-track-section]");
    if (sections.length) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var name = sectionName(entry.target);
          if (entry.isIntersecting) {
            if (!seenSections[name]) {
              seenSections[name] = true;
              track("abschnitt_gesehen", { dm_abschnitt: name, dm_sekunden: sinceStart() });
            }
            sectionTimers[name] = now();
          } else if (sectionTimers[name]) {
            sectionTotals[name] = (sectionTotals[name] || 0) + (now() - sectionTimers[name]);
            sectionTimers[name] = 0;
          }
        });
      }, { threshold: 0.5 });
      for (var s = 0; s < sections.length; s++) observer.observe(sections[s]);
    }
  }

  function flushSectionTimes() {
    for (var name in sectionTimers) {
      if (sectionTimers[name]) {
        sectionTotals[name] = (sectionTotals[name] || 0) + (now() - sectionTimers[name]);
        sectionTimers[name] = 0;
      }
    }
    for (var key in sectionTotals) {
      var secs = Math.round(sectionTotals[key] / 1000);
      if (secs >= 2) track("abschnitt_dauer", { dm_abschnitt: key, dm_sekunden: secs });
      sectionTotals[key] = 0;
    }
  }

  /* ---------- 4. Klicks ---------- */

  doc.addEventListener("click", function (event) {
    var el = event.target.closest ? event.target.closest("a, button, [role='button'], summary") : null;
    if (!el) return;
    /* Die Cookie-Auswahl selbst ist kein CTA — sie hat ihr eigenes Ereignis. */
    if (el.hasAttribute("data-consent-action") || el.hasAttribute("data-dmc")) return;

    var label = labelFor(el);
    var section = sectionOf(el);
    var base = { dm_label: label, dm_abschnitt: section };

    if (el.tagName === "A") {
      var href = el.getAttribute("href") || "";

      if (/^tel:/i.test(href)) {
        track("telefon_klick", base);
      } else if (/^mailto:/i.test(href)) {
        track("email_klick", base);
      } else if (/wa\.me|whatsapp/i.test(href)) {
        track("whatsapp_klick", base);
      } else if (/\.(pdf|docx?|xlsx?|zip|csv|pptx?)($|\?)/i.test(href)) {
        track("datei_download", { dm_label: label, dm_abschnitt: section, dm_datei: clean(href, 100) });
      } else if (isExternal(href)) {
        track("ausgehender_klick", {
          dm_label: label,
          dm_abschnitt: section,
          dm_ziel: clean(href, 100),
          dm_domain: hostOf(href)
        });
      } else if (href.charAt(0) === "#") {
        track("sprungmarke_klick", { dm_label: label, dm_abschnitt: section, dm_ziel: clean(href, 60) });
      } else {
        track("cta_klick", { dm_label: label, dm_abschnitt: section, dm_ziel: clean(href, 100), dm_art: "link" });
      }
      return;
    }

    if (el.tagName === "SUMMARY") return; /* wird als faq_geoeffnet gezählt */

    track("cta_klick", { dm_label: label, dm_abschnitt: section, dm_art: "button" });
  }, true);

  function hostOf(href) {
    try { return new URL(href, window.location.href).hostname; } catch (e) { return ""; }
  }

  /* ---------- 5. FAQ ---------- */

  /* Einfache Seite: native <details>. Startseite: eigenes Akkordeon mit
     aria-expanded. Beide Wege landen auf demselben Ereignis. */
  var details = doc.querySelectorAll("details");
  for (var d = 0; d < details.length; d++) {
    details[d].addEventListener("toggle", function () {
      if (!this.open) return;
      var summary = this.querySelector("summary");
      track("faq_geoeffnet", {
        dm_frage: clean(summary ? summary.textContent : this.textContent, 90),
        dm_abschnitt: sectionOf(this)
      });
    }, false);
  }

  doc.addEventListener("click", function (event) {
    var btn = event.target.closest ? event.target.closest("[aria-expanded]") : null;
    if (!btn || btn.tagName === "SUMMARY") return;
    if (btn.hasAttribute("data-consent-action")) return;
    /* Zustand nach dem Klick auslesen, deshalb ans Ende der Warteschlange. */
    setTimeout(function () {
      if (btn.getAttribute("aria-expanded") !== "true") return;
      track("faq_geoeffnet", { dm_frage: labelFor(btn), dm_abschnitt: sectionOf(btn) });
    }, 0);
  }, false);

  /* ---------- 6. Fassung und Design ---------- */

  if ("MutationObserver" in window) {
    var lastVersion = root.getAttribute("data-version");
    var lastTheme = root.getAttribute("data-theme");
    new MutationObserver(function () {
      var v = root.getAttribute("data-version");
      var t = root.getAttribute("data-theme");
      if (v !== lastVersion) {
        lastVersion = v;
        track("fassung_gewechselt", { dm_ziel_fassung: v === "einfach" ? "einfach" : "voll", dm_sekunden: sinceStart() });
      }
      if (t !== lastTheme) {
        lastTheme = t;
        track("design_gewechselt", { dm_ziel_design: t, dm_sekunden: sinceStart() });
      }
    }).observe(root, { attributes: true, attributeFilter: ["data-version", "data-theme"] });
  }

  /* ---------- 7. Formular-Trichter ---------- */

  var forms = doc.querySelectorAll("form");

  function formId(form, index) {
    return form.id || form.getAttribute("name") || ("formular_" + (index + 1));
  }

  function filledCount(form) {
    var fields = form.querySelectorAll("input, textarea, select");
    var n = 0;
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.type === "hidden" || f.type === "submit" || f.type === "button") continue;
      if (f.type === "checkbox" || f.type === "radio") { if (f.checked) n++; }
      else if (f.value && f.value.trim()) n++;   /* nur ob, nie was */
    }
    return n;
  }

  var formState = [];

  for (var fi = 0; fi < forms.length; fi++) {
    (function (form, index) {
      var id = formId(form, index);
      var st = { id: id, started: false, submitted: false, lastField: "", form: form };
      formState.push(st);

      form.addEventListener("focusin", function (event) {
        var name = event.target.getAttribute ? (event.target.getAttribute("name") || event.target.id || "") : "";
        if (name) st.lastField = clean(name, 40);
        if (st.started) return;
        st.started = true;
        track("formular_begonnen", { dm_formular: id, dm_abschnitt: sectionOf(form), dm_sekunden: sinceStart() });
      }, false);

      form.addEventListener("submit", function () {
        st.submitted = true;
        track("formular_abgesendet", {
          dm_formular: id,
          dm_abschnitt: sectionOf(form),
          dm_felder_ausgefuellt: filledCount(form),
          dm_sekunden: sinceStart()
        });
      }, true);

      /* Native Validierung, falls das Formular sie nutzt. */
      form.addEventListener("invalid", function (event) {
        var name = event.target.getAttribute ? (event.target.getAttribute("name") || event.target.id || "") : "";
        track("formular_fehler", { dm_formular: id, dm_feld: clean(name, 40), dm_quelle: "browser" });
      }, true);

      if ("IntersectionObserver" in window) {
        var seen = false;
        new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting || seen) return;
            seen = true;
            track("formular_gesehen", { dm_formular: id, dm_abschnitt: sectionOf(form), dm_sekunden: sinceStart() });
          });
        }, { threshold: 0.4 }).observe(form);
      }
    })(forms[fi], fi);
  }

  /* Die Startseite validiert selbst und blendet dabei eine Fehlerbox ein.
     Deren Sichtbarkeit ist das einzige verlässliche Signal dafür. */
  var errorBox = doc.getElementById("form-error");
  if (errorBox && "MutationObserver" in window) {
    new MutationObserver(function () {
      if (errorBox.hidden) return;
      track("formular_fehler", {
        dm_formular: "lead-form",
        dm_meldung: clean(errorBox.textContent, 90),
        dm_quelle: "seite"
      });
    }).observe(errorBox, { attributes: true, attributeFilter: ["hidden"] });
  }

  function flushFormAbandons() {
    for (var i = 0; i < formState.length; i++) {
      var st = formState[i];
      if (!st.started || st.submitted) continue;
      st.started = false; /* nur einmal melden */
      track("formular_abgebrochen", {
        dm_formular: st.id,
        dm_felder_ausgefuellt: filledCount(st.form),
        dm_letztes_feld: st.lastField,
        dm_sekunden: sinceStart()
      });
    }
  }

  /* ---------- 8. Web Vitals ---------- */

  var vitals = {};

  function rate(name, value) {
    var limits = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800] };
    var l = limits[name];
    if (!l) return "";
    return value <= l[0] ? "gut" : (value <= l[1] ? "verbesserungswuerdig" : "schlecht");
  }

  function observe(type, handler, extra) {
    if (!("PerformanceObserver" in window)) return;
    try {
      var options = { type: type, buffered: true };
      if (extra) for (var k in extra) options[k] = extra[k];
      new PerformanceObserver(handler).observe(options);
    } catch (e) {}
  }

  observe("largest-contentful-paint", function (list) {
    var entries = list.getEntries();
    var last = entries[entries.length - 1];
    if (last) vitals.LCP = Math.round(last.startTime);
  });

  observe("paint", function (list) {
    list.getEntries().forEach(function (entry) {
      if (entry.name === "first-contentful-paint") vitals.FCP = Math.round(entry.startTime);
    });
  });

  var clsValue = 0;
  observe("layout-shift", function (list) {
    list.getEntries().forEach(function (entry) {
      if (!entry.hadRecentInput) clsValue += entry.value;
    });
    vitals.CLS = Math.round(clsValue * 1000) / 1000;
  });

  var inpMax = 0;
  observe("event", function (list) {
    list.getEntries().forEach(function (entry) {
      if (entry.duration > inpMax) inpMax = entry.duration;
    });
    vitals.INP = Math.round(inpMax);
  }, { durationThreshold: 40 });

  try {
    var nav = performance.getEntriesByType("navigation")[0];
    if (nav) vitals.TTFB = Math.round(nav.responseStart);
  } catch (e) {}

  var vitalsSent = false;
  function flushVitals() {
    if (vitalsSent) return;
    vitalsSent = true;
    for (var name in vitals) {
      if (vitals[name] === undefined) continue;
      track("web_vitals", {
        dm_messwert: name,
        dm_wert: vitals[name],
        dm_bewertung: rate(name, vitals[name])
      });
    }
  }

  /* ---------- 9. Engagement ---------- */

  var startedAt = now();
  var activeMs = 0;
  var lastResume = now();
  var visible = doc.visibilityState !== "hidden";

  function now() { return (window.performance && performance.now) ? performance.now() : +new Date(); }
  function sinceStart() { return Math.round((now() - startedAt) / 1000); }

  function activeSeconds() {
    var total = activeMs + (visible ? now() - lastResume : 0);
    return Math.round(total / 1000);
  }

  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "hidden") {
      if (visible) { activeMs += now() - lastResume; visible = false; }
      flushAll();
    } else {
      visible = true;
      lastResume = now();
    }
  }, false);

  var engagementSent = false;
  function flushEngagement() {
    if (engagementSent) return;
    engagementSent = true;
    track("seiten_engagement", {
      dm_aktive_sekunden: activeSeconds(),
      dm_max_scroll: maxScroll,
      dm_abschnitte_gesehen: Object.keys(seenSections).length
    });
  }

  function flushAll() {
    flushSectionTimes();
    flushFormAbandons();
    flushVitals();
    flushEngagement();
  }

  window.addEventListener("pagehide", flushAll, false);

  /* ---------- 10. Reibungssignale ---------- */

  var clicks = [];
  doc.addEventListener("click", function (event) {
    var t = now();
    clicks.push({ t: t, x: event.clientX, y: event.clientY, target: event.target });
    clicks = clicks.filter(function (c) { return t - c.t < 1000; });
    if (clicks.length < 3) return;
    var first = clicks[0];
    var near = clicks.every(function (c) {
      return Math.abs(c.x - first.x) < 30 && Math.abs(c.y - first.y) < 30;
    });
    if (!near) return;
    clicks = [];
    var el = event.target.closest ? event.target.closest("a, button, input, textarea, select, summary, [role='button']") : null;
    track("wut_klick", {
      dm_label: labelFor(event.target),
      dm_abschnitt: sectionOf(event.target),
      dm_interaktiv: el ? "ja" : "nein"
    });
  }, true);

  doc.addEventListener("copy", function () {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel) return;
    var node = sel.anchorNode;
    var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    /* Nur die Länge, nie der Inhalt — kopiert wird meist Telefon oder E-Mail. */
    track("inhalt_kopiert", {
      dm_zeichen: String(sel).length,
      dm_abschnitt: el ? sectionOf(el) : "unbekannt"
    });
  }, false);

  var exitSent = false;
  doc.addEventListener("mouseout", function (event) {
    if (exitSent || event.relatedTarget || event.clientY > 8) return;
    exitSent = true;
    track("ausstiegsabsicht", { dm_max_scroll: maxScroll, dm_sekunden: sinceStart() });
  }, false);

  /* ---------- 11. Fehler ---------- */

  var errorsSent = 0;
  window.addEventListener("error", function (event) {
    if (errorsSent >= 5) return;
    errorsSent++;
    track("js_fehler", {
      dm_meldung: clean(event.message, 100),
      dm_datei: clean(event.filename, 80),
      dm_zeile: event.lineno || 0
    });
  }, false);

  window.addEventListener("unhandledrejection", function (event) {
    if (errorsSent >= 5) return;
    errorsSent++;
    track("js_fehler", { dm_meldung: clean(event.reason && event.reason.message, 100), dm_datei: "promise" });
  }, false);
})();
