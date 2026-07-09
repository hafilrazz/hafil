/**
 * Bootstrap — minimal first paint, lazy arcade load.
 */

import { initGate } from "./gate.js";

function preferLiteMode() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = Boolean(conn?.saveData);
  const slowNet = conn && /2g/.test(conn.effectiveType || "");
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lowCpu = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const lowMem = typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4;
  return saveData || slowNet || coarse || narrow || reduceMotion || lowCpu || lowMem;
}

function initPerfMode() {
  if (preferLiteMode()) document.body.classList.add("perf-lite");
  // Hint browser we care about responsiveness
  if ("scheduler" in window && navigator.scheduling?.isInputPending) {
    /* reserved for future yield points */
  }
}

function initScrollReveal() {
  const sections = document.querySelectorAll(".section");
  if (!("IntersectionObserver" in window)) {
    sections.forEach((s) => s.classList.add("visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.06, rootMargin: "40px 0px -4% 0px" }
  );
  sections.forEach((s) => io.observe(s));
}

function initActiveNav() {
  const links = [...document.querySelectorAll("[data-nav]")];
  if (!links.length) return;

  const sections = links
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      const el = id ? document.getElementById(id) : null;
      return el ? { link, el } : null;
    })
    .filter(Boolean);

  function setActive(id) {
    for (const { link, el } of sections) {
      link.classList.toggle("active", el.id === id);
    }
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActive(visible.target.id);
      },
      { rootMargin: "-35% 0px -50% 0px", threshold: [0.12, 0.35] }
    );
    sections.forEach(({ el }) => io.observe(el));
  }

  links.forEach((link) => {
    link.addEventListener("click", () => {
      const id = link.getAttribute("href")?.slice(1);
      if (id) setActive(id);
    });
  });
}

function initYear() {
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
}

/** Arcade is heavy — load only when needed */
let arcadePromise = null;

function loadArcade() {
  if (arcadePromise) return arcadePromise;
  arcadePromise = import("./arcade.js")
    .then((m) => {
      m.initArcade();
      return m;
    })
    .catch((err) => {
      console.error("Arcade failed to load", err);
      arcadePromise = null;
    });
  return arcadePromise;
}

function scheduleArcadeLoad() {
  const section = document.getElementById("arcade");
  const navArcade = document.querySelector('a[href="#arcade"]');

  navArcade?.addEventListener(
    "click",
    () => {
      loadArcade();
    },
    { passive: true }
  );

  // Prefetch when user is idle and near the section
  if (section && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadArcade();
          io.disconnect();
        }
      },
      { rootMargin: "280px 0px", threshold: 0.01 }
    );
    io.observe(section);
  } else {
    // Fallback: load after first interaction or timeout
    const kick = () => loadArcade();
    window.addEventListener("pointerdown", kick, { once: true, passive: true });
    setTimeout(kick, 3500);
  }

  // If hash already points to arcade
  if (location.hash === "#arcade") loadArcade();
}

function initSmoothAnchors() {
  // Native CSS scroll-behavior is enough; avoid JS scroll polyfills
}

document.addEventListener("DOMContentLoaded", () => {
  initPerfMode();
  initGate();
  initScrollReveal();
  initActiveNav();
  initYear();
  initSmoothAnchors();
  scheduleArcadeLoad();
  // Chat: load soon so join/send always works after gate
  let chatBooted = false;
  const bootChat = () => {
    if (chatBooted) return;
    chatBooted = true;
    import("./chat.js")
      .then((m) => m.initChat())
      .catch((e) => {
        chatBooted = false;
        console.error("chat load failed", e);
      });
  };
  // Eager-ish: after short delay (user has usually passed gate by then)
  setTimeout(bootChat, 600);
  document.querySelector('a[href="#chat"]')?.addEventListener(
    "click",
    () => bootChat(),
    { passive: true }
  );
  const chatSection = document.getElementById("chat");
  if (chatSection && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          bootChat();
          io.disconnect();
        }
      },
      { rootMargin: "240px 0px", threshold: 0.01 }
    );
    io.observe(chatSection);
  }
});
