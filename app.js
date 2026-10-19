const MARKETS = ["pass_attempts", "carries", "targets", "receptions"];
const PRETTY = {
  pass_attempts: "pass attempts", carries: "carries",
  targets: "targets", receptions: "receptions",
};
let DATA = null;
let filter = { market: "all", day: "all" };

const $ = (id) => document.getElementById(id);
const num = (x) => (x === "" || x == null ? null : Number(x));
const niceDate = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString(undefined,
    { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

Promise.all([
  fetch("selections.json").then((r) => r.json()),
  fetch("results.json").then((r) => r.json()).catch(() => null),
]).then(([selections, results]) => {
  DATA = { selections, results };
  boot();
}).catch(() => {
  $("stamp").textContent = "Could not load the data.";
});

function boot() {
  const s = DATA.selections;
  $("stamp").textContent = "Model run " + (s.as_of || "unknown") + " UTC";
  $("built").textContent = "Page built " + s.generated_at;

  buildNav();
  buildBoard();
  buildResults();
  buildMethod();
  show(location.hash.replace("#", "") || "board");
}

function buildNav() {
  document.querySelectorAll(".rail a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      show(a.getAttribute("href").replace("#", ""));
    });
  });
  // A bookmarked or shared link lands on a hash, and the back button changes
  // one without reloading. Without this, either would leave the wrong page
  // showing while the address bar claimed otherwise.
  window.addEventListener("hashchange", () => {
    const name = location.hash.replace("#", "") || "board";
    if (document.getElementById("page-" + name)) show(name);
  });
}

function show(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.id === "page-" + name));
  document.querySelectorAll(".rail a").forEach((a) =>
    a.classList.toggle("on", a.getAttribute("href") === "#" + name));
  location.hash = name;
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------- board --- */
function buildBoard() {
  const legs = DATA.selections.selections || [];
  const bar = DATA.selections.entry_bar || [];

  const tiles = $("board-tiles");
  const games = new Set(legs.map((l) => l.game)).size;
  const sides = new Set(legs.map((l) => l.our_side));
  const two = bar.find((b) => num(b.legs) === 2);
  tile(tiles, "Legs priced", legs.length, games + " games");
  tile(tiles, "Markets", new Set(legs.map((l) => l.market)).size, "of four modelled");
  if (two) {
    tile(tiles, "A 2-pick leg needs", (num(two.unrelated) * 100).toFixed(1) + "%",
      "stacked " + (num(two.stacked) * 100).toFixed(1) + "%");
  }
  tile(tiles, "Sides", sides.size === 1 ? [...sides][0] + " only" : [...sides].join(" / "),
    sides.size === 1 ? "one-sided, see below" : "both directions");

  if (legs.length > 1 && sides.size === 1) {
    $("board-warning").hidden = false;
    $("board-warning").innerHTML =
      "<strong>Every leg is on the " + [...sides][0].toLowerCase() + ".</strong> " +
      "That is the signature of a model with a lean, not a slate of findings. " +
      "A market is not wrong in one direction on every player at once.";
  }

  const days = [...new Set(legs.map((l) => l.gameday))].sort();
  const chips = $("board-filters");
  chipFor(chips, "market", "all", "All markets");
  MARKETS.filter((m) => legs.some((l) => l.market === m))
    .forEach((m) => chipFor(chips, "market", m, PRETTY[m]));
  if (days.length > 1) {
    const gap = document.createElement("span");
    gap.style.width = ".6rem";
    chips.appendChild(gap);
    chipFor(chips, "day", "all", "All days");
    days.forEach((d) => chipFor(chips, "day", d, niceDate(d)));
  }
  drawBoard();

  const barWrap = $("entry-bar");
  bar.forEach((r) => {
    const cell = document.createElement("div");
    cell.className = "tile";
    cell.innerHTML = '<div class="label"></div><div class="value"></div><div class="foot"></div>';
    cell.querySelector(".label").textContent = r.legs + " picks at " + num(r.multiplier) + "x";
    cell.querySelector(".value").textContent = (num(r.unrelated) * 100).toFixed(1) + "%";
    cell.querySelector(".foot").textContent = "stacked " + (num(r.stacked) * 100).toFixed(1) + "%";
    barWrap.appendChild(cell);
  });
}

function chipFor(into, kind, value, label) {
  const b = document.createElement("button");
  b.className = "chip" + (filter[kind] === value ? " on" : "");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => {
    filter[kind] = value;
    into.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
    [...into.querySelectorAll(".chip")].forEach((c) => {
      // re-mark the active chip in each group
    });
    refreshChips();
    drawBoard();
  });
  b.dataset.kind = kind;
  b.dataset.value = value;
  into.appendChild(b);
}

function refreshChips() {
  document.querySelectorAll("#board-filters .chip").forEach((c) => {
    c.classList.toggle("on", filter[c.dataset.kind] === c.dataset.value);
  });
}

function drawBoard() {
  const root = $("board");
  root.textContent = "";
  let legs = DATA.selections.selections || [];
  if (filter.market !== "all") legs = legs.filter((l) => l.market === filter.market);
  if (filter.day !== "all") legs = legs.filter((l) => l.gameday === filter.day);

  if (!legs.length) {
    root.innerHTML = '<p class="empty">Nothing matches that filter.</p>';
    return;
  }

  const games = new Map();
  legs.forEach((l) => {
    const key = l.gameday + "|" + l.game;
    if (!games.has(key)) games.set(key, []);
    games.get(key).push(l);
  });

  [...games.keys()].sort().forEach((key) => {
    const parts = key.split("|");
    const box = document.createElement("div");
    box.className = "fixture";

    const head = document.createElement("div");
    head.className = "head";
    const teams = document.createElement("span");
    teams.className = "teams";
    teams.textContent = parts[1];
    const when = document.createElement("span");
    when.className = "when";
    const inGame = games.get(key);
    const stackable = inGame.some((l) => l.market === "pass_attempts") &&
      inGame.some((l) => l.market === "targets" || l.market === "receptions");
    when.textContent = niceDate(parts[0]) + (stackable ? " · stackable" : "");
    head.appendChild(teams);
    head.appendChild(when);
    box.appendChild(head);

    inGame.sort((a, b) => MARKETS.indexOf(a.market) - MARKETS.indexOf(b.market))
      .forEach((l) => {
        const row = document.createElement("div");
        row.className = "leg";
        const who = document.createElement("div");
        who.className = "who";
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = l.player;
        const mkt = document.createElement("div");
        mkt.className = "mkt";
        mkt.textContent = PRETTY[l.market] || l.market;
        who.appendChild(name);
        who.appendChild(mkt);

        const nums = document.createElement("div");
        nums.className = "nums";
        const side = document.createElement("div");
        side.className = "side " + (l.our_side === "Higher" ? "up" : "down");
        side.textContent = l.our_side + " " + l.underdog_line;
        const model = document.createElement("div");
        model.className = "model";
        model.textContent = "model " + l.model;
        nums.appendChild(side);
        nums.appendChild(model);

        row.appendChild(who);
        row.appendChild(nums);
        box.appendChild(row);
      });
    root.appendChild(box);
  });
}

/* ----------------------------------------------------------- results --- */
function buildResults() {
  const r = DATA.results;
  if (!r) {
    $("results-body").innerHTML = '<p class="empty">No results data.</p>';
    return;
  }

  const rec = r.bet_record || {};
  const tiles = $("record-tiles");
  tile(tiles, "Paper bets recorded", rec.recorded ?? 0, "nothing staked");
  tile(tiles, "Settled", rec.settled ?? 0,
    rec.settled ? "graded against results" : "no games played yet");
  tile(tiles, "Record", rec.settled ? rec.won + "–" + rec.lost : "—",
    "won / lost");
  tile(tiles, "Claimed vs actual",
    rec.expected_wins != null ? rec.won + " vs " + rec.expected_wins : "—",
    "the number that matters");

  const table = $("accuracy");
  const best = Math.max(...r.markets.map((m) => 1 - m.ratio));
  r.markets.forEach((m) => {
    const tr = document.createElement("tr");
    const share = (1 - m.ratio);
    tr.innerHTML =
      '<td class="text"></td><td></td><td></td><td></td><td></td>' +
      '<td class="bar-cell"><div class="bar-track"><div class="bar-fill"></div></div></td>';
    const cells = tr.querySelectorAll("td");
    cells[0].textContent = m.market;
    cells[1].textContent = m.games_tested.toLocaleString();
    cells[2].textContent = m.model_error.toFixed(2);
    cells[3].textContent = m.naive_error.toFixed(2);
    cells[4].textContent = m.flat_error.toFixed(2);
    tr.querySelector(".bar-fill").style.width =
      Math.max(2, (share / best) * 100).toFixed(0) + "%";
    tr.querySelector(".bar-cell").title = (share * 100).toFixed(1) + "% better than a flat guess";
    table.appendChild(tr);
  });

  const closest = r.markets.slice().sort((a, b) => a.beats_naive_by - b.beats_naive_by)[0];
  $("results-note").innerHTML =
    "<strong>Read the third and fourth columns together.</strong> " +
    "The model beats a flat guess comfortably, but most of that is simply " +
    "knowing who the player is. Against a player's own recent average it " +
    "gains between " + closest.beats_naive_by.toFixed(2) + " and " +
    Math.max(...r.markets.map((m) => m.beats_naive_by)).toFixed(2) +
    " per game, which is small against misses of " +
    r.markets.map((m) => m.typical_miss.toFixed(1)).join(", ") + ".";
}

/* ------------------------------------------------------------ method --- */
function buildMethod() {
  const r = DATA.results;
  if (!r) return;
  $("method-seasons").textContent = r.test_seasons;
}

function tile(into, label, value, foot) {
  const el = document.createElement("div");
  el.className = "tile";
  el.innerHTML = '<div class="label"></div><div class="value"></div><div class="foot"></div>';
  el.querySelector(".label").textContent = label;
  el.querySelector(".value").textContent = value;
  el.querySelector(".foot").textContent = foot || "";
  into.appendChild(el);
}
