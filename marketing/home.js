/* Handoff homepage behavior. Vanilla, no build step.
   Scroll reveals, cloud parallax, sticky step highlight. */
(function () {
  "use strict";

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  document.querySelectorAll('a[href="#contact-privacy"]').forEach(function (a) {
    a.addEventListener("click", function () {
      var target = document.getElementById("contact-privacy");
      if (target) target.open = true;
    });
  });

  /* Reduced motion, show everything and stop here. */
  if (reduceMotion || !("IntersectionObserver" in window)) {
    document.documentElement.classList.add("no-motion");
    document.querySelectorAll(".reveal, .stagger").forEach(function (el) {
      el.classList.add("is-in");
    });
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
    { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
  );
  document.querySelectorAll(".reveal, .stagger").forEach(function (el) {
    revealObserver.observe(el);
  });

  /* Sticky step highlight, the rail follows the step in view. */
  var steps = Array.prototype.slice.call(document.querySelectorAll(".step"));
  var railLinks = Array.prototype.slice.call(
    document.querySelectorAll("[data-rail]"),
  );
  if (steps.length && railLinks.length) {
    var setCurrent = function (id) {
      steps.forEach(function (step) {
        step.classList.toggle("is-current", step.id === id);
      });
      railLinks.forEach(function (link) {
        link.classList.toggle("is-current", link.dataset.rail === id);
      });
    };
    var stepObserver = new IntersectionObserver(
      function (entries) {
        var best = null;
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            if (!best || entry.intersectionRatio > best.intersectionRatio) {
              best = entry;
            }
          }
        });
        if (best) setCurrent(best.target.id);
      },
      {
        rootMargin: "-25% 0px -35% 0px",
        threshold: [0.2, 0.5, 0.8],
      },
    );
    steps.forEach(function (step) {
      stepObserver.observe(step);
    });
    setCurrent(steps[0].id);
  }

  /* Gentle cloud parallax and the header shadow, one rAF loop. */
  var clouds = Array.prototype.slice.call(
    document.querySelectorAll("[data-parallax]"),
  );
  var header = document.querySelector(".site-header");
  var ticking = false;

  var frame = function () {
    ticking = false;
    var viewH = window.innerHeight || 1;
    clouds.forEach(function (cloud) {
      var rect = cloud.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > viewH + 200) return;
      var factor = parseFloat(cloud.dataset.parallax) || 0.08;
      var progress = rect.top + rect.height / 2 - viewH / 2;
      cloud.style.setProperty("--py", (-progress * factor).toFixed(1) + "px");
    });
    if (header) {
      header.classList.toggle("is-stuck", window.scrollY > 8);
    }
  };

  var onScroll = function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(frame);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  frame();
})();
