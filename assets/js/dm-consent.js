/* ============================================================
   dm-consent.js — Consent Mode v2, GA4 loader, event gateway.
   Geteilt von JEDER Seite (Startseite, einfache Seite, Impressum,
   Datenschutz, Datenschutz-Anfrage). Wird im <head> synchron geladen,
   damit der Consent-Status feststeht, bevor irgendetwas an Google geht.

   Grundregel, die die Datenschutzerklärung verspricht:
   "Bis zu Ihrer Entscheidung im Cookie-Banner werden keine Analyse-
   oder Marketing-Cookies gesetzt und keine entsprechenden Nutzungs-
   daten an Google übermittelt."
   Deshalb wird gtag.js NICHT vorab geladen. Ohne Einwilligung geht
   kein einziger Request an Google raus — auch kein cookieloser Ping.
   Ereignisse vor der Entscheidung werden lokal gepuffert und erst
   nach einem "Ja" gesendet; bei "Nein" wird der Puffer verworfen.

   Öffentliche API:
     window.dmTrack(name, params)   Ereignis senden oder puffern
     window.dmConsent.set(state, quelle)
     window.dmConsent.get()
     window.dmConsent.openBanner()
     window.dmConsent.isActive()
   ============================================================ */
(function () {
  "use strict";
  if (window.dmConsent) return;

  var MEASUREMENT_ID = "G-16ZG8GFH67";
  var KEY = "dm-dental-consent";
  var ORIGIN = window.location.origin;
  var QUEUE_MAX = 200;

  var metaTag = document.querySelector('meta[name="dm-ga-measurement-id"]');
  var id = metaTag && metaTag.content ? metaTag.content.trim() : MEASUREMENT_ID;

  /* Auf einem lokalen Testserver wird nichts gemessen. Ohne diese Sperre
     landen Testaufrufe als echte Besuche in der Auswertung — genau das ist
     am 3.8.2026 passiert. Die Seite verhält sich sonst unverändert. */
  var lokal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(window.location.hostname) ||
              window.location.protocol === "file:";
  if (lokal) id = "";

  var embedded = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }

  var loaded = false;
  var queue = [];
  var state = null; /* null = noch keine Entscheidung */

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  /* ---------- gespeicherte Entscheidung ---------- */

  function parseConsent(raw) {
    if (!raw) return null;
    if (raw === "granted") return { statistik: true, marketing: false };
    if (raw === "denied") return { statistik: false, marketing: false };
    try {
      var obj = JSON.parse(raw);
      if (obj && typeof obj.statistik === "boolean" && typeof obj.marketing === "boolean") {
        return { statistik: obj.statistik, marketing: obj.marketing };
      }
    } catch (e) {}
    return null;
  }

  function readSaved() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    return parseConsent(raw);
  }

  /* ---------- Seitenkontext, hängt an jedem Ereignis ---------- */

  function pageType() {
    var p = window.location.pathname;
    if (p === "/" || /\/index\.html$/.test(p) && p.length < 12) return "startseite";
    if (p.indexOf("/einfache-seite/datenschutz-anfrage") === 0) return "datenschutz-anfrage";
    if (p.indexOf("/einfache-seite/") === 0) return "einfache-seite";
    if (p.indexOf("/impressum") === 0) return "impressum";
    if (p.indexOf("/datenschutz") === 0) return "datenschutz";
    if (p.indexOf("/demos/") === 0) return "demo";
    return p;
  }

  /* Welche Fassung der Besucher gerade SIEHT. Auf der Startseite kann das
     wechseln, ohne dass sich die URL ändert (der Umschalter blendet ein
     <iframe> ein), deshalb wird das bei jedem Ereignis neu gelesen. */
  function variant() {
    if (window.location.pathname.indexOf("/einfache-seite/") === 0) return "einfach";
    return document.documentElement.getAttribute("data-version") === "einfach" ? "einfach" : "voll";
  }

  function context() {
    return {
      dm_seitentyp: pageType(),
      dm_fassung: variant(),
      dm_design: document.documentElement.getAttribute("data-theme") || "light",
      dm_eingebettet: embedded ? "ja" : "nein",
      dm_viewport: window.innerWidth < 760 ? "mobil" : (window.innerWidth < 1080 ? "tablet" : "desktop")
    };
  }

  /* ---------- GA4 laden (erst nach Einwilligung) ---------- */

  function loadGa() {
    if (loaded || !id) return;
    loaded = true;
    gtag("js", new Date());
    /* send_page_view: false — der page_view wird von dm-tracking.js mit
       vollem Kontext (Fassung, Design, Viewport) selbst ausgelöst. */
    gtag("config", id, { anonymize_ip: true, send_page_view: false });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    (document.head || document.documentElement).appendChild(s);
    flush();
  }

  function flush() {
    if (!loaded) return;
    for (var i = 0; i < queue.length; i++) {
      gtag("event", queue[i][0], queue[i][1]);
    }
    queue.length = 0;
  }

  function track(name, params) {
    if (!name) return;
    if (state && state.statistik === false) return; /* bewusst abgelehnt */
    var payload = context();
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null) {
          payload[k] = params[k];
        }
      }
    }
    if (!loaded) {
      if (queue.length < QUEUE_MAX) queue.push([name, payload]);
      return;
    }
    gtag("event", name, payload);
  }

  /* ---------- Entscheidung setzen + über Frames verteilen ---------- */

  function pushToGtag(next) {
    gtag("consent", "update", {
      analytics_storage: next.statistik ? "granted" : "denied",
      ad_storage: next.marketing ? "granted" : "denied",
      ad_user_data: next.marketing ? "granted" : "denied",
      ad_personalization: next.marketing ? "granted" : "denied"
    });
  }

  function broadcast(next) {
    var msg = { type: "dm-consent", state: next };
    try {
      var frames = document.querySelectorAll("iframe");
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow) frames[i].contentWindow.postMessage(msg, ORIGIN);
      }
    } catch (e) {}
    if (embedded) {
      try { window.parent.postMessage(msg, ORIGIN); } catch (e) {}
    }
  }

  function set(next, source, silent) {
    if (!next) return;
    var clean = { statistik: !!next.statistik, marketing: !!next.marketing };
    var changed = !state || state.statistik !== clean.statistik || state.marketing !== clean.marketing;
    state = clean;
    try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch (e) {}
    pushToGtag(clean);
    if (clean.statistik) {
      loadGa();
    } else {
      queue.length = 0;
    }
    if (changed && clean.statistik) {
      track("consent_update", {
        dm_consent_statistik: clean.statistik ? "ja" : "nein",
        dm_consent_marketing: clean.marketing ? "ja" : "nein",
        dm_consent_quelle: source || "banner"
      });
    }
    removeBanner();
    if (!silent) broadcast(clean);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== ORIGIN || !event.data) return;
    var data = event.data;
    if (data.type === "dm-consent" && data.state) {
      set(data.state, "frame-sync", true);
    } else if (data.type === "dm-consent-request" && event.source) {
      if (state) {
        try { event.source.postMessage({ type: "dm-consent", state: state }, ORIGIN); } catch (e) {}
      }
    }
  }, false);

  /* ---------- Ersatz-Banner für Seiten ohne eigenes ----------
     Startseite bringt ihr eigenes Banner mit (#consent-banner). Impressum,
     Datenschutz und die einfache Seite hatten bisher gar keins — ohne
     Banner kann dort niemand einwilligen, also wäre GA4 auf diesen Seiten
     dauerhaft stumm. Eingebettet (im iframe der Startseite) wird nie ein
     eigenes Banner gezeigt, sonst stünden zwei übereinander. */

  var injected = null;

  function removeBanner() {
    if (injected && injected.parentNode) {
      injected.parentNode.removeChild(injected);
      injected = null;
    }
  }

  var CSS =
    '.dmc-banner{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
    'background:#fff;color:#082a33;border-top:1px solid #dce6e4;' +
    'box-shadow:0 -8px 30px rgb(8 42 51 / 12%);' +
    'font:400 15px/1.5 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}' +
    '[data-theme="dark"] .dmc-banner{background:#0c333d;color:#eaf4f3;border-top-color:#1b4956;' +
    'box-shadow:0 -8px 30px rgb(0 0 0 / 40%)}' +
    '.dmc-inner{max-width:1080px;margin:0 auto;padding:18px 20px;display:flex;gap:18px;' +
    'align-items:center;flex-wrap:wrap;justify-content:space-between}' +
    '.dmc-copy{flex:1 1 380px;margin:0;max-width:62ch}' +
    '.dmc-copy strong{display:block;margin-bottom:4px;font-size:16px}' +
    '.dmc-copy a{color:inherit}' +
    '.dmc-actions{display:flex;gap:10px;flex-wrap:wrap}' +
    '.dmc-btn{font:inherit;font-weight:600;cursor:pointer;padding:11px 18px;' +
    'border:1px solid #082a33;background:transparent;color:inherit;border-radius:6px;min-height:44px}' +
    '[data-theme="dark"] .dmc-btn{border-color:#7fd4c8}' +
    '.dmc-btn--solid{background:#082a33;color:#fff;border-color:#082a33}' +
    '[data-theme="dark"] .dmc-btn--solid{background:#7fd4c8;color:#082a33;border-color:#7fd4c8}' +
    '.dmc-btn:focus-visible{outline:3px solid #0e6c93;outline-offset:2px}' +
    '.dmc-link{background:none;border:0;padding:0;font:inherit;color:inherit;' +
    'text-decoration:underline;cursor:pointer}' +
    '@media (max-width:640px){.dmc-inner{padding:16px}.dmc-actions{width:100%}' +
    '.dmc-btn{flex:1 1 auto}}';

  function injectBanner() {
    if (injected || embedded) return;
    if (document.getElementById("consent-banner")) return; /* Seite hat ihr eigenes */
    if (!document.body) return;

    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.className = "dmc-banner";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Hinweis zu Cookies");
    wrap.innerHTML =
      '<div class="dmc-inner">' +
      '<p class="dmc-copy"><strong>Dürfen wir messen, wie diese Seite genutzt wird?</strong>' +
      'Wir nutzen Google Analytics, um zu sehen, welche Inhalte gelesen werden. ' +
      'Ohne Ihre Zustimmung wird nichts gespeichert und nichts übertragen. ' +
      'Mehr dazu in der <a href="/datenschutz.html">Datenschutzerklärung</a>.</p>' +
      '<div class="dmc-actions">' +
      '<button type="button" class="dmc-btn" data-dmc="reject">Nur notwendige</button>' +
      '<button type="button" class="dmc-btn dmc-btn--solid" data-dmc="accept">Einverstanden</button>' +
      '</div></div>';

    wrap.addEventListener("click", function (event) {
      var btn = event.target.closest ? event.target.closest("[data-dmc]") : null;
      if (!btn) return;
      var action = btn.getAttribute("data-dmc");
      set({ statistik: action === "accept", marketing: false }, "banner-" + pageType());
    });

    document.body.appendChild(wrap);
    injected = wrap;
  }

  /* Widerruf muss auf jeder Seite möglich sein, auf der eingewilligt werden
     kann — sonst gilt die Einwilligung als nicht frei widerrufbar. Auf
     Seiten ohne eigenen Footer-Link wird ein dezenter angehängt. */
  function addFooterLink() {
    if (embedded) return;
    if (document.getElementById("cookie-settings-link")) return;
    var footer = document.querySelector("footer");
    if (!footer) return;
    var link = document.createElement("button");
    link.type = "button";
    link.className = "dmc-link";
    link.id = "dmc-settings-link";
    link.textContent = "Cookie-Einstellungen";
    link.style.cssText = "display:block;margin:14px auto 0;opacity:.75;font-size:14px";
    link.addEventListener("click", function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      state = null;
      injectBanner();
    });
    footer.appendChild(link);
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, false);
    } else {
      fn();
    }
  }

  /* ---------- Start ---------- */

  state = readSaved();
  if (state) {
    pushToGtag(state);
    if (state.statistik) loadGa();
  }

  onReady(function () {
    if (embedded && !state) {
      /* Im iframe: die Startseite kennt die Entscheidung eventuell schon,
         bevor sie im localStorage gelandet ist. */
      try { window.parent.postMessage({ type: "dm-consent-request" }, ORIGIN); } catch (e) {}
    }
    if (!state) injectBanner();
    addFooterLink();
  });

  window.dmTrack = track;
  window.dmConsent = {
    set: function (next, source) { set(next, source); },
    get: function () { return state ? { statistik: state.statistik, marketing: state.marketing } : null; },
    openBanner: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      state = null;
      injectBanner();
    },
    isActive: function () { return loaded; },
    measurementId: id
  };
})();
