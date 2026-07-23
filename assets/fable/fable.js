/* ============================================================
   FABLE · behaviour
   1. Header surface after scroll
   2. Hero video: source per breakpoint, poster-first,
      reduced-motion + failure fallback
   3. Scroll reveal (IntersectionObserver, once)
   4. Floating CTA visibility window (hero end → contact hub)
   5. Contact form validation and production submission
   ============================================================ */

(function () {
  'use strict';

  document.documentElement.classList.remove('no-js');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mobileMedia = window.matchMedia('(max-width: 759px)');

  /* ---- 1. Header ---- */
  var header = document.querySelector('.site-header');
  var onScrollHeader = function () {
    header.classList.toggle('is-scrolled', window.scrollY > 24);
  };
  window.addEventListener('scroll', onScrollHeader, { passive: true });
  onScrollHeader();

  /* ---- 2. Hero video ---- */
  var heroMedia = document.querySelector('.hero-media');
  var video = heroMedia ? heroMedia.querySelector('video') : null;

  var applySource = function () {
    var src = mobileMedia.matches
      ? video.getAttribute('data-src-mobile')
      : video.getAttribute('data-src-desktop');
    if (video.getAttribute('src') === src) return;
    video.setAttribute('src', src);
    video.load();
    var p = video.play();
    if (p && p.catch) {
      p.catch(function () {
        heroMedia.classList.remove('is-playing');
      });
    }
  };

  var initVideo = function () {
    if (!video || reducedMotion.matches) return;
    video.muted = true;
    video.loop = true;
    video.setAttribute('playsinline', '');
    video.addEventListener('playing', function () {
      heroMedia.classList.add('is-playing');
    });
    video.addEventListener('error', function () {
      heroMedia.classList.remove('is-playing');
    });
    applySource();
    mobileMedia.addEventListener('change', applySource);
  };

  initVideo();

  reducedMotion.addEventListener('change', function () {
    if (reducedMotion.matches && video) {
      video.pause();
      heroMedia.classList.remove('is-playing');
    } else {
      initVideo();
    }
  });

  /* ---- 3. Scroll reveal ---- */
  var revealables = [].slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    );
    revealables.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealables.forEach(function (el) {
      el.classList.add('in');
    });
  }

  /* ---- 4. Floating CTA: visible between hero end and contact hub ---- */
  var floating = document.querySelector('.floating-cta');
  var hero = document.querySelector('.hero');
  var personSection = document.querySelector('.section--person');
  var contactHub = document.getElementById('kontakt');

  var pastHero = false;
  var personVisible = false;
  var hubVisible = false;

  var updateFloating = function () {
    floating.classList.toggle('is-active', pastHero && !personVisible && !hubVisible);
  };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      function (entries) {
        pastHero = entries[0].boundingClientRect.bottom < 0;
        updateFloating();
      },
      { threshold: 0 }
    ).observe(hero);

    new IntersectionObserver(
      function (entries) {
        personVisible = entries[0].isIntersecting;
        updateFloating();
      },
      { threshold: 0 }
    ).observe(personSection);

    new IntersectionObserver(
      function (entries) {
        hubVisible = entries[0].isIntersecting;
        updateFloating();
      },
      { threshold: 0 }
    ).observe(contactHub);
  }

  /* ---- 5. Contact form validation and production submission ---- */
  var form = document.getElementById('kontakt-form');
  if (form) {
    var summary = document.getElementById('form-summary');
    var successBox = document.getElementById('form-success');
    var errorBox = document.getElementById('form-error');
    var submitBtn = form.querySelector('.form-submit');
    var submitLabel = submitBtn.textContent;

    var validators = [
      { name: 'name', test: function (v) { return v.trim().length > 1; }, msg: 'Bitte geben Sie Ihren Namen an.' },
      { name: 'praxis', test: function (v) { return v.trim().length > 1; }, msg: 'Bitte nennen Sie Ihre Praxis oder Ihre Website.' },
      { name: 'telefon', test: function (v) { return /^[+0-9][0-9 ()/-]{5,}$/.test(v.trim()); }, msg: 'Bitte geben Sie eine Telefonnummer an.' },
    ];

    var setFieldError = function (name, hasError) {
      var field = form.querySelector('[data-field="' + name + '"]');
      field.classList.toggle('has-error', hasError);
      var input = field.querySelector('input, textarea');
      input.setAttribute('aria-invalid', hasError ? 'true' : 'false');
      var errorEl = field.querySelector('.field-error');
      if (errorEl) {
        if (hasError) {
          input.setAttribute('aria-describedby', errorEl.id);
        } else {
          input.removeAttribute('aria-describedby');
        }
      }
    };

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      successBox.classList.remove('is-visible');
      errorBox.classList.remove('is-visible');

      var errors = [];
      validators.forEach(function (v) {
        var ok = v.test(form.elements[v.name].value);
        setFieldError(v.name, !ok);
        if (!ok) errors.push(v.msg);
      });
      var consentOk = form.elements.consent.checked;
      form.querySelector('[data-field="consent"]').classList.toggle('has-error', !consentOk);
      if (!consentOk) errors.push('Bitte stimmen Sie der Kontaktaufnahme zu.');

      if (errors.length) {
        summary.textContent = errors.length === 1
          ? errors[0]
          : 'Bitte prüfen Sie ' + errors.length + ' Felder: ' + errors.join(' ');
        summary.classList.add('is-visible');
        summary.focus && summary.setAttribute('tabindex', '-1');
        summary.focus();
        return;
      }

      summary.classList.remove('is-visible');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Wird gesendet …';

      try {
        var response = await fetch('https://formsubmit.co/ajax/hello@xn--digitalezahnrzte-6nb.de', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new FormData(form)
        });
        var result = await response.json();
        if (!response.ok || !(result.success === true || result.success === 'true')) {
          throw new Error('Formularversand fehlgeschlagen');
        }
        successBox.classList.add('is-visible');
        successBox.focus();
        form.reset();
      } catch (error) {
        errorBox.classList.add('is-visible');
        errorBox.focus();
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      }
    });
  }
})();
