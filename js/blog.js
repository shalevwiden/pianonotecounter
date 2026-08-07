/**
 * Peak Notes blog — theme, reveals, create-post UI, and custom post viewer.
 */

import {
  createId,
  excerptFromBody,
  fileToThumbnailDataUrl,
  formatDisplayDate,
  getPost,
  readPosts,
  savePost,
} from "./blog-posts.js";

const THEME_KEY = "psr-theme";
const FALLBACK_THUMB = "../assets/pianohero-1.png";

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    setTheme(saved);
  } else {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    setTheme(prefersLight ? "light" : "dark");
  }

  document.getElementById("landingThemeToggle")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  });
}

function initNavScroll() {
  const nav = document.querySelector(".landing-nav");
  if (!nav) return;
  const onScroll = () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initReveals() {
  const nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nodes.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -4% 0px" }
  );

  nodes.forEach((el) => observer.observe(el));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function bodyToParagraphs(body) {
  return String(body || "")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => `<p>${escapeHtml(chunk).replaceAll("\n", "<br />")}</p>`)
    .join("");
}

function todayInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function cardHtml(post) {
  const title = escapeHtml(post.title);
  const author = escapeHtml(post.author || "Peak Notes");
  const date = escapeHtml(formatDisplayDate(post.date));
  const excerpt = escapeHtml(post.excerpt || excerptFromBody(post.body));
  const image = escapeHtml(post.imageDataUrl || FALLBACK_THUMB);
  const href = `post.html?id=${encodeURIComponent(post.id)}`;

  return `
    <a class="blog-card reveal reveal--up is-visible" href="${href}" data-user-post="${escapeHtml(post.id)}">
      <div class="blog-card__media">
        <img src="${image}" alt="" loading="lazy" />
      </div>
      <div class="blog-card__body">
        <div class="blog-card__meta">
          <span>${author}</span>
          <span>${date}</span>
        </div>
        <h2 class="blog-card__title">${title}</h2>
        <p class="blog-card__excerpt">${excerpt}</p>
        <span class="blog-card__more">Read →</span>
      </div>
    </a>
  `;
}

function renderUserPosts() {
  const grid = document.getElementById("blogGrid");
  if (!grid) return;

  grid.querySelectorAll("[data-user-post]").forEach((el) => el.remove());

  const posts = readPosts();
  if (!posts.length) return;

  const markup = posts.map(cardHtml).join("");
  grid.insertAdjacentHTML("afterbegin", markup);
}

function initCreatePost() {
  const dialog = document.getElementById("blogDialog");
  const form = document.getElementById("blogForm");
  const openBtn = document.getElementById("blogNewBtn");
  if (!dialog || !form || !openBtn) return;

  const titleInput = document.getElementById("blogTitle");
  const authorInput = document.getElementById("blogAuthor");
  const dateInput = document.getElementById("blogDate");
  const bodyInput = document.getElementById("blogBody");
  const imageInput = document.getElementById("blogImage");
  const preview = document.getElementById("blogImagePreview");
  const errorEl = document.getElementById("blogFormError");
  let imageDataUrl = "";

  const showError = (message) => {
    if (!errorEl) return;
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  };

  const resetForm = () => {
    form.reset();
    if (authorInput) authorInput.value = "Peak Notes";
    if (dateInput) dateInput.value = todayInputValue();
    imageDataUrl = "";
    if (preview) {
      preview.hidden = true;
      const img = preview.querySelector("img");
      if (img) img.removeAttribute("src");
    }
    showError("");
  };

  openBtn.addEventListener("click", () => {
    resetForm();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    titleInput?.focus();
  });

  const closeDialog = () => {
    showError("");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };

  document.getElementById("blogDialogClose")?.addEventListener("click", closeDialog);
  document.getElementById("blogDialogCancel")?.addEventListener("click", closeDialog);

  imageInput?.addEventListener("change", async () => {
    const file = imageInput.files?.[0];
    if (!file) {
      imageDataUrl = "";
      if (preview) preview.hidden = true;
      return;
    }
    try {
      imageDataUrl = await fileToThumbnailDataUrl(file);
      const img = preview?.querySelector("img");
      if (img && preview) {
        img.src = imageDataUrl;
        preview.hidden = false;
      }
      showError("");
    } catch (err) {
      imageDataUrl = "";
      if (preview) preview.hidden = true;
      showError(err?.message || "Could not use that image.");
      imageInput.value = "";
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const title = titleInput?.value.trim() || "";
    const author = authorInput?.value.trim() || "Peak Notes";
    const date = dateInput?.value || todayInputValue();
    const body = bodyInput?.value.trim() || "";

    if (!title || !body) {
      showError("Title and post body are required.");
      return;
    }

    try {
      const post = {
        id: createId(),
        title,
        author,
        date,
        body,
        excerpt: excerptFromBody(body),
        imageDataUrl: imageDataUrl || "",
        createdAt: Date.now(),
      };
      savePost(post);
      closeDialog();
      renderUserPosts();
      window.location.href = `post.html?id=${encodeURIComponent(post.id)}`;
    } catch (err) {
      showError(
        err?.name === "QuotaExceededError"
          ? "Storage is full — try a smaller image."
          : err?.message || "Could not save this post."
      );
    }
  });
}

function initCustomPostPage() {
  const root = document.getElementById("blogPostRoot");
  if (!root) return;

  const id = new URLSearchParams(window.location.search).get("id");
  const post = id ? getPost(id) : null;

  if (!post) {
    root.innerHTML = `
      <a class="blog-post__back" href="./">← All posts</a>
      <h1 class="blog-post__title">Post not found</h1>
      <p class="blog-post__body">This post may have been cleared from this browser’s storage.</p>
    `;
    document.title = "Post not found — Peak Notes";
    return;
  }

  document.title = `${post.title} — Peak Notes`;
  const image = post.imageDataUrl || FALLBACK_THUMB;
  root.innerHTML = `
    <a class="blog-post__back" href="./">← All posts</a>
    <p class="blog-post__eyebrow">Reader post</p>
    <h1 class="blog-post__title">${escapeHtml(post.title)}</h1>
    <div class="blog-post__byline">
      <span class="blog-post__author">${escapeHtml(post.author || "Peak Notes")}</span>
      <span class="blog-post__date">${escapeHtml(formatDisplayDate(post.date))}</span>
    </div>
    <figure class="blog-post__figure">
      <img src="${escapeHtml(image)}" alt="" />
    </figure>
    <div class="blog-post__body">
      ${bodyToParagraphs(post.body)}
    </div>
    <div class="blog-post__footer">
      <a class="landing-btn landing-btn--ghost" href="./">More from the blog</a>
      <a class="landing-btn landing-btn--primary" href="../app.html">Open the studio</a>
    </div>
  `;
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

initTheme();
initNavScroll();
initReveals();
renderUserPosts();
initCreatePost();
initCustomPostPage();
