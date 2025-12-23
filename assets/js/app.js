import { dbManager } from "./duckdb-manager.js";
import { cryptoUtils } from "./crypto-utils.js";

// DOM Elements
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const unlockForm = document.getElementById("unlock-form");
const unlockSubmitForm = document.getElementById("unlock-submit-form");
const unlockPasswordInput = document.getElementById("unlock-password");
const resetVaultBtn = document.getElementById("reset-vault-btn");
const saveSecurelyCheckbox = document.getElementById("save-securely");
const setupMasterPassword = document.getElementById("setup-master-password");

const seriesList = document.getElementById("series-list");
const seasonsGrid = document.getElementById("seasons-grid");
const episodesList = document.getElementById("episodes-list");
const contentArea = document.getElementById("content-area");
const welcomeState = document.getElementById("welcome-state");
const playerContainer = document.getElementById("player-container");
const videoPlayer = document.getElementById("video-player");
const currentSeriesTitle = document.getElementById("current-series-title");
const currentPath = document.getElementById("current-path");
const loadingOverlay = document.getElementById("loading-overlay");
const searchInput = document.getElementById("search-series");
const appBucketSelector = document.getElementById("app-bucket-selector");
const syncStatusBtn = document.getElementById("sync-status");
const logoutBtn = document.getElementById("logout-btn");

// State
let catalog = {};
let currentSeries = null;
let currentSeason = null;
let currentEpisode = null;

// Check URL Params for Auto Login
function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const bucket = urlParams.get("bucket");
  const endpoint = urlParams.get("endpoint");
  const accessKey = urlParams.get("accessKey");
  const secretKey = urlParams.get("secretKey");

  if (bucket && endpoint && accessKey && secretKey) {
    let targetBucket = bucket;
    if (targetBucket === "anime") targetBucket = "animecdn";

    const bucketSelect = document.getElementById("bucket");
    bucketSelect.value = targetBucket;
    document.getElementById("endpoint").value = endpoint;
    document.getElementById("accessKey").value = accessKey;
    document.getElementById("secretKey").value = secretKey;

    return true;
  }
  return false;
}

// Init Logic
window.addEventListener("DOMContentLoaded", () => {
  if (checkUrlParams()) {
    loginForm.classList.remove("hidden");
    unlockForm.classList.add("hidden");
    loginForm.dispatchEvent(new Event("submit"));
    return;
  }

  const savedEncrypted = localStorage.getItem("streamhub_vault");

  if (savedEncrypted) {
    // Show Unlock Form
    loginForm.classList.add("hidden");
    unlockForm.classList.remove("hidden");
  } else {
    // Show Standard Login Form
    // (Optional) Check for old plain text creds and migrate/clear them?
    // For now, let's just ignore them or load them if user wants fallback.
    const savedPlain = localStorage.getItem("streamhub_creds");
    if (savedPlain) {
      try {
        const creds = JSON.parse(savedPlain);
        document.getElementById("endpoint").value = creds.endpoint;
        document.getElementById("bucket").value = creds.bucket;
        document.getElementById("accessKey").value = creds.accessKey;
        document.getElementById("secretKey").value = creds.secretKey;
      } catch (e) {
        console.error("Error loading plain creds", e);
      }
    }
  }
});

// Toggle Master Password Input
saveSecurelyCheckbox.addEventListener("change", (e) => {
  if (e.target.checked) {
    setupMasterPassword.classList.remove("hidden");
    document.getElementById("new-master-password").required = true;
  } else {
    setupMasterPassword.classList.add("hidden");
    document.getElementById("new-master-password").required = false;
  }
});

// Handle Login (First time or reset)
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const endpoint = document.getElementById("endpoint").value;
  const bucket = document.getElementById("bucket").value;
  const accessKey = document.getElementById("accessKey").value;
  const secretKey = document.getElementById("secretKey").value;
  const saveSecurely = saveSecurelyCheckbox.checked;
  const masterPassword = document.getElementById("new-master-password").value;

  if (saveSecurely && !masterPassword) {
    showToast("Inserisci una Master Password", "error");
    return;
  }

  showLoading(true, "Verifica credenziali...");

  try {
    // Verify credentials first by connecting
    await window.s3Manager.connect(endpoint, accessKey, secretKey, bucket);

    // If successful, save if requested
    if (saveSecurely) {
      showLoading(true, "Cifratura in corso...");
      const vaultData = { endpoint, bucket, accessKey, secretKey };
      const encryptedPkg = await cryptoUtils.encrypt(vaultData, masterPassword);
      localStorage.setItem("streamhub_vault", JSON.stringify(encryptedPkg));

      // Clear plain text if exists to upgrade security
      localStorage.removeItem("streamhub_creds");
    } else {
      // Plain save (legacy/insecure) - or user chose not to save securely
      // User might have chosen NOT to save at all?
      // The previous code saved always. Let's assume if not secure, we don't save?
      // Or we save plain text? User asked for "Miglior sicurezza possibile".
      // Let's NOT save if checkbox is unchecked, unless they had plain text before.
      // Actually, let's be strict: If not checked, session only.
      localStorage.removeItem("streamhub_creds");
    }

    await completeLogin(endpoint, accessKey, secretKey, bucket);
  } catch (err) {
    console.error(err);
    showToast("Errore di connessione: " + err.message, "error");
    showLoading(false);
  }
});

// Handle Unlock
unlockSubmitForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = unlockPasswordInput.value;
  const encryptedData = localStorage.getItem("streamhub_vault");

  if (!encryptedData) {
    showToast("Nessun dato salvato trovato.", "error");
    return;
  }

  showLoading(true, "Decifratura...");

  try {
    const pkg = JSON.parse(encryptedData);
    const creds = await cryptoUtils.decrypt(pkg, password);

    // Connect with decrypted creds
    await window.s3Manager.connect(
      creds.endpoint,
      creds.accessKey,
      creds.secretKey,
      creds.bucket
    );
    await completeLogin(
      creds.endpoint,
      creds.accessKey,
      creds.secretKey,
      creds.bucket
    );
  } catch (err) {
    console.error(err);
    showLoading(false);
    showToast("Password errata o dati corrotti", "error");
    unlockPasswordInput.value = "";
    unlockPasswordInput.focus();
  }
});

// Reset Vault
if (resetVaultBtn) {
  resetVaultBtn.addEventListener("click", (e) => {
    e.preventDefault(); // Just in case
    console.log("Reset Vault button clicked");

    if (
      window.confirm("Sei sicuro? Questo cancellerà le credenziali salvate.")
    ) {
      console.log("Resetting vault...");
      localStorage.removeItem("streamhub_vault");
      localStorage.removeItem("streamhub_creds");

      // Clear URL params
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, document.title, url.toString());

      window.location.reload();
    }
  });
} else {
  console.error("Reset Vault Button not found in DOM");
}

// Logout
logoutBtn.addEventListener("click", () => {
  location.reload();
});

// App Bucket Selector Logic
appBucketSelector.addEventListener("change", async (e) => {
  const newBucket = e.target.value;

  // Update hidden login selector so loadCatalog works correctly
  document.getElementById("bucket").value = newBucket;

  showLoading(true, "Cambio bucket in corso...");
  try {
    // Update S3 Manager context
    window.s3Manager.setBucket(newBucket);

    // Sync new progress context (for the new bucket type)
    await dbManager.syncFromS3(newBucket);

    // Reset state
    currentSeries = null;
    currentSeason = null;
    currentEpisode = null;

    // Reload Catalog
    await loadCatalog();

    // Render
    renderSeriesList();

    // Reset View to Welcome
    welcomeState.classList.remove("hidden");
    contentArea.classList.remove("hidden");
    playerContainer.classList.add("hidden");
    seasonsGrid.classList.add("hidden");
    episodesList.classList.add("hidden");

    // Clear content to avoid residues
    seasonsGrid.innerHTML = "";
    episodesList.innerHTML = "";

    // Reset Header
    currentSeriesTitle.innerText = "Seleziona una serie";
    currentPath.innerHTML = "Home";

    videoPlayer.pause();
    videoPlayer.src = "";
  } catch (err) {
    console.error(err);
    showToast("Errore nel cambio bucket: " + err.message, "error");
  } finally {
    showLoading(false);
  }
});

async function completeLogin(endpoint, accessKey, secretKey, bucket) {
  try {
    // Init DuckDB
    showLoading(true, "Avvio Database...");
    await dbManager.init({
      endpoint,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    });

    // Sync Progress
    showLoading(true, "Sincronizzazione progressi...");
    await dbManager.syncFromS3(bucket);

    // Load Catalog
    showLoading(true, "Caricamento catalogo...");
    await loadCatalog();

    // Switch View
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");

    // Sync App Bucket Selector
    appBucketSelector.value = bucket;

    // Render Series List
    renderSeriesList();
  } catch (err) {
    throw err;
  } finally {
    showLoading(false);
  }
}

// Catalog Logic
async function loadCatalog() {
  const objects = await window.s3Manager.listContents();
  const bucketType = document.getElementById("bucket").value;
  catalog = {};

  if (bucketType === "series" || bucketType === "animecdn") {
    // Build Tree: Series -> Season -> Episode
    objects.forEach((obj) => {
      // Ignore hidden files and folders
      if (obj.Key.split("/").some((p) => p.startsWith("."))) return;
      // Ignore streamhub system folder
      if (obj.Key.startsWith("streamhub/")) return;

      const parts = obj.Key.split("/");
      // Expect: Series/Season/Episode
      // Filter out folders (end with /)
      if (obj.Key.endsWith("/")) return;

      let seriesName, seasonName, episodeName;

      if (parts.length >= 3) {
        // Standard Structure: Series/Season/Episode
        seriesName = parts[0];
        seasonName = parts[1];
        episodeName = parts.slice(2).join("/");
      } else if (parts.length === 2) {
        // Flat Series Structure: Series/Episode
        seriesName = parts[0];
        seasonName = "Episodes";
        episodeName = parts[1];
      } else {
        // Root file or unknown structure
        return;
      }

      if (!catalog[seriesName]) catalog[seriesName] = {};
      if (!catalog[seriesName][seasonName])
        catalog[seriesName][seasonName] = [];

      catalog[seriesName][seasonName].push({
        name: episodeName,
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
      });
    });
  } else {
    // Movies: Flat structure
    // Let's just list each movie file as if it were a Series in the sidebar.
    // Since there are no folders, we use the filename (minus extension) as the series name.

    objects.forEach((obj) => {
      // Ignore hidden files and folders
      if (obj.Key.split("/").some((p) => p.startsWith("."))) return;
      // Ignore streamhub system folder
      if (obj.Key.startsWith("streamhub/")) return;

      if (obj.Key.endsWith("/")) return;

      // Remove extension for display
      const name = obj.Key.replace(/\.[^/.]+$/, "");
      const seriesName = name;
      const seasonName = "Movie"; // Virtual season

      if (!catalog[seriesName]) catalog[seriesName] = {};
      if (!catalog[seriesName][seasonName])
        catalog[seriesName][seasonName] = [];

      catalog[seriesName][seasonName].push({
        name: obj.Key, // Full name for episode title
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        isMovie: true,
      });
    });
  }
}

// UI Rendering
function renderSeriesList() {
  seriesList.innerHTML = "";
  const seriesNames = Object.keys(catalog).sort();
  const bucketType = document.getElementById("bucket").value;

  seriesNames.forEach((name) => {
    const div = document.createElement("div");
    div.className =
      "series-item p-2 rounded-lg cursor-pointer flex items-center gap-3 text-gray-300 hover:text-white";

    const icon =
      bucketType === "series" || bucketType === "animecdn"
        ? "fa-folder"
        : "fa-film";

    div.innerHTML = `
            <i class="fas ${icon} series-icon text-gray-500"></i>           <span class="text-sm font-medium truncate">${name}</span>
        `;
    div.onclick = () => selectSeries(name, div);
    seriesList.appendChild(div);
  });
}

// Search Filter
searchInput.addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  const items = seriesList.querySelectorAll(".series-item");
  items.forEach((item) => {
    const name = item.querySelector("span").innerText.toLowerCase();
    if (name.includes(term)) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }
  });
});

async function selectSeries(name, el) {
  try {
    console.log("Selecting series:", name);
    // Highlight
    document
      .querySelectorAll(".series-item")
      .forEach((i) => i.classList.remove("active"));
    el.classList.add("active");

    currentSeries = name;
    currentSeason = null;
    currentEpisode = null;

    const bucketType = document.getElementById("bucket").value;
    console.log("Bucket type:", bucketType);

    if (bucketType === "movie") {
      // Direct play or show "Movie" season?
      // Let's show the "Movie" item in the episode list view directly.
      currentSeriesTitle.innerText = name;
      currentPath.innerHTML = `Home <i class="fas fa-chevron-right text-[10px]"></i> ${name}`;

      welcomeState.classList.add("hidden");
      playerContainer.classList.add("hidden");
      seasonsGrid.classList.add("hidden");
      episodesList.classList.remove("hidden");

      // Virtual "Movie" season
      const season = "Movie";
      currentSeason = season;

      if (!catalog[name] || !catalog[name][season]) {
        throw new Error(`Catalog entry missing for ${name}`);
      }

      const episodes = catalog[name][season]; // Should be array of 1

      // Auto-play if it's a single movie file
      if (episodes.length === 1) {
        console.log("Auto-playing movie:", episodes[0].name);
        playEpisode(episodes[0]);
      } else {
        renderEpisodesList(episodes);
      }

      return;
    }

    currentSeriesTitle.innerText = name;
    currentPath.innerHTML = `Home <i class="fas fa-chevron-right text-[10px]"></i> ${name}`;

    // Show Seasons
    welcomeState.classList.add("hidden");
    playerContainer.classList.add("hidden");
    episodesList.classList.add("hidden");
    seasonsGrid.classList.remove("hidden");
    seasonsGrid.innerHTML = "";

    if (!catalog[name]) {
      throw new Error(`Catalog entry missing for ${name}`);
    }

    const seasons = Object.keys(catalog[name]).sort(naturalSort);

    if (seasons.length === 0) {
      showToast("Nessun episodio trovato per questa serie", "warning");
      return;
    }

    // Render Seasons immediately (Optimistic UI)
    seasons.forEach((season) => {
      const seasonData = catalog[name][season];
      const episodeCount = seasonData.length;

      const card = document.createElement("div");
      // Add data-season attribute for later update
      card.dataset.season = season;
      card.className =
        "glass-panel p-6 rounded-xl border border-glassBorder hover:border-primary/50 transition-all cursor-pointer group relative overflow-hidden";

      // Initial render with 0 progress
      card.innerHTML = `
              <div class="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-secondary opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <h3 class="text-xl font-bold mb-2">${season}</h3>
              <p class="text-sm text-gray-400 mb-4">${episodeCount} Episodi</p>
              
              <div class="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                  <div class="progress-bar h-full bg-gradient-to-r from-primary to-secondary" style="width: 0%"></div>
              </div>
              <div class="watched-count mt-2 text-xs text-right text-gray-400">0/${episodeCount} visti</div>
          `;
      card.onclick = () => selectSeason(season);
      seasonsGrid.appendChild(card);
    });

    // Fetch progress in background to update UI
    loadSeriesProgress(name, seasons);
  } catch (err) {
    console.error("Error in selectSeries:", err);
    showToast("Errore apertura: " + err.message, "error");
  }
}

async function loadSeriesProgress(name, seasons) {
  try {
    console.log("Fetching progress for series:", name);
    const progressData = await dbManager.getSeriesProgress(name);

    const progressMap = {};
    progressData.forEach((p) => {
      if (!progressMap[p.season])
        progressMap[p.season] = { total: 0, watched: 0 };
      progressMap[p.season].total++;
      if (p.completed) progressMap[p.season].watched++;
    });

    seasons.forEach((season) => {
      // Find the card
      const card = seasonsGrid.querySelector(
        `div[data-season="${season.replace(/"/g, '\\"')}"]`
      );
      if (!card) return;

      const seasonData = catalog[name][season];
      const episodeCount = seasonData.length;
      const watchedCount = progressMap[season]
        ? progressMap[season].watched
        : 0;
      const progressPercent = (watchedCount / episodeCount) * 100;

      // Update elements
      const progressBar = card.querySelector(".progress-bar");
      const watchedText = card.querySelector(".watched-count");

      if (progressBar) progressBar.style.width = `${progressPercent}%`;
      if (watchedText)
        watchedText.innerText = `${watchedCount}/${episodeCount} visti`;
    });
  } catch (err) {
    console.error("Error loading progress:", err);
    // Don't show toast to avoid annoying user if just badges fail
  }
}

function selectSeason(season) {
  currentSeason = season;
  currentPath.innerHTML = `Home <i class="fas fa-chevron-right text-[10px]"></i> ${currentSeries} <i class="fas fa-chevron-right text-[10px]"></i> ${season}`;

  seasonsGrid.classList.add("hidden");
  episodesList.classList.remove("hidden");

  const episodes = catalog[currentSeries][season].sort((a, b) =>
    naturalSort(a.name, b.name)
  );

  renderEpisodesList(episodes);
}

function renderEpisodesList(episodes) {
  episodesList.innerHTML = "";
  episodes.forEach((ep) => {
    const row = document.createElement("div");
    row.className =
      "episode-item glass-panel p-4 rounded-lg border border-glassBorder flex items-center justify-between cursor-pointer group";
    row.dataset.episodeName = ep.name;

    // Initial render (optimistic)
    row.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                    <i class="fas fa-play text-xs status-icon"></i>
                </div>
                <div>
                    <h4 class="font-medium text-sm">${ep.name}</h4>
                    <p class="text-xs text-gray-400">${formatBytes(ep.size)}</p>
                </div>
            </div>
            <div class="resume-info"></div>
        `;
    row.onclick = () => playEpisode(ep);
    episodesList.appendChild(row);

    // Fetch progress asynchronously without blocking render
    updateEpisodeProgress(ep, row);
  });
}

async function updateEpisodeProgress(ep, row) {
  try {
    const progress = await dbManager.getProgress(
      currentSeries,
      currentSeason,
      ep.name
    );
    const isWatched = progress.length > 0 && progress[0].completed;
    const timestamp = progress.length > 0 ? progress[0].timestamp : 0;

    const icon = row.querySelector(".status-icon");
    const resumeContainer = row.querySelector(".resume-info");

    if (isWatched) {
      icon.classList.remove("fa-play");
      icon.classList.add("fa-check");
    }

    if (timestamp > 0 && !isWatched) {
      resumeContainer.innerHTML = `<span class="text-xs text-primary bg-primary/10 px-2 py-1 rounded">Resume ${formatTime(
        timestamp
      )}</span>`;
    }
  } catch (err) {
    console.error("Error updating progress for episode:", ep.name, err);
  }
}

async function playEpisode(ep) {
  currentEpisode = ep;

  // Get Signed URL
  const url = window.s3Manager.getSignedUrl(ep.key);

  episodesList.classList.add("hidden");
  playerContainer.classList.remove("hidden");

  document.getElementById("playing-title").innerText = ep.name;
  document.getElementById(
    "playing-info"
  ).innerText = `${currentSeries} • ${currentSeason}`;

  videoPlayer.src = url;

  // Resume
  const progress = await dbManager.getProgress(
    currentSeries,
    currentSeason,
    ep.name
  );
  if (progress.length > 0 && progress[0].timestamp) {
    videoPlayer.currentTime = progress[0].timestamp;
  }

  videoPlayer.play();
}

// Player Events
videoPlayer.addEventListener("timeupdate", () => {
  // Save every 5 seconds or so?
  // Or just let 'pause' handle the big saves, but keep local state?
  // We'll save on pause/unload to DB.
});

videoPlayer.addEventListener("pause", async () => {
  if (!currentEpisode) return;
  await saveProgress();
  // Sync to S3 on pause
  try {
    await dbManager.syncToS3(window.s3Manager.bucket);
    showToast("Progressi salvati", "success");
  } catch (e) {
    showToast("Errore salvataggio S3: " + e.message, "error");
  }
});

videoPlayer.addEventListener("ended", async () => {
  if (!currentEpisode) return;
  await saveProgress(true); // Completed
  try {
    await dbManager.syncToS3(window.s3Manager.bucket);
    showToast("Episodio completato!", "success");
  } catch (e) {
    showToast("Errore salvataggio S3: " + e.message, "error");
  }
});

async function saveProgress(completed = false) {
  const time = videoPlayer.currentTime;
  const duration = videoPlayer.duration;

  // Mark as completed if > 90% watched
  if (!completed && duration > 0 && time > duration * 0.9) {
    completed = true;
  }

  await dbManager.updateProgress(
    currentSeries,
    currentSeason,
    currentEpisode.name,
    time,
    duration,
    completed
  );
}

// Helpers
function showLoading(show, text = "") {
  if (show) {
    loadingOverlay.classList.remove("hidden");
    document.getElementById("loading-text").innerText = text;
  } else {
    loadingOverlay.classList.add("hidden");
  }
}

function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  document.getElementById("toast-message").innerText = msg;
  toast.classList.remove("opacity-0", "translate-y-20");
  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-20");
  }, 3000);
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
