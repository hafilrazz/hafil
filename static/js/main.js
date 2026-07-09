/**
 * Bootstrap — gate first, then chat + arcade.
 */

import { initGate } from "./gate.js";
// Chat is a classic (non-module) script so JOIN/WIPE onclick always works.
// It self-boots from index.html — do not import it as a module.

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

  navArcade?.addEventListener("click", () => loadArcade(), { passive: true });

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
    const kick = () => loadArcade();
    window.addEventListener("pointerdown", kick, { once: true, passive: true });
    setTimeout(kick, 3500);
  }

  if (location.hash === "#arcade") loadArcade();
}

document.addEventListener("DOMContentLoaded", () => {
  initPerfMode();
  initGate();
  // Ensure chat is up even if its script loaded first/last
  try {
    if (typeof window.initChat === "function") window.initChat();
  } catch (e) {
    console.error("Chat init failed", e);
  }
  initScrollReveal();
  initActiveNav();
  initYear();
  scheduleArcadeLoad();
});
