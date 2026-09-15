(() => {

  "use strict";


  /*
   * ==========================================
   * APPLICATION STATE
   * ==========================================
   */

  const state = {

    followers: new Map(),

    following: new Map(),

    recentUnfollows: new Map(),

    view: "all",

    search: "",

    sort: "username",

    sourceName: ""

  };


  /*
   * Uploaded raw files.
   *
   * Followers:
   * Instagram can split them into:
   *
   * followers_1.json
   * followers_2.json
   * followers_3.json
   *
   * so we keep an array.
   */

  const uploadedFiles = {

    followers: [],

    following: null,

    unfollowed: null

  };


  /*
   * ==========================================
   * DOM
   * ==========================================
   */

  const $ = selector =>
    document.querySelector(selector);


  const elements = {

    fileInput:
      $("#fileInput"),

    dropzone:
      $("#dropzone"),

    dashboard:
      $("#dashboard"),

    accountList:
      $("#accountList"),

    emptyState:
      $("#emptyState"),

    searchInput:
      $("#searchInput"),

    sortSelect:
      $("#sortSelect"),

    exportCsv:
      $("#exportCsv"),

    resultCount:
      $("#resultCount"),

    fileStatus:
      $("#fileStatus"),

    toast:
      $("#toast")

  };


  /*
   * ==========================================
   * TOAST
   * ==========================================
   */

  function showToast(message) {

    elements.toast.textContent =
      message;

    elements.toast.classList.add(
      "show"
    );


    clearTimeout(
      showToast.timer
    );


    showToast.timer =
      setTimeout(() => {

        elements.toast.classList.remove(
          "show"
        );

      }, 3000);

  }


  /*
   * ==========================================
   * NORMALIZATION
   * ==========================================
   */

  function normalizeUsername(value) {

    return String(value || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();

  }


  function escapeHtml(value) {

    return String(value)
      .replace(
        /[&<>"']/g,
        char => ({

          "&": "&amp;",

          "<": "&lt;",

          ">": "&gt;",

          '"': "&quot;",

          "'": "&#039;"

        }[char])
      );

  }


  function escapeAttribute(value) {

    return escapeHtml(value)
      .replace(
        /`/g,
        "&#096;"
      );

  }


  /*
   * ==========================================
   * INSTAGRAM JSON PARSING
   * ==========================================
   */

  function usernameFromFollower(item) {

    const entry =
      item?.string_list_data?.[0];

    return entry?.value || "";

  }


  function usernameFromFollowing(item) {

    return (
      item?.title ||
      item?.string_list_data?.[0]?.value ||
      ""
    );

  }


  function timestampFromItem(item) {

    return (
      item?.string_list_data?.[0]?.timestamp ||
      item?.timestamp ||
      0
    );

  }


  function addRecord(
    map,
    username,
    item
  ) {

    const key =
      normalizeUsername(username);


    if (!key) return;


    map.set(
      key,
      {

        username:
          String(username).trim(),

        timestamp:
          timestampFromItem(item),

        name:
          item?.label_values?.find(
            x => x.label === "Name"
          )?.value || "",

        url:
          item?.string_list_data?.[0]?.href ||
          item?.label_values?.find(
            x => x.label === "URL"
          )?.value ||
          `https://www.instagram.com/${key}/`

      }
    );

  }


  /*
   * Detect the Instagram file type.
   */

  function detectFileType(
    filename,
    data
  ) {

    const lower =
      filename.toLowerCase();


    /*
     * Recent unfollows
     */

    if (
      lower.includes(
        "recently_unfollowed"
      )
    ) {

      return "unfollowed";

    }


    /*
     * Following
     */

    if (
      lower.includes("following")
    ) {

      return "following";

    }


    /*
     * Followers
     */

    if (
      lower.includes("followers")
    ) {

      return "followers";

    }


    /*
     * Fallback:
     * inspect JSON structure.
     */

    try {

      const serialized =
        JSON.stringify(data)
          .toLowerCase();


      if (
        serialized.includes(
          "relationships_following"
        )
      ) {

        return "following";

      }


      if (
        Array.isArray(data) &&
        data.some(
          item =>
            item?.string_list_data?.[0]?.value
        )
      ) {

        return "followers";

      }

    } catch (_) {

      return null;

    }


    return null;

  }


  /*
   * Parse one Instagram JSON.
   */

  function parseJsonObject(
    filename,
    data
  ) {

    const type =
      detectFileType(
        filename,
        data
      );


    if (!type) {

      return null;

    }


    /*
     * FOLLOWERS
     */

    if (type === "followers") {

      const array =
        Array.isArray(data)
          ? data
          : [];


      array.forEach(item => {

        addRecord(
          state.followers,
          usernameFromFollower(item),
          item
        );

      });


      return "followers";

    }


    /*
     * FOLLOWING
     */

    if (type === "following") {

      const array =
        Array.isArray(data)
          ? data
          : data?.relationships_following;


      if (
        Array.isArray(array)
      ) {

        array.forEach(item => {

          addRecord(
            state.following,
            usernameFromFollowing(item),
            item
          );

        });

      }


      return "following";

    }


    /*
     * RECENT UNFOLLOWS
     */

    if (
      type === "unfollowed"
    ) {

      const array =
        Array.isArray(data)
          ? data
          : [];


      array.forEach(item => {

        const username =
          item?.label_values?.find(
            x =>
              x.label === "Username"
          )?.value || "";


        addRecord(
          state.recentUnfollows,
          username,
          item
        );

      });


      return "unfollowed";

    }


    return null;

  }


  /*
   * ==========================================
   * FILE READING
   * ==========================================
   */

  async function readJsonData(file) {

    if (
      !file.name
        .toLowerCase()
        .endsWith(".json")
    ) {

      throw new Error(
        `${file.name}: only .json files are accepted.`
      );

    }


    const text =
      await file.text();


    try {

      return JSON.parse(text);

    } catch (_) {

      throw new Error(
        `${file.name} is not valid JSON.`
      );

    }

  }


  /*
   * ==========================================
   * ADD FILE
   * ==========================================
   */

  async function addJsonFile(
    file,
    forcedType = null
  ) {

    const data =
      await readJsonData(file);


    const type =
      forcedType ||
      detectFileType(
        file.name,
        data
      );


    if (!type) {

      throw new Error(
        `Could not identify ${file.name}. Use the original Instagram export filename.`
      );

    }


    /*
     * Followers can have multiple files.
     */

    if (
      type === "followers"
    ) {

      uploadedFiles.followers.push({

        name:
          file.name,

        data:
          data

      });

    }


    /*
     * Following is a single file.
     *
     * Uploading another following file
     * replaces the previous one.
     */

    else if (
      type === "following"
    ) {

      uploadedFiles.following = {

        name:
          file.name,

        data:
          data

      };

    }


    /*
     * Recent unfollows.
     */

    else if (
      type === "unfollowed"
    ) {

      uploadedFiles.unfollowed = {

        name:
          file.name,

        data:
          data

      };

    }


    rebuildFromUploadedFiles();


    elements.dashboard
      .classList
      .remove("hidden");


    showToast(
      `${file.name} added.`
    );

  }


  /*
   * ==========================================
   * REBUILD DATA
   * ==========================================
   *
   * Important:
   *
   * We don't simply append state.
   *
   * Instead we rebuild the Maps from all
   * uploaded raw JSON files.
   *
   * This prevents duplicates after removing
   * or replacing files.
   */

  function rebuildFromUploadedFiles() {

    state.followers.clear();

    state.following.clear();

    state.recentUnfollows.clear();


    state.sourceName = "";


    /*
     * Followers
     */

    uploadedFiles.followers
      .forEach(file => {

        parseJsonObject(
          file.name,
          file.data
        );


        state.sourceName =
          state.sourceName
            ? `${state.sourceName}, ${file.name}`
            : file.name;

      });


    /*
     * Following
     */

    if (
      uploadedFiles.following
    ) {

      parseJsonObject(
        uploadedFiles.following.name,
        uploadedFiles.following.data
      );


      state.sourceName =
        state.sourceName
          ? `${state.sourceName}, ${uploadedFiles.following.name}`
          : uploadedFiles.following.name;

    }


    /*
     * Recent unfollows
     */

    if (
      uploadedFiles.unfollowed
    ) {

      parseJsonObject(
        uploadedFiles.unfollowed.name,
        uploadedFiles.unfollowed.data
      );


      state.sourceName =
        state.sourceName
          ? `${state.sourceName}, ${uploadedFiles.unfollowed.name}`
          : uploadedFiles.unfollowed.name;

    }


    renderStats();

    render();

    renderUploadedFiles();

  }


  /*
   * ==========================================
   * UPLOADED FILE UI
   * ==========================================
   */

  function renderUploadedFiles() {

    const renderSlot =
      (
        type,
        elementId
      ) => {

        const target =
          document.getElementById(
            elementId
          );


        let files;


        if (
          type === "followers"
        ) {

          files =
            uploadedFiles.followers;

        } else {

          files =
            uploadedFiles[type]
              ? [uploadedFiles[type]]
              : [];

        }


        if (!files.length) {

          target.innerHTML =
            `<span class="slot-empty">
              ${
                type === "unfollowed"
                  ? "Optional"
                  : "Waiting for file"
              }
            </span>`;

          return;

        }


        target.innerHTML =
          files
            .map(
              (
                file,
                index
              ) => `

                <span
                  class="file-chip"
                  title="${escapeHtml(file.name)}"
                >

                  <b>✓</b>

                  ${escapeHtml(file.name)}

                  <button
                    type="button"
                    class="remove-file"
                    data-type="${type}"
                    data-index="${index}"
                    aria-label="Remove ${escapeHtml(file.name)}"
                  >
                    ×
                  </button>

                </span>

              `
            )
            .join("");

      };


    renderSlot(
      "followers",
      "followersFiles"
    );


    renderSlot(
      "following",
      "followingFiles"
    );


    renderSlot(
      "unfollowed",
      "unfollowedFiles"
    );


    const total =
      uploadedFiles.followers.length +
      (
        uploadedFiles.following
          ? 1
          : 0
      ) +
      (
        uploadedFiles.unfollowed
          ? 1
          : 0
      );


    $("#uploadHint")
      .textContent =
      total
        ? `${total} JSON file${total === 1 ? "" : "s"} loaded.`
        : "Add the files one at a time.";

  }


  /*
   * ==========================================
   * CLEAR ALL
   * ==========================================
   */

  function resetData() {

    state.followers.clear();

    state.following.clear();

    state.recentUnfollows.clear();


    state.sourceName = "";


    uploadedFiles.followers = [];

    uploadedFiles.following = null;

    uploadedFiles.unfollowed = null;


    state.search = "";

    elements.searchInput.value = "";


    elements.dashboard
      .classList
      .add("hidden");


    renderUploadedFiles();


    showToast(
      "All uploaded data cleared."
    );

  }


  /*
   * ==========================================
   * STATISTICS
   * ==========================================
   */

  function renderStats() {

    const followers =
      state.followers.size;


    const following =
      state.following.size;


    let mutual = 0;

    let notBack = 0;


    /*
     * Following minus followers
     *
     * = accounts you follow
     *   that don't follow you.
     */

    for (
      const username
      of state.following.keys()
    ) {

      if (
        state.followers.has(
          username
        )
      ) {

        mutual++;

      } else {

        notBack++;

      }

    }


    /*
     * Followers minus following
     *
     * = accounts following you
     *   that you don't follow.
     */

    const notFollowed =
      [
        ...state.followers.keys()
      ]
      .filter(
        username =>
          !state.following.has(
            username
          )
      )
      .length;


    $("#followersCount")
      .textContent =
      followers.toLocaleString();


    $("#followingCount")
      .textContent =
      following.toLocaleString();


    $("#mutualCount")
      .textContent =
      mutual.toLocaleString();


    $("#notBackCount")
      .textContent =
      notBack.toLocaleString();


    $("#notFollowedCount")
      .textContent =
      notFollowed.toLocaleString();


    $("#unfollowedCount")
      .textContent =
      state.recentUnfollows.size
        .toLocaleString();

  }


  /*
   * ==========================================
   * GET CURRENT VIEW
   * ==========================================
   */

  function getRows() {

    const followers =
      state.followers;


    const following =
      state.following;


    const unfollows =
      state.recentUnfollows;


    let rows = [];


    /*
     * Recent unfollows
     */

    if (
      state.view ===
      "unfollowed"
    ) {

      rows =
        [
          ...unfollows.values()
        ]
        .map(
          item => ({

            ...item,

            status:
              "recent-unfollow"

          })
        );

    }


    /*
     * Other views
     */

    else {

      rows =
        [
          ...following.values()
        ]
        .map(
          item => {

            const key =
              normalizeUsername(
                item.username
              );


            const follower =
              followers.get(
                key
              );


            return {

              ...item,

              status:
                follower
                  ? "mutual"
                  : "not-back"

            };

          }
        );


      /*
       * Accounts following you
       * that you don't follow.
       */

      if (
        state.view ===
        "not-followed"
      ) {

        rows =
          [
            ...followers.values()
          ]
          .filter(
            item =>
              !following.has(
                normalizeUsername(
                  item.username
                )
              )
          )
          .map(
            item => ({

              ...item,

              status:
                "not-followed"

            })
          );

      }


      /*
       * Accounts you follow
       * that don't follow you.
       */

      else if (
        state.view ===
        "not-back"
      ) {

        rows =
          rows.filter(
            row =>
              row.status ===
              "not-back"
          );

      }


      /*
       * Mutual.
       */

      else if (
        state.view ===
        "mutual"
      ) {

        rows =
          rows.filter(
            row =>
              row.status ===
              "mutual"
          );

      }

    }


    /*
     * SEARCH
     */

    const search =
      normalizeUsername(
        state.search
      );


    if (search) {

      rows =
        rows.filter(
          row =>

            normalizeUsername(
              row.username
            ).includes(search)

            ||

            normalizeUsername(
              row.name
            ).includes(search)
        );

    }


    /*
     * SORT
     */

    rows.sort(
      (a, b) => {

        if (
          state.sort ===
          "recent"
        ) {

          return (
            (b.timestamp || 0) -
            (a.timestamp || 0)
          );

        }


        if (
          state.sort ===
          "oldest"
        ) {

          return (
            (a.timestamp || 0) -
            (b.timestamp || 0)
          );

        }


        return (
          normalizeUsername(
            a.username
          )
          .localeCompare(
            normalizeUsername(
              b.username
            )
          )
        );

      }
    );


    return rows;

  }


  /*
   * ==========================================
   * DATE
   * ==========================================
   */

  function formatDate(
    timestamp
  ) {

    if (!timestamp) {

      return "";

    }


    const date =
      new Date(
        Number(timestamp) * 1000
      );


    if (
      Number.isNaN(
        date.getTime()
      )
    ) {

      return "";

    }


    return new Intl.DateTimeFormat(
      undefined,
      {

        day:
          "2-digit",

        month:
          "short",

        year:
          "numeric"

      }
    ).format(date);

  }


  /*
   * ==========================================
   * BADGE
   * ==========================================
   */

  function badge(row) {

    if (
      row.status ===
      "mutual"
    ) {

      return `
        <span class="badge mutual">
          Mutual
        </span>
      `;

    }


    if (
      row.status ===
      "not-back"
    ) {

      return `
        <span class="badge warning">
          Doesn't follow you
        </span>
      `;

    }


    if (
      row.status ===
      "not-followed"
    ) {

      return `
        <span class="badge neutral">
          You don't follow
        </span>
      `;

    }


    return `
      <span class="badge warning">
        Recent unfollow
      </span>
    `;

  }


  /*
   * ==========================================
   * RENDER LIST
   * ==========================================
   */

  function render() {

    const rows =
      getRows();


    elements.accountList.innerHTML =
      rows
        .map(
          row => {

            const username =
              row.username ||
              "unknown";


            const initial =
              username
                .charAt(0)
                .toUpperCase();


            const url =
              row.url ||
              `https://www.instagram.com/${encodeURIComponent(username)}/`;


            return `

              <article class="account">

                <div class="avatar">
                  ${escapeHtml(initial)}
                </div>


                <div>

                  <div class="account-name">

                    <a
                      href="${escapeAttribute(url)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      @${escapeHtml(username)}
                    </a>

                  </div>


                  <div class="account-date">

                    ${
                      escapeHtml(
                        row.name || ""
                      )
                    }

                    ${
                      row.timestamp
                        ? ` · ${formatDate(row.timestamp)}`
                        : ""
                    }

                  </div>

                </div>


                <div class="badges">

                  ${badge(row)}

                </div>

              </article>

            `;

          }
        )
        .join("");


    elements.emptyState
      .classList
      .toggle(
        "hidden",
        rows.length !== 0
      );


    elements.resultCount
      .textContent =
      `${rows.length.toLocaleString()} account${rows.length === 1 ? "" : "s"}`;


    elements.fileStatus
      .textContent =
      state.sourceName
        ? `Source: ${state.sourceName}`
        : "No file loaded";

  }


  /*
   * ==========================================
   * FILE INPUT
   * ==========================================
   */

  elements.fileInput
    .addEventListener(
      "change",
      async event => {

        const files =
          [
            ...event.target.files
          ];


        await handleFiles(files);


        event.target.value = "";

      }
    );


  /*
   * Slot-specific inputs
   */

  document
    .querySelectorAll(
      '.upload-slot input[type="file"]'
    )
    .forEach(input => {

      input.addEventListener(
        "change",
        async event => {

          const files =
            [
              ...event.target.files
            ];


          await handleFiles(
            files,
            input.dataset.type
          );


          event.target.value = "";

        }
      );

    });


  /*
   * ==========================================
   * MULTIPLE FILE HANDLER
   * ==========================================
   */

  async function handleFiles(
    files,
    forcedType = null
  ) {

    if (!files.length) {

      return;

    }


    for (
      const file
      of files
    ) {

      try {

        await addJsonFile(
          file,
          forcedType
        );

      } catch (error) {

        console.error(
          error
        );


        showToast(
          error.message ||
          `Could not read ${file.name}.`
        );

      }

    }


    renderUploadedFiles();

  }


  /*
   * ==========================================
   * DRAG & DROP
   * ==========================================
   */

  [
    "dragenter",
    "dragover"
  ]
  .forEach(
    eventName => {

      elements.dropzone
        .addEventListener(
          eventName,
          event => {

            event.preventDefault();

            elements.dropzone
              .classList
              .add("dragover");

          }
        );

    }
  );


  [
    "dragleave",
    "drop"
  ]
  .forEach(
    eventName => {

      elements.dropzone
        .addEventListener(
          eventName,
          event => {

            event.preventDefault();

            elements.dropzone
              .classList
              .remove("dragover");

          }
        );

    }
  );


  elements.dropzone
    .addEventListener(
      "drop",
      event => {

        const files =
          [
            ...event
              .dataTransfer
              .files
          ]
          .filter(
            file =>
              file.name
                .toLowerCase()
                .endsWith(".json")
          );


        if (!files.length) {

          showToast(
            "Only .json files are supported."
          );

          return;

        }


        handleFiles(files);

      }
    );


  /*
   * ==========================================
   * ADD ANOTHER
   * ==========================================
   */

  $("#addAnother")
    .addEventListener(
      "click",
      () =>
        elements.fileInput.click()
    );


  /*
   * ==========================================
   * REMOVE FILE
   * ==========================================
   */

  document
    .addEventListener(
      "click",
      event => {

        const remove =
          event.target.closest(
            ".remove-file"
          );


        if (!remove) {

          return;

        }


        const type =
          remove.dataset.type;


        const index =
          Number(
            remove.dataset.index
          );


        if (
          type ===
          "followers"
        ) {

          uploadedFiles.followers
            .splice(
              index,
              1
            );

        } else {

          uploadedFiles[type] =
            null;

        }


        rebuildFromUploadedFiles();


        if (
          !uploadedFiles.followers.length &&
          !uploadedFiles.following &&
          !uploadedFiles.unfollowed
        ) {

          elements.dashboard
            .classList
            .add("hidden");

        }


        showToast(
          "File removed."
        );

      }
    );


  /*
   * ==========================================
   * CLEAR ALL
   * ==========================================
   */

  $("#clearAll")
    .addEventListener(
      "click",
      resetData
    );


  /*
   * ==========================================
   * TABS
   * ==========================================
   */

  document
    .querySelectorAll(".tab")
    .forEach(
      tab => {

        tab.addEventListener(
          "click",
          () => {

            document
              .querySelectorAll(".tab")
              .forEach(
                item =>
                  item.classList.remove(
                    "active"
                  )
              );


            tab.classList.add(
              "active"
            );


            state.view =
              tab.dataset.view;


            render();

          }
        );

      }
    );


  /*
   * ==========================================
   * SEARCH
   * ==========================================
   */

  elements.searchInput
    .addEventListener(
      "input",
      event => {

        state.search =
          event.target.value;


        render();

      }
    );


  /*
   * ==========================================
   * SORT
   * ==========================================
   */

  elements.sortSelect
    .addEventListener(
      "change",
      event => {

        state.sort =
          event.target.value;


        render();

      }
    );


  /*
   * ==========================================
   * EXPORT CSV
   * ==========================================
   */

  elements.exportCsv
    .addEventListener(
      "click",
      () => {

        const rows =
          getRows();


        if (!rows.length) {

          showToast(
            "There are no accounts in this view."
          );

          return;

        }


        const csvRows = [

          [
            "username",
            "name",
            "status",
            "date",
            "instagram_url"
          ],

          ...rows.map(
            row => [

              row.username || "",

              row.name || "",

              row.status || "",

              row.timestamp
                ? formatDate(
                    row.timestamp
                  )
                : "",

              row.url || ""

            ]
          )

        ];


        const csv =
          csvRows
            .map(
              row =>
                row
                  .map(
                    value =>
                      `"${String(value)
                        .replace(
                          /"/g,
                          '""'
                        )}"`
                  )
                  .join(",")
            )
            .join("\n");


        const blob =
          new Blob(
            [
              "\ufeff" +
              csv
            ],
            {
              type:
                "text/csv;charset=utf-8"
            }
          );


        const url =
          URL.createObjectURL(
            blob
          );


        const link =
          document.createElement(
            "a"
          );


        link.href =
          url;


        link.download =
          `instagram-${state.view}.csv`;


        link.click();


        URL.revokeObjectURL(
          url
        );


        showToast(
          "CSV exported."
        );

      }
    );


  /*
   * ==========================================
   * INITIAL UI
   * ==========================================
   */

  renderUploadedFiles();

})();
