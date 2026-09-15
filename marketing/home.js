/* Handoff homepage behavior. Vanilla, no build step.
   Scroll reveals, cloud parallax, the flat app frame settling, the FAQ
   accordion, and the savings counter. */
(function () {
  "use strict";

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Signed in on the app? Show the student in the header instead of sign in.
  // The app answers with CORS for this origin and the same site cookie.
  (function showSession() {
    var host = document.querySelector("[data-session]");
    if (!host || !window.fetch) return;
    fetch("https://app.handofflease.com/api/session", {
      credentials: "include",
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        var user = data && data.user;
        if (!user) return;
        var initials = String(user.name || "")
          .split(" ")
          .map(function (n) {
            return n[0];
          })
          .slice(0, 2)
          .join("")
          .toUpperCase();
        host.querySelector("[data-avatar]").textContent = initials || "•";
        host.querySelector("[data-name]").textContent =
          String(user.name || "").split(" ")[0] || "You";
        host.querySelector("[data-guest]").hidden = true;
        host.querySelector("[data-member]").hidden = false;
        host.classList.add("is-signed-in");
        document
          .querySelectorAll('a[href$="/sign-in"], a[href$="/sign-up"]')
          .forEach(function (a) {
            if (!a.closest("[data-session]"))
              a.setAttribute("href", "https://app.handofflease.com/browse");
          });
      })
      .catch(function () {});
  })();

  /* The FAQ accordion. The height is a grid track, 0fr to 1fr, so nothing is
     measured; CSS owns the motion and this owns the state. */
  var setOpen = function (item, open) {
    if (!item) return;
    item.setAttribute("data-open", open ? "true" : "false");
    var head = item.querySelector(".faq-head");
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
  };
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var head = item.querySelector(".faq-head");
    if (!head) return;
    head.addEventListener("click", function () {
      setOpen(item, item.getAttribute("data-open") !== "true");
    });
  });

  /* Deep link from the footer opens the contact sharing answer. */
  document.querySelectorAll('a[href="#contact-privacy"]').forEach(function (a) {
    a.addEventListener("click", function () {
      setOpen(document.getElementById("contact-privacy"), true);
    });
  });

  // Does the browser drive animations from scroll on its own?
  var hasScrollDriven =
    window.CSS &&
    CSS.supports &&
    CSS.supports("animation-timeline", "view()") &&
    CSS.supports("animation-timeline", "scroll()");
  if (!hasScrollDriven) document.documentElement.classList.add("no-sda");

  if (reduceMotion) {
    document
      .querySelectorAll(".reveal, .stagger, [data-shot], [data-savings-card]")
      .forEach(function (el) {
        el.classList.add("is-in");
      });
    var staticCount = document.querySelector("[data-count]");
    if (staticCount) staticCount.textContent = "$1,200";
    var staticCard = document.querySelector("[data-savings-card]");
    if (staticCard) staticCard.classList.add("is-counting");
    return;
  }

  /* Scroll reveal, rise plus fade plus a small blur. */
  var revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
  );
  document
    .querySelectorAll(".reveal, .stagger, [data-shot]")
    .forEach(function (el) {
      revealObserver.observe(el);
    });

  /* The savings card. The price counts down, then the tag pops. */
  (function savingsCard() {
    var card = document.querySelector("[data-savings-card]");
    var digits = card && card.querySelector("[data-count]");
    if (!card || !digits) return;
    var from = Number(digits.dataset.from) || 0;
    var to = Number(digits.dataset.to) || 0;
    var money = function (n) {
      return "$" + Math.round(n).toLocaleString("en-US");
    };
    var run = function () {
      var started = 0;
      var dur = 900;
      var tick = function (now) {
        if (!started) started = now;
        var t = Math.min(1, (now - started) / dur);
        var eased = 1 - Math.pow(1 - t, 3);
        digits.textContent = money(from + (to - from) * eased);
        if (t < 1) window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    };
    var cardObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          card.classList.add("is-counting");
          run();
          cardObserver.disconnect();
        });
      },
      { threshold: 0.4 },
    );
    cardObserver.observe(card);
  })();

  /* One rAF loop. Cloud parallax, the header shadow, and, where the browser
     has no scroll driven animations, the app frame settling and the cluster
     split. The frame only ever translates. Nothing on this page tilts. */
  var clouds = Array.prototype.slice.call(
    document.querySelectorAll("[data-parallax]"),
  );
  var header = document.querySelector(".site-header");
  var riseEl = document.querySelector("[data-rise]");
  var shotEl = document.querySelector("[data-shot]");
  var ticking = false;

  /* Supporting the syntax is not the same as the timeline going live, so ask
     the running animation. A null currentTime means it never attached, and the
     rAF loop below takes the work instead. */
  var scrollTimelineLive = function (el) {
    if (!hasScrollDriven || !el || !el.getAnimations) return false;
    var list = el.getAnimations();
    for (var i = 0; i < list.length; i++) {
      if (list[i].timeline && list[i].currentTime !== null) return true;
    }
    return false;
  };
  var checkTimelines = function () {
    if (scrollTimelineLive(riseEl)) riseEl = null;
    if (scrollTimelineLive(shotEl)) shotEl = null;
    if (riseEl || shotEl) document.documentElement.classList.add("no-sda");
    frame();
  };

  var frame = function () {
    ticking = false;
    var viewH = window.innerHeight || 1;
    clouds.forEach(function (cloud) {
      var rect = cloud.getBoundingClientRect();
      if (rect.bottom < -300 || rect.top > viewH + 300) return;
      var factor = parseFloat(cloud.dataset.parallax) || 0.2;
      var progress = rect.top + rect.height / 2 - viewH / 2;
      cloud.style.setProperty("--py", (-progress * factor).toFixed(1) + "px");
    });
    if (riseEl) {
      var t = Math.min(1, Math.max(0, window.scrollY / 340));
      riseEl.style.setProperty("--rise", (1 - t).toFixed(3));
    }
    if (shotEl) {
      /* The cluster split runs on this, forward and back. */
      var p = Math.min(1, Math.max(0, (window.scrollY - 120) / 520));
      shotEl.style.setProperty("--p", p.toFixed(3));
    }
    if (header) header.classList.toggle("is-stuck", window.scrollY > 8);
  };

  var onScroll = function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(frame);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  frame();
  window.setTimeout(checkTimelines, 120);
})();
