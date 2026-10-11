/* Handoff homepage behavior. Vanilla, no build step.
   Scroll reveals, cloud parallax, the pill header, the hero replica's live
   cycle, the savings counters, the step rail, the three step demos (import,
   map, request), the campus search demo, the phone carousel, the FAQ. */
(function () {
  "use strict";

  /* ?static renders every state at rest, for full page screenshots. */
  var reduceMotion =
    (window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    /(^|[?&])static(=|&|$)/.test(window.location.search);
  if (/(^|[?&])static(=|&|$)/.test(window.location.search))
    document.documentElement.classList.add("is-static");
  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  var money = function (n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  };

  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* Signed in on the app? Show the student in the header instead of sign in. */
  (function showSession() {
    var host = $("[data-session]");
    if (!host || !window.fetch) return;
    fetch("https://app.handofflease.com/api/session", { credentials: "include" })
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
        $("[data-avatar]", host).textContent = initials || "•";
        $("[data-name]", host).textContent =
          String(user.name || "").split(" ")[0] || "You";
        $("[data-guest]", host).hidden = true;
        $("[data-member]", host).hidden = false;
        $$('a[href$="/sign-in"], a[href$="/sign-up"]').forEach(function (a) {
          if (!a.closest("[data-session]"))
            a.setAttribute("href", "https://app.handofflease.com/browse");
        });
      })
      .catch(function () {});
  })();

  /* The marquee needs its track twice for a seamless loop. */
  $$("[data-marquee] .marquee-track").forEach(function (track) {
    track.innerHTML += track.innerHTML;
  });

  /* FAQ accordion. The height is a grid track, CSS owns the motion. */
  var setOpen = function (item, open) {
    if (!item) return;
    item.setAttribute("data-open", open ? "true" : "false");
    var head = $(".faq-head", item);
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
  };
  $$(".faq-item").forEach(function (item) {
    var head = $(".faq-head", item);
    if (!head) return;
    head.addEventListener("click", function () {
      setOpen(item, item.getAttribute("data-open") !== "true");
    });
  });
  $$('a[href="#contact-privacy"]').forEach(function (a) {
    a.addEventListener("click", function () {
      setOpen(document.getElementById("contact-privacy"), true);
    });
  });

  var hasScrollDriven =
    window.CSS &&
    CSS.supports &&
    CSS.supports("animation-timeline", "view()") &&
    CSS.supports("animation-timeline", "scroll()");
  if (!hasScrollDriven) document.documentElement.classList.add("no-sda");

  /* A small helper: run a callback once when an element enters the viewport. */
  var onEnter = function (el, cb, threshold) {
    if (!el) return;
    if (reduceMotion) {
      cb();
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          cb();
          io.disconnect();
        });
      },
      { threshold: threshold || 0.35 },
    );
    io.observe(el);
  };

  /* Type text into a node, character by character. Returns a promise. */
  var typeInto = function (node, text, speed) {
    return new Promise(function (resolve) {
      if (!node) return resolve();
      node.textContent = "";
      if (reduceMotion) {
        node.textContent = text;
        return resolve();
      }
      var i = 0;
      var tick = function () {
        node.textContent = text.slice(0, i);
        i += 1;
        if (i <= text.length) window.setTimeout(tick, speed || 28);
        else resolve();
      };
      tick();
    });
  };
  var wait = function (ms) {
    return new Promise(function (r) {
      window.setTimeout(r, reduceMotion ? 0 : ms);
    });
  };
  var countTo = function (node, from, to, dur, format) {
    if (!node) return;
    if (reduceMotion) {
      node.textContent = format(to);
      return;
    }
    var started = 0;
    var tick = function (now) {
      if (!started) started = now;
      var t = Math.min(1, (now - started) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(from + (to - from) * eased);
      if (t < 1) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  };

  if (reduceMotion) {
    $$(".reveal, .stagger, [data-shot], [data-savings-card]").forEach(function (el) {
      el.classList.add("is-in");
    });
    var staticCount = $("[data-count]");
    if (staticCount) staticCount.textContent = "$1,200";
    var staticTotal = $("[data-count-total]");
    if (staticTotal) staticTotal.textContent = "$3,600";
    var staticCard = $("[data-savings-card]");
    if (staticCard) staticCard.classList.add("is-counting");
    $$("[data-i-field]").forEach(function (f) {
      f.classList.add("is-in");
    });
    var tt = $("[data-type-target]");
    if (tt)
      tt.textContent =
        "Subletting my private room near campus, $1,200 a month, available May 15. 1234 West 30th Street.";
    var rqType = $("[data-rq-type]");
    if (rqType) rqType.textContent = "Hi Maya, I am at USC through August and would love to take over the room.";
    $$("[data-rq-state], [data-rq-emails]").forEach(function (el) {
      el.classList.add("is-on");
    });
    $$("[data-rq-blur]").forEach(function (el) {
      el.classList.add("is-clear");
    });
    var campusType = $("[data-campus-type]");
    if (campusType) campusType.textContent = "University of S";
    var results = $("[data-campus-results]");
    if (results) results.classList.add("is-on");
    var demo = $("[data-campus-demo]");
    if (demo) demo.classList.add("is-typing");
    var preview = $("[data-map-preview]");
    if (preview) preview.classList.add("is-on");
    return;
  }

  /* Scroll reveal. */
  var revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
  );
  $$(".reveal, .stagger, [data-shot]").forEach(function (el) {
    revealObserver.observe(el);
  });

  /* =========================================================
     Hero replica: a live cycle through the cards. The active card,
     its pin, and the preview card on the map move together.
     ========================================================= */
  (function heroCycle() {
    var shot = $("[data-shot]");
    var list = $("[data-cycle-list]");
    var preview = $("[data-map-preview]");
    if (!shot || !list || !preview) return;
    var cards = $$("[data-card]", list);
    var pins = $$("[data-map-pin]", shot);
    var pinFor = function (id) {
      return pins.filter(function (p) {
        return p.getAttribute("data-map-pin") === id;
      })[0];
    };
    var photos = { 1: "beige", 2: "sage", 3: "terracotta", 4: "beige" };
    var mpPhoto = $(".mp-photo", preview);
    var mpPrice = $("[data-mp-price]", preview);
    var mpTitle = $("[data-mp-title]", preview);
    var mpMeta = $("[data-mp-meta]", preview);
    var index = 0;
    var apply = function (i) {
      var card = cards[i];
      var id = card.getAttribute("data-card");
      cards.forEach(function (c) {
        c.classList.toggle("is-active", c === card);
      });
      pins.forEach(function (p) {
        p.classList.toggle("is-active", p.getAttribute("data-map-pin") === id);
      });
      var pin = pinFor(id);
      if (pin) {
        var host = pin.parentElement;
        preview.style.left = host.style.left || getComputedStyle(host).left;
        preview.style.top = host.style.top || getComputedStyle(host).top;
      }
      mpPhoto.className = "mp-photo " + (photos[id] || "beige");
      mpPrice.innerHTML =
        $(".card-price strong", card).textContent + " <small>/mo</small>";
      mpTitle.textContent = $(".card-title", card).textContent.split(",")[0];
      mpMeta.textContent = $(".card-distance", card).textContent;
      preview.classList.add("is-on");
    };
    var timer = null;
    var start = function () {
      shot.classList.add("is-cycling");
      apply(0);
      timer = window.setInterval(function () {
        index = (index + 1) % cards.length;
        apply(index);
      }, 3600);
    };
    onEnter(shot, function () {
      window.setTimeout(start, 1400);
    }, 0.3);
    /* Hovering a card takes over. */
    cards.forEach(function (card, i) {
      card.addEventListener("mouseenter", function () {
        if (timer) window.clearInterval(timer);
        index = i;
        apply(i);
      });
      card.addEventListener("mouseleave", function () {
        if (timer) window.clearInterval(timer);
        timer = window.setInterval(function () {
          index = (index + 1) % cards.length;
          apply(index);
        }, 3600);
      });
    });
    /* Stop the cycle when the hero is off screen. */
    var vis = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) return;
        if (timer) window.clearInterval(timer);
        timer = null;
      });
    });
    vis.observe(shot);
    var back = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || timer || !shot.classList.contains("is-cycling")) return;
        timer = window.setInterval(function () {
          index = (index + 1) % cards.length;
          apply(index);
        }, 3600);
      });
    });
    back.observe(shot);
  })();

  /* The floating walk and drive card flips every few seconds. */
  (function walkToggle() {
    var toggles = $$("[data-walk-toggle]");
    toggles.forEach(function (t) {
      var opts = $$(":scope > *", t);
      var value = t.parentElement && $("[data-walk-value]", t.parentElement);
      var on = 0;
      window.setInterval(function () {
        on = (on + 1) % opts.length;
        opts.forEach(function (o, i) {
          o.classList.toggle("is-on", i === on);
        });
        if (value) value.textContent = on ? "4 min" : "8 min";
      }, 2800);
    });
  })();

  /* =========================================================
     Both sides win: the price counts down, the tag pops, the months
     stop, and the covered total counts up.
     ========================================================= */
  (function savings() {
    var grid = $("[data-savings-card]");
    if (!grid) return;
    var price = $("[data-count]", grid);
    var total = $("[data-count-total]", grid);
    onEnter(
      grid,
      function () {
        grid.classList.add("is-counting");
        if (price)
          countTo(price, Number(price.dataset.from), Number(price.dataset.to), 900, money);
        if (total)
          window.setTimeout(function () {
            countTo(total, Number(total.dataset.from), Number(total.dataset.to), 1100, money);
          }, 350);
      },
      0.4,
    );
  })();

  /* =========================================================
     How it works: the rail follows the frames.
     ========================================================= */
  (function rail() {
    var steps = $$("[data-rail-step]");
    var frames = $$("[data-step-frame]");
    var fill = $("[data-rail-fill]");
    if (!steps.length || !frames.length) return;
    var setActive = function (n) {
      steps.forEach(function (s) {
        s.classList.toggle("is-active", s.getAttribute("data-rail-step") === String(n));
      });
      if (fill) fill.style.setProperty("--fill", String((n - 1) / (steps.length - 1)));
    };
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          setActive(Number(entry.target.getAttribute("data-step-frame")));
        });
      },
      { rootMargin: "-40% 0px -45% 0px", threshold: 0 },
    );
    frames.forEach(function (f) {
      io.observe(f);
    });
    steps.forEach(function (s) {
      s.addEventListener("click", function () {
        var n = s.getAttribute("data-rail-step");
        var frame = frames.filter(function (f) {
          return f.getAttribute("data-step-frame") === n;
        })[0];
        if (frame) frame.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  })();

  /* 01 Smart import: the post types itself, the fields fill in, the gap glows. */
  (function importDemo() {
    var demo = $("[data-import-demo]");
    if (!demo) return;
    var target = $("[data-type-target]", demo);
    var status = $("[data-import-status]", demo);
    var fields = $$("[data-i-field]", demo);
    var text =
      "Subletting my private room near campus, $1,200 a month, available May 15. 1234 West 30th Street, message me!";
    var run = function () {
      fields.forEach(function (f) {
        f.classList.remove("is-in");
      });
      status.classList.remove("is-on", "is-done");
      status.lastChild.textContent = "Reading your post";
      typeInto(target, text, 22)
        .then(function () {
          status.classList.add("is-on");
          return wait(900);
        })
        .then(function () {
          fields.forEach(function (f, i) {
            window.setTimeout(function () {
              f.classList.add("is-in");
            }, i * 140);
          });
          return wait(fields.length * 140 + 300);
        })
        .then(function () {
          status.classList.add("is-done");
          status.lastChild.textContent = "4 of 5 fields filled";
          return wait(5200);
        })
        .then(run);
    };
    onEnter(demo, run, 0.4);
  })();

  /* 02 Map: the walk and drive popover flips. */
  (function mapDemo() {
    var pop = $("[data-walk-pop]");
    if (!pop) return;
    var tabs = $$(".walk-tabs b", pop);
    var time = $("[data-walk-time]", pop);
    var on = 0;
    var values = ["8 min", "4 min"];
    window.setInterval(function () {
      on = (on + 1) % tabs.length;
      tabs.forEach(function (t, i) {
        t.classList.toggle("is-on", i === on);
      });
      time.textContent = values[on];
    }, 3000);
  })();

  /* 03 Request: type a note, press send, the request goes out, comes back
     accepted, and the emails un-blur. */
  (function requestDemo() {
    var demo = $("[data-request-demo]");
    if (!demo) return;
    var note = $("[data-rq-type]", demo);
    var send = $("[data-rq-send]", demo);
    var sent = $('[data-rq-state="sent"]', demo);
    var ok = $('[data-rq-state="ok"]', demo);
    var emails = $("[data-rq-emails]", demo);
    var blurs = $$("[data-rq-blur]", demo);
    var run = function () {
      demo.classList.remove("is-sent");
      sent.classList.remove("is-on");
      ok.classList.remove("is-on");
      emails.classList.remove("is-on");
      blurs.forEach(function (b) {
        b.classList.remove("is-clear");
      });
      typeInto(note, "Hi Maya, I am at USC through August and would love to take over the room.", 26)
        .then(function () {
          return wait(500);
        })
        .then(function () {
          send.classList.add("is-pressed");
          return wait(160);
        })
        .then(function () {
          send.classList.remove("is-pressed");
          demo.classList.add("is-sent");
          sent.classList.add("is-on");
          return wait(1800);
        })
        .then(function () {
          ok.classList.add("is-on");
          return wait(600);
        })
        .then(function () {
          emails.classList.add("is-on");
          return wait(700);
        })
        .then(function () {
          blurs.forEach(function (b) {
            b.classList.add("is-clear");
          });
          return wait(5200);
        })
        .then(run);
    };
    onEnter(demo, run, 0.4);
  })();

  /* Numbers count in. */
  (function numbers() {
    var tiles = $$("[data-num]");
    if (!tiles.length) return;
    onEnter(
      tiles[0].closest(".numbers") || tiles[0],
      function () {
        tiles.forEach(function (t, i) {
          var to = Number(t.dataset.num);
          var prefix = t.dataset.prefix || "";
          var suffix = t.dataset.suffix || "";
          window.setTimeout(function () {
            countTo(t, to ? 0 : 0, to, 800, function (n) {
              return prefix + Math.round(n) + suffix;
            });
          }, i * 90);
        });
      },
      0.4,
    );
  })();

  /* Campus search: types the school, the results drop in. */
  (function campusDemo() {
    var demo = $("[data-campus-demo]");
    if (!demo) return;
    var field = $("[data-campus-type]", demo);
    var results = $("[data-campus-results]", demo);
    var run = function () {
      results.classList.remove("is-on");
      demo.classList.remove("is-typing");
      field.textContent = "";
      wait(600)
        .then(function () {
          demo.classList.add("is-typing");
          return typeInto(field, "University of S", 70);
        })
        .then(function () {
          return wait(250);
        })
        .then(function () {
          results.classList.add("is-on");
          return wait(6000);
        })
        .then(run);
    };
    onEnter(demo, run, 0.4);
  })();

  /* Phone carousel: cards slide along the bottom, the pins light up. */
  (function phoneDemo() {
    var phone = $("[data-phone]");
    var carousel = $("[data-ph-carousel]");
    if (!phone || !carousel) return;
    var cards = $$(".ph-card", carousel);
    var pins = $$(".price-marker", phone);
    var order = ["$1,150", "$1,650", "$800"];
    var i = 0;
    var step = 270;
    var apply = function () {
      cards.forEach(function (c) {
        c.style.setProperty("--shift", -i * step + "px");
      });
      pins.forEach(function (p) {
        p.classList.toggle("is-active", p.textContent === order[i]);
      });
    };
    onEnter(
      phone,
      function () {
        apply();
        window.setInterval(function () {
          i = (i + 1) % cards.length;
          apply();
        }, 3200);
      },
      0.4,
    );
  })();

  /* One rAF loop. Cloud parallax, the header shadow, and, where the browser
     has no scroll driven animations, the stage settling and the cluster split. */
  var clouds = $$("[data-parallax]");
  var header = $(".site-header");
  var riseEl = $("[data-rise]");
  var shotEl = $("[data-shot]");
  var ticking = false;
  var scrollTimelineLive = function (el) {
    if (!hasScrollDriven || !el || !el.getAnimations) return false;
    var list = el.getAnimations();
    for (var i = 0; i < list.length; i++) {
      if (list[i].timeline && list[i].currentTime !== null) return true;
    }
    return false;
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
      var t = Math.min(1, Math.max(0, window.scrollY / 360));
      riseEl.style.setProperty("--rise", (1 - t).toFixed(3));
    }
    if (shotEl) {
      var p = Math.min(1, Math.max(0, (window.scrollY - 160) / 560));
      shotEl.style.setProperty("--p", p.toFixed(3));
    }
    if (header) header.classList.toggle("is-stuck", window.scrollY > 24);
  };
  var checkTimelines = function () {
    if (scrollTimelineLive(riseEl)) riseEl = null;
    if (scrollTimelineLive(shotEl)) shotEl = null;
    if (riseEl || shotEl) document.documentElement.classList.add("no-sda");
    frame();
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
