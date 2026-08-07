/**
 * User-created blog posts (localStorage for now; permissions later).
 */

const STORAGE_KEY = "psr-blog-posts-v1";
const MAX_IMAGE_EDGE = 1400;
const JPEG_QUALITY = 0.82;

export function readPosts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePosts(posts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
}

export function getPost(id) {
  return readPosts().find((post) => post.id === id) ?? null;
}

export function savePost(post) {
  const posts = readPosts();
  const index = posts.findIndex((item) => item.id === post.id);
  if (index >= 0) posts[index] = post;
  else posts.unshift(post);
  writePosts(posts);
  return post;
}

export function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `post-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Compress an image file to a data URL so thumbnails fit in localStorage.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToThumbnailDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode that image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unavailable."));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function formatDisplayDate(isoOrDisplay) {
  if (!isoOrDisplay) return "";
  const date = new Date(isoOrDisplay);
  if (Number.isNaN(date.getTime())) return String(isoOrDisplay);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function excerptFromBody(body, max = 140) {
  const text = String(body || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}
