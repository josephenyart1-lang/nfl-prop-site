const MARKETS = ["pass_attempts", "carries", "targets", "receptions"];
const PRETTY = {
  pass_attempts: "pass attempts", carries: "carries",
  targets: "targets", receptions: "receptions",
};
let DATA = null;
let filter = { week: null };   /* set to a real week once the data loads */
/* What a single leg of a 2-pick entry has to clear to be worth including.
   Read from the entry bar rather than hardcoded, so it follows Underdog's
   payouts if they change. */
let legBar = null;

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
  buildCalibration();
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
  legBar = two ? num(two.unrelated) : null;
  const priced = legs.filter((l) => num(l.our_probability) != null);
  const clearing = priced.filter((l) => legBar && num(l.our_probability) >= legBar);
  const noView = priced.filter((l) => num(l.our_probability) < 0.5);

  tile(tiles, "Legs priced", legs.length, games + " games");
  if (two) {
    tile(tiles, "A 2-pick leg needs", (num(two.unrelated) * 100).toFixed(1) + "%",
      "stacked " + (num(two.stacked) * 100).toFixed(1) + "%");
  }
  if (priced.length) {
    tile(tiles, "Clear that bar", clearing.length + " of " + priced.length,
      noView.length ? noView.length + " are not calls at all" : "the rest fall short");
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

  /* Week is the only filter. Slicing by market cut a game into four lists
     and hid the thing worth seeing, which is everything one game offers in
     one place -- a quarterback beside his own receivers is the one pairing
     that helps a multi-pick entry, and a market filter breaks that up. */
  const weeks = [...new Set(legs.map((l) => l.week))]
    .filter((w) => w != null && w !== "")
    .sort((a, b) => Number(a) - Number(b));

  /* One week at a time, so there is no "all" to fall back to. The week
     that opens is the one still to be played: the earliest holding a game
     that has not kicked off yet, and the last week otherwise, so an old
     board does not open on a stale slate. */
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = weeks.find((w) =>
    legs.some((l) => String(l.week) === String(w) && l.gameday >= today));
  filter.week = String(upcoming != null ? upcoming : weeks[weeks.length - 1]);

  const chips = $("board-filters");
  weeks.forEach((w) => chipFor(chips, "week", String(w), "Week " + w));
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
  if (filter.week != null) {
    legs = legs.filter((l) => String(l.week) === String(filter.week));
  }

  if (!legs.length) {
    root.innerHTML = '<p class="empty">No priced legs in that week.</p>';
    return;
  }

  /* Week first, then the games inside it. A board that runs past a
     Thursday holds two weeks at once -- a Monday night game closing one
     and a Thursday opening the next -- and a flat list of fixtures gives
     no sign of where one ends and the other begins. */
  const byWeek = new Map();
  legs.forEach((l) => {
    const week = l.week == null || l.week === "" ? "" : String(l.week);
    if (!byWeek.has(week)) byWeek.set(week, new Map());
    const games = byWeek.get(week);
    const key = l.gameday + "|" + l.game;
    if (!games.has(key)) games.set(key, []);
    games.get(key).push(l);
  });

  /* Blank weeks last; everything else in order. */
  const weeks = [...byWeek.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return Number(a) - Number(b);
  });

  weeks.forEach((week) => {
    const games = byWeek.get(week);
    const count = [...games.values()].reduce((n, rows) => n + rows.length, 0);
    const heading = document.createElement("h3");
    heading.className = "week";
    const title = document.createElement("span");
    title.textContent = week ? "Week " + week : "Week not known";
    const meta = document.createElement("span");
    meta.className = "week-meta";
    meta.textContent = count + (count === 1 ? " leg" : " legs") + " · "
      + games.size + (games.size === 1 ? " game" : " games");
    heading.appendChild(title);
    heading.appendChild(meta);
    root.appendChild(heading);

    /* The week's games scroll inside their own box, so the week buttons
       and the heading stay put while a full slate is read through. */
    const scroller = document.createElement("div");
    scroller.className = "week-games";
    root.appendChild(scroller);
    drawWeek(scroller, games);
  });
}

function drawWeek(root, games) {
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
        /* The model only uses a binary "on the report or not", and only
           for targets. The words are here because a reader deciding on a
           prop wants more than a flag, and because the back model does not
           use this at all -- the warning has to come from somewhere. */
        if (l.injury) {
          const flag = document.createElement("div");
          flag.className = "injury";
          flag.textContent = l.injury;
          who.appendChild(flag);
        }

        const nums = document.createElement("div");
        nums.className = "nums";
        const chance = num(l.our_probability);
        /* The side is picked by disagreeing with Underdog, not by which
           outcome is likelier, so the model can land on a side it expects
           to lose. Printing "Lower 3.5" for a 44% call reads as a
           recommendation it is not, so no side is shown at all. */
        const noView = chance != null && chance < 0.5;

        const side = document.createElement("div");
        side.className = "side " + (noView ? "noview"
          : (l.our_side === "Higher" ? "up" : "down"));
        side.textContent = noView ? "no view at " + l.underdog_line
          : l.our_side + " " + l.underdog_line;

        const model = document.createElement("div");
        model.className = "model";
        if (chance != null) {
          const pct = document.createElement("span");
          pct.className = "pct" + (!noView && legBar && chance >= legBar ? " clears" : "");
          /* One decimal, to match the bar it is being compared against. A
             leg at 57.70% rounded to "58%" sitting unmarked beside a bar of
             "57.7%" looks like a mistake rather than a near miss. */
          pct.textContent = (chance * 100).toFixed(1) + "%";
          pct.title = noView
            ? "The model gives this side less than an even chance."
            : (legBar && chance >= legBar
              ? "Clears the bar a 2-pick entry needs."
              : "Below the bar a 2-pick entry needs.");
          model.appendChild(pct);
          model.appendChild(document.createTextNode(" · "));
        }
        model.appendChild(document.createTextNode("model " + l.model));
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

  const rec = r.prop_record || {};
  const tiles = $("record-tiles");
  tile(tiles, "Player props recorded", rec.recorded ?? 0,
    rec.weeks ? "across " + rec.weeks + (rec.weeks === 1 ? " week" : " weeks")
      : "nothing staked");
  tile(tiles, "Settled", rec.settled ?? 0,
    rec.voided ? rec.voided + (rec.voided === 1 ? " void" : " voided")
                 + ", not counted"
      : (rec.settled ? "graded against results" : "no games played yet"));
  tile(tiles, "Model right", rec.settled ? rec.right + "–" + rec.wrong : "—",
    "right / wrong");
  tile(tiles, "Claimed vs actual",
    rec.expected_right != null ? rec.right + " vs " + rec.expected_right : "—",
    "the number that matters");

  drawByGame(rec.games || []);
  drawSettled(rec.settled_props || []);

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

function drawByGame(games) {
  const body = $("by-game");
  if (!body) return;
  body.textContent = "";
  if (!games.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 8;
    cell.className = "text";
    cell.textContent = "No props recorded yet.";
    return;
  }
  games.forEach((g) => {
    const row = body.insertRow();
    const cells = [];
    for (let i = 0; i < 8; i++) cells.push(row.insertCell());
    cells[0].textContent = g.week ? "Week " + g.week : "—";
    cells[1].textContent = g.game;
    cells[1].className = "text";
    cells[2].textContent = g.recorded;
    cells[3].textContent = g.settled;
    /* Nothing is claimed about a game that has not been played, so a dash
       rather than a zero: 0-0 reads like the model got everything wrong. */
    cells[4].textContent = g.settled ? g.right : "—";
    cells[5].textContent = g.settled ? g.wrong : "—";
    cells[6].textContent = g.voided ? g.voided : "—";
    cells[7].textContent = g.expected_right != null ? g.expected_right : "—";
    if (!g.settled) row.className = "pending";
  });
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

const OUTCOME = { right: "landed", wrong: "missed", push: "push", void: "void" };

function drawSettled(rows) {
  const host = $("settled-props");
  if (!host) return;
  host.textContent = "";
  if (!rows.length) {
    host.innerHTML = '<p class="empty">Nothing has resolved yet.</p>';
    return;
  }

  /* Grouped by game, the same way the board groups them, so a week with
     several games does not become one long undifferentiated list. */
  const games = new Map();
  rows.forEach((r) => {
    const key = (r.week || "?") + "|" + r.game;
    if (!games.has(key)) games.set(key, []);
    games.get(key).push(r);
  });

  games.forEach((props, key) => {
    const parts = key.split("|");
    const right = props.filter((p) => p.status === "right").length;
    const wrong = props.filter((p) => p.status === "wrong").length;
    const voided = props.filter((p) => p.status === "void").length;

    const heading = document.createElement("h3");
    heading.className = "week";
    const title = document.createElement("span");
    title.textContent = "Week " + parts[0] + " · " + parts[1];
    const meta = document.createElement("span");
    meta.className = "week-meta";
    meta.textContent = right + " landed, " + wrong + " missed"
      + (voided ? ", " + voided + " void" : "");
    heading.appendChild(title);
    heading.appendChild(meta);
    host.appendChild(heading);

    const scroll = document.createElement("div");
    scroll.className = "scroll";
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Player</th><th>Market</th>"
      + "<th>Our call</th><th>We said</th><th>Model</th><th>Actual</th>"
      + "<th>Result</th></tr></thead><tbody></tbody>";
    const body = table.querySelector("tbody");

    props.forEach((p) => {
      const row = body.insertRow();
      row.className = "outcome-" + p.status;
      const cells = [];
      for (let i = 0; i < 7; i++) cells.push(row.insertCell());
      cells[0].textContent = p.player;
      cells[0].className = "text";
      cells[1].textContent = PRETTY[p.market] || p.market;
      cells[1].className = "text";
      cells[2].textContent = p.our_side + " " + p.underdog_line;
      cells[3].textContent = p.our_probability != null
        ? (num(p.our_probability) * 100).toFixed(1) + "%" : "—";
      cells[4].textContent = p.model;
      cells[5].textContent = p.actual === "" || p.actual == null
        ? "—" : p.actual;
      cells[6].textContent = OUTCOME[p.status] || p.status;
      cells[6].className = "verdict " + p.status;
      /* A void is explained on the row rather than in a footnote, because
         an unexplained void is the kind of thing a reader should distrust. */
      if (p.note) cells[6].title = p.note;
    });
    scroll.appendChild(table);
    host.appendChild(scroll);

    if (voided) {
      const why = props.find((p) => p.status === "void" && p.note);
      if (why) {
        const note = document.createElement("p");
        note.className = "empty";
        note.textContent = "Void: " + why.player + " — " + why.note;
        host.appendChild(note);
      }
    }
  });
}

/* ------------------------------------------------------- calibration --- */
/* One colour per market, in the order export_results writes them. */
const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
const SVG_NS = "http://www.w3.org/2000/svg";

function svgNode(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const key in attrs) el.setAttribute(key, attrs[key]);
  return el;
}

function label(svg, text, attrs) {
  const el = svgNode("text", attrs);
  el.textContent = text;          /* never innerHTML, even for our own data */
  svg.appendChild(el);
  return el;
}

function buildCalibration() {
  const host = $("calibration");
  const note = $("calibration-note");
  const markets = ((DATA.results && DATA.results.markets) || [])
    .filter((m) => (m.calibration || []).length);
  if (!markets.length) {
    host.innerHTML = '<p class="empty">Calibration has not been measured yet.</p>';
    note.hidden = true;
    return;
  }

  /* A square plot, because both axes are the same thing and the diagonal
     has to look like 45 degrees for the chart to be readable at a glance. */
  const SIDE = 300, L = 44, T = 10, R = 12, B = 46;
  const W = L + SIDE + R, H = T + SIDE + B;
  const x = (p) => L + p * SIDE;
  const y = (p) => T + (1 - p) * SIDE;

  const svg = svgNode("svg", {
    viewBox: "0 0 " + W + " " + H, role: "img",
    "aria-label": "What the model said, against how often it happened, " +
      "for each market. A perfectly honest model sits on the diagonal.",
  });

  for (let i = 0; i <= 4; i++) {
    const p = i / 4;
    svg.appendChild(svgNode("line", { x1: x(0), y1: y(p), x2: x(1), y2: y(p),
      stroke: "var(--line)", "stroke-width": 1 }));
    svg.appendChild(svgNode("line", { x1: x(p), y1: y(0), x2: x(p), y2: y(1),
      stroke: "var(--line)", "stroke-width": 1 }));
    label(svg, p * 100 + "%", { x: x(0) - 8, y: y(p) + 3.5,
      "text-anchor": "end", class: "tick" });
    label(svg, p * 100 + "%", { x: x(p), y: y(0) + 17,
      "text-anchor": "middle", class: "tick" });
  }

  /* Well calibrated lines all land on the diagonal, which makes four honest
     markets look like one line and says nothing about how close is close.
     The band is everything within five points of honest, so the eye has
     something to measure against. Drawn before the data, to sit under it. */
  svg.appendChild(svgNode("polygon", {
    points: [[0, 0.05], [0.95, 1], [1, 1], [1, 0.95], [0.05, 0], [0, 0]]
      .map((p) => x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join(" "),
    fill: "var(--accent)", "fill-opacity": 0.1,
  }));
  svg.appendChild(svgNode("line", { x1: x(0), y1: y(0), x2: x(1), y2: y(1),
    stroke: "var(--muted)", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));

  label(svg, "the model said", { x: x(0.5), y: H - 6,
    "text-anchor": "middle", class: "axis" });
  label(svg, "it happened this often", { x: 12, y: y(0.5),
    "text-anchor": "middle", class: "axis",
    transform: "rotate(-90 12 " + y(0.5) + ")" });

  markets.forEach((market, i) => {
    const colour = SERIES[i % SERIES.length];
    const points = market.calibration
      .map((r) => x(r.said).toFixed(1) + "," + y(r.happened).toFixed(1))
      .join(" ");
    svg.appendChild(svgNode("polyline", { points, fill: "none", stroke: colour,
      "stroke-width": 2, "stroke-linejoin": "round" }));
    market.calibration.forEach((r) => {
      const dot = svgNode("circle", { cx: x(r.said).toFixed(1),
        cy: y(r.happened).toFixed(1), r: 3, fill: colour });
      const title = svgNode("title", {});
      title.textContent = market.market + ": said " + pct(r.said) +
        ", happened " + pct(r.happened) + " over " +
        r.cases.toLocaleString() + " cases";
      dot.appendChild(title);
      svg.appendChild(dot);
    });
  });

  host.textContent = "";
  host.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "legend";
  markets.forEach((market, i) => {
    const item = document.createElement("span");
    item.innerHTML = '<i></i><b></b>';
    item.querySelector("i").style.background = SERIES[i % SERIES.length];
    item.querySelector("b").textContent = market.market;
    legend.appendChild(item);
  });
  [["perfectly honest", "dash"], ["within 5 points", "band"]].forEach((pair) => {
    const item = document.createElement("span");
    item.innerHTML = '<i class="' + pair[1] + '"></i><b></b>';
    item.querySelector("b").textContent = pair[0];
    legend.appendChild(item);
  });
  host.appendChild(legend);

  /* The headline number is the worst single band, not the average, because
     an average over ten bands hides the one that would cost money. */
  let worst = { off: 0 };
  let cases = 0;
  markets.forEach((m) => m.calibration.forEach((r) => {
    cases += r.cases;
    const off = Math.abs(r.happened - r.said);
    if (off > worst.off) worst = { off, band: r.band, market: m.market };
  }));
  note.hidden = false;
  note.innerHTML =
    "<strong>Worst band is off by " + (worst.off * 100).toFixed(1) +
    " points</strong> (" + worst.market.toLowerCase() + ", claims of " +
    worst.band + "), measured over " + cases.toLocaleString() +
    " priced cases. That is close enough to take the probabilities at face " +
    "value &mdash; but being honest about its own uncertainty is not an " +
    "edge. A sportsbook is well calibrated too, and charges for the " +
    "privilege. Beating one needs the model to be right where the book is " +
    "wrong, which this has not shown.";
}

function pct(p) { return (p * 100).toFixed(0) + "%"; }
