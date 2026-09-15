(() => {
  "use strict";

  const state = {
    followers: new Map(),
    following: new Map(),
    recentUnfollows: new Map(),
    view: "all",
    search: "",
    sort: "username",
    sourceName: ""
  };

  const $ = (selector) => document.querySelector(selector);

  const elements = {
    fileInput: $("#fileInput"),
    dropzone: $("#dropzone"),
    dashboard: $("#dashboard"),
    accountList: $("#accountList"),
    emptyState: $("#emptyState"),
    searchInput: $("#searchInput"),
    sortSelect: $("#sortSelect"),
    exportCsv: $("#exportCsv"),
    resultCount: $("#resultCount"),
    fileStatus: $("#fileStatus"),
    toast: $("#toast")
  };

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3000);
  }

  function usernameFromFollower(item) {
    const entry = item?.string_list_data?.[0];
    return entry?.value || "";
  }

  function usernameFromFollowing(item) {
    return item?.title || item?.string_list_data?.[0]?.value || "";
  }

  function timestampFromItem(item) {
    return item?.string_list_data?.[0]?.timestamp || item?.timestamp || 0;
  }

  function normalizeUsername(value) {
    return String(value || "").trim().replace(/^@/, "").toLowerCase();
  }

  function addRecord(map, username, item) {
    const key = normalizeUsername(username);
    if (!key) return;
    map.set(key, {
      username: username.trim(),
      timestamp: timestampFromItem(item),
      name: item?.label_values?.find(x => x.label === "Name")?.value || "",
      url: item?.string_list_data?.[0]?.href || item?.label_values?.find(x => x.label === "URL")?.value || `https://www.instagram.com/${key}/`
    });
  }

  function parseJsonObject(filename, data) {
    const lower = filename.toLowerCase();
    const text = JSON.stringify(data).toLowerCase();

    if (lower.includes("followers") && !lower.includes("following")) {
      const arr = Array.isArray(data) ? data : [];
      arr.forEach(item => addRecord(state.followers, usernameFromFollower(item), item));
      return "followers";
    }

    if (lower.includes("following")) {
      const arr = Array.isArray(data) ? data : data?.relationships_following;
      if (Array.isArray(arr)) {
        arr.forEach(item => addRecord(state.following, usernameFromFollowing(item), item));
        return "following";
      }
    }

    if (lower.includes("recently_unfollowed")) {
      const arr = Array.isArray(data) ? data : [];
      arr.forEach(item => {
        const username = item?.label_values?.find(x => x.label === "Username")?.value || "";
        addRecord(state.recentUnfollows, username, item);
      });
      return "unfollowed";
    }

    // Fallback for renamed files.
    if (text.includes("relationships_following")) {
      const arr = data.relationships_following;
      if (Array.isArray(arr)) arr.forEach(item => addRecord(state.following, usernameFromFollowing(item), item));
      return "following";
    }
    if (Array.isArray(data) && data.some(x => x?.string_list_data?.[0]?.value)) {
      data.forEach(item => addRecord(state.followers, usernameFromFollower(item), item));
      return "followers";
    }
    return null;
  }

  async function readFile(file) {
    state.followers.clear();
    state.following.clear();
    state.recentUnfollows.clear();

    if (file.name.toLowerCase().endsWith(".zip")) {
      if (typeof JSZip === "undefined") {
        throw new Error("ZIP support could not load. Check your internet connection and try the JSON files directly.");
      }
      const zip = await JSZip.loadAsync(file);
      const jsonFiles = Object.values(zip.files).filter(entry =>
        !entry.dir && entry.name.toLowerCase().endsWith(".json")
      );

      for (const entry of jsonFiles) {
        const text = await entry.async("string");
        try {
          parseJsonObject(entry.name, JSON.parse(text));
        } catch (_) {
          // Ignore unrelated/broken JSON files from an export.
        }
      }
      state.sourceName = file.name;
      return;
    }

    const text = await file.text();
    parseJsonObject(file.name, JSON.parse(text));
    state.sourceName = file.name;
  }

  function getRows() {
    const F = state.followers;
    const G = state.following;
    const U = state.recentUnfollows;

    let rows = [];

    if (state.view === "unfollowed") {
      rows = [...U.values()].map(item => ({
        ...item,
        status: "recent-unfollow"
      }));
    } else {
      rows = [...G.values()].map(item => {
        const key = normalizeUsername(item.username);
        const follower = F.get(key);
        return {
          ...item,
          status: follower ? "mutual" : "not-back",
          followedYou: Boolean(follower),
          youFollow: true
        };
      });

      if (state.view === "not-followed") {
        rows = [...F.values()]
          .filter(item => !G.has(normalizeUsername(item.username)))
          .map(item => ({ ...item, status: "not-followed", followedYou: true, youFollow: false }));
      } else if (state.view === "not-back") {
        rows = rows.filter(row => row.status === "not-back");
      } else if (state.view === "mutual") {
        rows = rows.filter(row => row.status === "mutual");
      }
    }

    const q = normalizeUsername(state.search);
    if (q) {
      rows = rows.filter(row =>
        normalizeUsername(row.username).includes(q) ||
        normalizeUsername(row.name).includes(q)
      );
    }

    rows.sort((a, b) => {
      if (state.sort === "recent") return (b.timestamp || 0) - (a.timestamp || 0);
      if (state.sort === "oldest") return (a.timestamp || 0) - (b.timestamp || 0);
      return normalizeUsername(a.username).localeCompare(normalizeUsername(b.username));
    });

    return rows;
  }

  function formatDate(timestamp) {
    if (!timestamp) return "";
    const date = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function renderStats() {
    const f = state.followers.size;
    const g = state.following.size;
    let mutual = 0;
    let notBack = 0;
    for (const username of G.keys()) {
      if (F.has(username)) mutual++;
      else notBack++;
    }
    const notFollowed = [...F.keys()].filter(username => !G.has(username)).length;

    $("#followersCount").textContent = f.toLocaleString();
    $("#followingCount").textContent = g.toLocaleString();
    $("#mutualCount").textContent = mutual.toLocaleString();
    $("#notBackCount").textContent = notBack.toLocaleString();
    $("#notFollowedCount").textContent = notFollowed.toLocaleString();
    $("#unfollowedCount").textContent = state.recentUnfollows.size.toLocaleString();
  }

  function badge(row) {
    if (row.status === "mutual") return '<span class="badge mutual">Mutual</span>';
    if (row.status === "not-back") return '<span class="badge warning">Doesn’t follow you</span>';
    if (row.status === "not-followed") return '<span class="badge neutral">You don’t follow</span>';
    return '<span class="badge warning">Recent unfollow</span>';
  }

  function render() {
    const rows = getRows();
    elements.accountList.innerHTML = rows.map(row => {
      const username = row.username || "unknown";
      const initial = username.charAt(0).toUpperCase();
      const url = row.url || `https://www.instagram.com/${encodeURIComponent(username)}/`;
      return `
        <article class="account">
          <div class="avatar">${escapeHtml(initial)}</div>
          <div>
            <div class="account-name">
              <a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(username)}</a>
            </div>
            <div class="account-date">${escapeHtml(row.name || "")}${row.timestamp ? ` · ${formatDate(row.timestamp)}` : ""}</div>
          </div>
          <div class="badges">${badge(row)}</div>
        </article>
      `;
    }).join("");

    elements.emptyState.classList.toggle("hidden", rows.length !== 0);
    elements.resultCount.textContent = `${rows.length.toLocaleString()} account${rows.length === 1 ? "" : "s"}`;
    elements.fileStatus.textContent = state.sourceName ? `Source: ${state.sourceName}` : "No file loaded";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function setLoaded() {
    elements.dashboard.classList.remove("hidden");
    elements.dropzone.classList.add("hidden");
    renderStats();
    render();
  }

  async function handleFile(file) {
    if (!file) return;
    const valid = file.name.toLowerCase().endsWith(".json") || file.name.toLowerCase().endsWith(".zip");
    if (!valid) {
      showToast("Please choose an Instagram .json or .zip export.");
      return;
    }

    try {
      showToast("Reading your export locally…");
      await readFile(file);
      if (!state.followers.size && !state.following.size && !state.recentUnfollows.size) {
        throw new Error("No recognizable Instagram relationship data was found.");
      }
      setLoaded();
      showToast("Analysis complete.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not read this file.");
    }
  }

  elements.fileInput.addEventListener("change", e => handleFile(e.target.files[0]));

  ["dragenter", "dragover"].forEach(eventName => {
    elements.dropzone.addEventListener(eventName, e => {
      e.preventDefault();
      elements.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(eventName => {
    elements.dropzone.addEventListener(eventName, e => {
      e.preventDefault();
      elements.dropzone.classList.remove("dragover");
    });
  });
  elements.dropzone.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      tab.classList.add("active");
      state.view = tab.dataset.view;
      render();
    });
  });

  elements.searchInput.addEventListener("input", e => {
    state.search = e.target.value;
    render();
  });

  elements.sortSelect.addEventListener("change", e => {
    state.sort = e.target.value;
    render();
  });

  elements.exportCsv.addEventListener("click", () => {
    const rows = getRows();
    if (!rows.length) {
      showToast("There are no accounts in the current view.");
      return;
    }

    const csvRows = [
      ["username", "name", "status", "date", "instagram_url"],
      ...rows.map(row => [
        row.username || "",
        row.name || "",
        row.status || "",
        row.timestamp ? formatDate(row.timestamp) : "",
        row.url || ""
      ])
    ];

    const csv = csvRows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `instagram-${state.view}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
})();
