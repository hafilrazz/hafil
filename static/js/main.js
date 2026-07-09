/**
 * Portfolio bootstrap — gate, arcade, UI polish.
 */

import { initGate } from "./gate.js";
import { initArcade } from "./arcade.js";

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
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
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
      { rootMargin: "-30% 0px -55% 0px", threshold: [0.1, 0.25, 0.5] }
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

function initNebulaPhoto() {
  const el = document.querySelector(".nebula-bg");
  if (!el) return;
  // Skip heavy background on save-data / slow connections
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ""))) return;

  const url =
    "https://mymythos.org/wp-content/uploads/2025/10/The-Nebula-Archetype-Featured-scaled.webp";
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    el.style.setProperty("--nebula-url", `url("${url}")`);
    el.classList.add("has-photo");
  };
  img.src = url;
}

document.addEventListener("DOMContentLoaded", () => {
  initGate();
  initArcade();
  initScrollReveal();
  initActiveNav();
  initYear();
  // Defer decorative background so first paint stays fast
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => initNebulaPhoto(), { timeout: 2500 });
  } else {
    setTimeout(initNebulaPhoto, 400);
  }
});
