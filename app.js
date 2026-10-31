const MARKETS = ["pass_attempts", "carries", "targets", "receptions"];
const PRETTY = {
  pass_attempts: "pass attempts", carries: "carries",
  targets: "targets", receptions: "receptions",
};
let DATA = null;
let filter = { week: null, game: null };  /* set once the data loads */
let entryBar = null;          /* a payout actually seen on an entry screen */
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

/* One plain sentence for the colour, where it is first seen. The
   figures stay in the note above the legs: repeating them here would be
   two places to go stale and one more number to read before the board
   makes sense.

   It also gives both swatches a tooltip. They had none, so the sentence
   looked like it had more to say on hover and then said nothing. A
   `title` never appears on a touch screen at all, which is the other
   reason the sentence has to stand up without one. */
function amberKey(doubt) {
  const host = $("amber-key");
  if (host) {
    if (doubt) {
      host.innerHTML = "A percentage in <b class=\"pct doubted\">amber</b> "
        + "is a " + doubt.name + " call. " + doubt.name + " calls have been "
        + "landing well short of the chance they claim, so they are never "
        + "shown in green, however high they read. The note above the legs "
        + "has the numbers.";
    } else {
      /* No side is failing, so no leg is amber and the key would be
         describing a colour that is not on the board. */
      host.textContent = "";
    }
  }
  /* After the rewrite, not before: writing the sentence replaces the
     amber swatch with a fresh element, and the first version of this
     titled the one it had just thrown away. */
  [...document.querySelectorAll(".lede b.pct")].forEach((b) => {
    b.title = b.classList.contains("clears")
      ? "Clears the bar one leg of an entry has to beat."
      : "The record says claims on this side land short of what they say.";
    b.style.cursor = "help";
  });
}

/* Which side of the line the record says not to trust, if either.

   The board prints a claimed chance per leg and marks the ones above the
   entry bar, which reads a Higher claim and a Lower claim as the same
   kind of statement. The record says they are not the same: `sideSplit`
   has the measurement. Only a shortfall is acted on -- a side landing
   MORE often than it claimed is not a reason to withhold anything -- and
   only one worth believing, at the two-standard-deviation cut used
   elsewhere on the page. Read from the data, so it follows the shortfall
   if it moves, shrinks, or changes sides. */
function doubtedSide(results) {
  const sides = (results || {}).sides;
  if (!sides) return null;
  let worst = null;
  ["higher", "lower"].forEach((key) => {
    const s = sides[key];
    if (!s || !(s.sd <= -2)) return;
    if (!worst || s.sd < worst.sd) {
      worst = Object.assign({}, s, {
        name: key === "higher" ? "Higher" : "Lower",
        shortfall: s.claimed - s.landed,
      });
    }
  });
  return worst;
}

function legOpen(leg) { return !(leg.status && leg.status !== "open"); }

/* One rule for the green mark, shared by the legs and by the tile that
   counts them, so the tile cannot report four legs clearing the bar
   beside two green ones. A settled leg is history and is judged on what
   happened, the same reason "no view" is withheld once a game is played. */
function clearsBar(leg, doubt) {
  const chance = num(leg.our_probability);
  if (chance == null || !legBar || chance < legBar) return false;
  if (chance < 0.5) return false;
  if (!legOpen(leg)) return true;
  return !(doubt && leg.our_side === doubt.name);
}

/* Said on the leg itself, because the note above the legs is easy to
   scroll past and this number is the one being read. It still says where
   the raw claim sits against the bar: the claim is kept out of the green,
   not hidden. */
function doubtTitle(doubt, aboveBar, barName) {
  return doubt.name + " claims have been landing "
    + (doubt.shortfall * 100).toFixed(0) + " points below what they claimed, "
    + "over " + doubt.settled + " settled legs, so this number is not worth "
    + "what it says. The raw claim is " + (aboveBar ? "above" : "below")
    + " the bar " + barName + " needs.";
}

function buildBoard() {
  const legs = DATA.selections.selections || [];
  /* Underdog's multiplier is NOT fixed by entry size. It varies with the
     picks' own odds, so there is no such thing as "the" bar for a 5-pick,
     and this page used to publish one anyway: 20x for five picks, where a
     real five-pick on 2026-10-29 paid 8.25x. That is a per-leg bar of
     65.6% published as 54.9%.

     So the bar now comes only from a payout somebody actually saw on an
     entry screen, which is what seen_on marks. No sighting, no bar, and
     nothing is marked as clearing one.

     Sightings are kept in a dated log rather than one per entry size, so
     there can be several. The most recent one wins; where two were seen
     on the same day, the STRICTER bar wins, because publishing the softer
     of two payouts somebody really saw would mark legs green that the
     other entry would not support. */
  amberKey(doubtedSide(DATA.results));

  const bar = DATA.selections.entry_bar || [];
  const entryBar_ = bar.filter((b) => b.seen_on).sort((a, b) =>
    String(b.seen_on).localeCompare(String(a.seen_on))
    || num(b.unrelated) - num(a.unrelated))[0] || null;
  legBar = entryBar_ ? num(entryBar_.unrelated) : null;
  entryBar = entryBar_;

  /* Week first, then a game inside it. The board reaches back over played
     weeks now, so without the second row a finished week would be one long
     list of every game at once. */
  const sched = DATA.selections.schedule || [];
  const weeks = [...new Set(
    (sched.length ? sched : legs).map((l) => l.week))]
    .filter((w) => w != null && w !== "")
    .sort((a, b) => Number(a) - Number(b));

  /* Opens on the week still to be played: the earliest holding a game that
     has not kicked off, and the last week otherwise, so a board left
     sitting does not open on a slate that is already over. */
  const today = new Date().toISOString().slice(0, 10);
  const source = sched.length ? sched : legs;
  const upcoming = weeks.find((w) =>
    source.some((g) => String(g.week) === String(w) && g.gameday >= today));
  filter.week = String(upcoming != null ? upcoming : weeks[weeks.length - 1]);

  const chips = $("board-filters");
  weeks.forEach((w) => chipFor(chips, "week", String(w), "Week " + w));
  buildGameChips();

  /* A lookup, not a claim. The multiplier belongs to the entry screen and
     varies with the picks, so the honest thing this page can publish is
     the arithmetic for whatever payout the reader is shown -- with the one
     payout somebody actually saw marked, because a real number is worth
     more than a plausible one. Tiles were the wrong shape for this: four
     of them read as four facts, and these are a table to look yourself up
     in. */
  const barWrap = $("entry-bar");
  barWrap.textContent = "";
  const sizes = [...new Set(bar.map((r) => num(r.legs)))].sort((a, b) => a - b);
  const mults = [...new Set(bar.map((r) => num(r.multiplier)))]
    .sort((a, b) => a - b);
  const at = new Map(bar.map((r) => [num(r.legs) + "@" + num(r.multiplier), r]));

  const table = document.createElement("table");
  table.className = "bar";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>payout</th>"
    + sizes.map((s) => "<th>" + s + " picks</th>").join("") + "</tr>";
  table.appendChild(head);

  const body = document.createElement("tbody");
  mults.forEach((m) => {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = (Math.round(m * 100) / 100) + "x";
    tr.appendChild(label);
    sizes.forEach((s) => {
      const r = at.get(s + "@" + m);
      const td = document.createElement("td");
      td.textContent = r ? (num(r.unrelated) * 100).toFixed(1) + "%" : "–";
      if (r && r.seen_on) {
        td.className = "seen";
        td.title = "Seen on an entry screen on " + r.seen_on
          + ". Stacked, that bar is "
          + (num(r.stacked) * 100).toFixed(1) + "%.";
        tr.classList.add("seen");
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  table.appendChild(body);
  barWrap.appendChild(table);
}

/* The games inside whichever week is selected. Rebuilt whenever the week
   changes, because last week's fixtures are not this week's. */
function buildGameChips() {
  const host = $("board-games");
  if (!host) return;
  host.textContent = "";

  const inWeek = (DATA.selections.selections || [])
    .filter((l) => String(l.week) === String(filter.week));

  /* Every fixture in the week, from the schedule, not only the ones with
     picks against them. A game nobody has priced is still a game, and a
     board that hides it cannot answer "what is on this week". */
  const sched = (DATA.selections.schedule || [])
    .filter((g) => String(g.week) === String(filter.week));
  const games = sched.length
    ? sched.map((g) => [g.game, g.gameday])
    : [...new Map(inWeek.map((l) => [l.game, l.gameday])).entries()]
        .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

  /* Open on a game that actually has picks, rather than on whichever
     fixture happens to kick off first. */
  if (!games.some((g) => g[0] === filter.game)) {
    const priced = games.find((g) => inWeek.some((l) => l.game === g[0]));
    filter.game = priced ? priced[0] : (games.length ? games[0][0] : null);
  }
  games.forEach((pair) => {
    const mine = inWeek.filter((l) => l.game === pair[0]);
    const settled = mine.filter((l) => l.status && l.status !== "open");
    const right = settled.filter((l) => l.status === "right").length;
    let label = pair[0];
    if (settled.length) {
      label += "  " + right + "/"
        + settled.filter((l) => l.status !== "void").length;
    } else if (mine.length) {
      label += "  " + mine.length;
    }
    const chip = chipFor(host, "game", pair[0], label);
    if (!mine.length) chip.classList.add("unpriced");
  });
  drawBoard();
}

function drawTiles(legs) {
  const tiles = $("board-tiles");
  tiles.textContent = "";
  /* Nothing priced: the tiles would otherwise read "Legs 0" beside an
     entry bar for an entry that cannot be built. */
  if (!legs.length) {
    $("board-warning").hidden = true;
    const empty = $("board-side-note");
    if (empty) empty.hidden = true;
    return;
  }
  const sides = new Set(legs.map((l) => l.our_side));
  const priced = legs.filter((l) => num(l.our_probability) != null);
  const doubt = doubtedSide(DATA.results);
  const clearing = priced.filter((l) => clearsBar(l, doubt));
  const noView = priced.filter((l) => num(l.our_probability) < 0.5);
  const settled = legs.filter((l) => l.status === "right" || l.status === "wrong");
  const right = settled.filter((l) => l.status === "right").length;
  const voided = legs.filter((l) => l.status === "void").length;

  tile(tiles, "Legs", legs.length,
    filter.game ? filter.game : "this week");

  /* A played game is judged on what happened; one still ahead is judged on
     what has to be cleared. Showing the entry bar beside a finished game
     would be inviting a bet that can no longer be made. */
  if (settled.length) {
    tile(tiles, "Landed", right + " of " + settled.length,
      voided ? voided + (voided === 1 ? " void" : " voided") : "graded");
    const claimed = settled.reduce((t, l) => t + num(l.our_probability), 0);
    tile(tiles, "Claimed vs actual", right + " vs " + claimed.toFixed(1),
      "the number that matters");
  } else if (entryBar) {
    tile(tiles,
      "A " + entryBar.legs + "-pick at " + num(entryBar.multiplier).toFixed(2)
        + "x needs",
      (num(entryBar.unrelated) * 100).toFixed(1) + "%",
      "stacked " + (num(entryBar.stacked) * 100).toFixed(1) + "%"
        + " · seen " + entryBar.seen_on + ", yours will differ");
    if (priced.length) {
      tile(tiles, "Clear that bar", clearing.length + " of " + priced.length,
        noView.length ? noView.length + " are not calls at all" : "the rest fall short");
    }
  }
  tile(tiles, "Sides", sides.size === 1 ? [...sides][0] + " only" : [...sides].join(" / "),
    sides.size === 1 ? "one-sided, see below" : "both directions");

  const warning = $("board-warning");
  if (legs.length > 1 && sides.size === 1 && !settled.length) {
    warning.hidden = false;
    warning.innerHTML =
      "<strong>Every leg is on the " + [...sides][0].toLowerCase() + ".</strong> " +
      "That is the signature of a model with a lean, not a slate of findings. " +
      "A market is not wrong in one direction on every player at once.";
  } else {
    warning.hidden = true;
  }

  /* The shortfall said once, in full, with the counts behind it. Only
     when a leg on this board is actually on that side, so a week with
     nothing there does not carry a warning about nothing. */
  const sideNote = $("board-side-note");
  if (!sideNote) return;
  const hit = doubt && legs.some((l) => l.our_side === doubt.name && legOpen(l));
  sideNote.hidden = !hit;
  if (!hit) return;
  sideNote.innerHTML =
    "<strong>The " + doubt.name + " claims below are not worth what they "
    + "say.</strong> On the record so far, " + doubt.name + " legs claimed "
    + (doubt.claimed * 100).toFixed(1) + "% and landed "
    + (doubt.landed * 100).toFixed(1) + "% over " + doubt.settled
    + " settled legs, short by " + Math.abs(doubt.sd).toFixed(1)
    + " standard deviations. The model's own number is still what is "
    + "printed, because that is what it says, but no " + doubt.name
    + " leg is marked green for clearing the bar while its side reads like "
    + "that. What the gap is not is a correction to subtract: it is one "
    + "average over every " + doubt.name + " leg, and it is not level "
    + "across the claims it is drawn from.";
}

function chipFor(into, kind, value, label) {
  const b = document.createElement("button");
  b.className = "chip" + (filter[kind] === value ? " on" : "");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => {
    if (filter[kind] === value) return;
    filter[kind] = value;
    refreshChips();
    /* Last week's fixtures are not this week's, so changing the week
       rebuilds the row of games under it rather than leaving a stale one. */
    if (kind === "week") buildGameChips();
    else drawBoard();
  });
  b.dataset.kind = kind;
  b.dataset.value = value;
  into.appendChild(b);
  return b;
}

function refreshChips() {
  document.querySelectorAll("#board-filters .chip, #board-games .chip")
    .forEach((c) => {
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
  if (filter.game != null) {
    legs = legs.filter((l) => l.game === filter.game);
  }

  drawTiles(legs);
  if (!legs.length) {
    drawUnavailable(root);
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

/* A fixture nobody has typed a card for. Said plainly, because the honest
   answer to "what does the model like here" is that nothing has been
   priced yet -- not that there is nothing worth backing. */
function drawUnavailable(root) {
  const box = document.createElement("div");
  box.className = "fixture unavailable";
  const head = document.createElement("div");
  head.className = "head";
  const teams = document.createElement("span");
  teams.className = "teams";
  teams.textContent = filter.game || "This game";
  const when = document.createElement("span");
  when.className = "when";
  const game = (DATA.selections.schedule || [])
    .find((g) => g.game === filter.game
      && String(g.week) === String(filter.week));
  when.textContent = game ? niceDate(game.gameday) : "";
  head.appendChild(teams);
  head.appendChild(when);
  box.appendChild(head);

  const body = document.createElement("div");
  body.className = "unavailable-body";
  const title = document.createElement("div");
  title.className = "unavailable-title";
  title.textContent = "Picks Unavailable";
  const why = document.createElement("div");
  why.className = "unavailable-why";
  why.textContent = game && game.played
    ? "No card was typed in for this game while it was still ahead."
    : "No sportsbook card has been entered for this game yet.";
  body.appendChild(title);
  body.appendChild(why);
  box.appendChild(body);
  root.appendChild(box);
}

function drawWeek(root, games) {
  const doubt = doubtedSide(DATA.results);
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

    /* Weeks played before the badge existed have no team on any leg, and
       an empty column down the side of one of those reads as a mistake
       rather than as alignment. The column is only drawn where at least
       one leg in the game can fill it. */
    const anyTeam = inGame.some((l) => l.team);

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
        /* Where the coaching staff lists him. The carries model uses this;
           the targets model was tested on it and did not improve, so for a
           receiver it is here to be read rather than to be relied on. */
        if (l.depth) {
          const slot = document.createElement("span");
          slot.className = "slot";
          slot.textContent = l.depth;
          slot.title = "Listed " + l.depth + " on the depth chart";
          mkt.appendChild(document.createTextNode(" · "));
          mkt.appendChild(slot);
        }
        /* The team sits in its own fixed-width column down the left of the
           board, so every player name starts at the same place however
           long the abbreviation is. The name, the market and any injury
           note stack beside it. */
        const lines = document.createElement("div");
        lines.className = "lines";
        lines.appendChild(name);
        lines.appendChild(mkt);
        /* The model only uses a binary "on the report or not", and only
           for targets. The words are here because a reader deciding on a
           prop wants more than a flag, and because the back model does not
           use this at all -- the warning has to come from somewhere. */
        if (l.injury) {
          const flag = document.createElement("div");
          flag.className = "injury";
          flag.textContent = l.injury;
          lines.appendChild(flag);
        }
        /* Who he plays for, in his team's colour. The colours arrive
           already lifted to stay readable on this background, so a navy
           like Chicago's is published as a blue you can actually see.
           A leg with no team still gets the column, so the names stay in
           line rather than one of them jumping left. */
        if (anyTeam) {
          const team = document.createElement("span");
          team.className = "team";
          if (l.team) {
            team.textContent = l.team;
            const colour = (DATA.selections.team_colours || {})[l.team];
            if (colour) team.style.color = colour;
          }
          who.appendChild(team);
        }
        who.appendChild(lines);

        /* How it turned out, immediately left of the side it was taken
           on, so the eye reads "this call, this result" in one movement.
           A void gets a dash rather than a tick or a cross: it was neither,
           and a mark either way would be a small lie. */
        let mark = null;
        if (l.status && l.status !== "open") {
          const verdict = document.createElement("div");
          verdict.className = "verdict-mark " + l.status;
          verdict.textContent = l.status === "right" ? "✓"
            : l.status === "wrong" ? "✗" : "–";
          verdict.title = l.status === "right" ? "Landed"
            : l.status === "wrong" ? "Missed"
            : (l.note ? "Void: " + l.note : "Void");
          if (l.actual != null) {
            verdict.title += " — actual " + l.actual;
          }
          mark = verdict;
        }

        const nums = document.createElement("div");
        nums.className = "nums";
        const chance = num(l.our_probability);
        /* The side is picked by disagreeing with Underdog, not by which
           outcome is likelier, so the model can land on a side it expects
           to lose. Printing "Lower 3.5" for a 44% call reads as a
           recommendation it is not, so no side is shown at all. */
        /* Only for a leg still to be played. "No view" exists so a weak
           call is not dressed as a recommendation; once a game is over the
           leg is history, and history should say what was actually graded. */
        const settledLeg = !legOpen(l);
        const noView = !settledLeg && chance != null && chance < 0.5;
        /* The same claim is worth less on the side whose record has
           failed, so it is not dressed the same way. */
        const doubted = !settledLeg && !noView && !!doubt
          && l.our_side === doubt.name;

        const side = document.createElement("div");
        side.className = "side " + (noView ? "noview"
          : (l.our_side === "Higher" ? "up" : "down"));
        side.textContent = noView ? "no view at " + l.underdog_line
          : l.our_side + " " + l.underdog_line;

        const model = document.createElement("div");
        model.className = "model";
        if (chance != null) {
          const pct = document.createElement("span");
          const aboveBar = !noView && legBar && chance >= legBar;
          pct.className = "pct" + (clearsBar(l, doubt) ? " clears" : "")
            + (doubted ? " doubted" : "");
          /* One decimal, to match the bar it is being compared against. A
             leg at 57.70% rounded to "58%" sitting unmarked beside a bar of
             "57.7%" looks like a mistake rather than a near miss. */
          pct.textContent = (chance * 100).toFixed(1) + "%";
          const barName = entryBar
            ? "a " + entryBar.legs + "-pick at "
              + num(entryBar.multiplier).toFixed(2) + "x"
            : "an entry";
          pct.title = noView
            ? "The model gives this side less than an even chance."
            : doubted
              ? doubtTitle(doubt, aboveBar, barName)
              : (aboveBar
                ? "Clears the bar " + barName + " needs."
                : "Below the bar " + barName + " needs.");
          model.appendChild(pct);
          model.appendChild(document.createTextNode(" · "));
        }
        model.appendChild(document.createTextNode("model " + l.model));
        if (l.actual != null) {
          const got = document.createElement("span");
          got.className = "actual";
          got.textContent = " · actual " + l.actual;
          model.appendChild(got);
        }
        nums.appendChild(side);
        nums.appendChild(model);

        row.appendChild(who);
        if (mark) row.appendChild(mark);
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

  sideSplit(r.sides);

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

  populationNote(r.board_population);
}

/* The table above is scored on games chosen partly by how they turned
   out: a receiver's row survives only if he drew two targets, a back's
   only if he took two carries. Those are facts about the game being
   predicted, and nobody has them on Saturday, so the board cannot apply
   either. It uses a floor on its own prediction instead and therefore
   meets a population the table never measured.

   Written from `board_population`, which scores one unchanged fit on
   both pools, so every figure here moves with the data. */
function populationNote(board) {
  const host = $("population-note");
  if (!host) return;
  const order = ["targets", "receptions", "carries"];
  const rows = order.filter((k) => board && board[k] && board[k].exam
    && board[k].board);
  if (!rows.length) { host.hidden = true; return; }
  host.hidden = false;

  const name = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  const moves = rows.map((k) => name(k).toLowerCase() + " "
    + board[k].exam.miss.toFixed(2) + " to " + board[k].board.miss.toFixed(2));

  /* Whichever market the population moves most, rather than the one that
     happened to move most when this was written. */
  const swung = rows.slice().sort((a, b) =>
    Math.abs(board[b].board.lean - board[b].exam.lean)
    - Math.abs(board[a].board.lean - board[a].exam.lean))[0];
  const s = board[swung];
  const asks = (lean) => Math.abs(lean).toFixed(2) + " " + swung
    + (lean > 0 ? " too many" : " too few");

  const floors = [...new Set(rows.map((k) =>
    board[k].floor + " " + board[k].floor_of))];
  const shown = [...new Set(rows.map((k) =>
    board[k].shown_at + " predicted " + board[k].floor_of))];

  /* Whether every miss really does grow is a fact about today's data,
     not a thing to assert once and leave standing. */
  const allWorse = rows.every((k) => board[k].board.miss > board[k].exam.miss);
  const reverses = (s.exam.lean < 0) !== (s.board.lean < 0);

  /* Named by market, since the floors differ: it is the receiver games
     that go quiet, not the board as a whole. */
  const WHOSE = { targets: "receiver", receptions: "receiver",
                  carries: "running back" };
  const quiet = rows.map((k) => ({ k, share: board[k].under_floor }))
    .filter((x) => x.share != null)
    .sort((a, b) => b.share - a.share)[0];

  host.innerHTML =
    "<strong>Those games were chosen partly by how they turned out.</strong> "
    + "A row survives the exam above only if the player reached "
    + floors.join(" or ") + " in the very game being predicted, which "
    + "nobody knows on Saturday. The board cannot wait for it, so it "
    + "shows a player at " + shown.join(" or ") + " and meets a population "
    + "the table never measured. "
    + (allWorse ? "Every miss there is larger" : "The misses there move")
    + " &mdash; " + moves.join(", ") + " &mdash; and the lean "
    + (reverses ? "reverses" : "shifts") + ": on its own exam the model "
    + "asks for " + asks(s.exam.lean) + ", on the board's games "
    + asks(s.board.lean) + "."
    + (quiet
      ? " " + (quiet.share * 100).toFixed(1) + "% of the board's "
        + (WHOSE[quiet.k] || quiet.k) + " games fall under that floor "
        + "and are absent from the "
        + "figures above."
      : "")
    + (board.clean
      ? " " + board.clean + " is the control: its pool has no such filter, "
        + "so its row already describes what the board prices."
      : "")
    + " There is no fix here, only a disclosure. The exam floor is what "
    + "the volume half is fitted on, and lifting it is a change to the "
    + "model rather than to this page.";
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
  const loud = $("method-loud");
  if (loud && r.loud) loud.textContent = loudSentence(r.loud, r.sides);
  methodCounts(r);
  methodMeasurements(r);
}

/* Four claims that were on the page with no measurement behind them: the
   three steadiness correlations, the run-tendency result, the sportsbook
   comparison and the injury lean. Each was re-derived and each is written
   from results.json now, for the same reason as the counts above -- the
   receiver one had been quoting 0.55 since the table was a third smaller. */
function methodMeasurements(r) {
  const one = (id, make) => {
    const el = $(id);
    if (!el) return;
    const text = make();
    if (text) el.textContent = text;
  };

  one("m-steady", () => {
    const s = r.steadiness;
    if (!s || !s.receiver_share || !s.qb_attempts || !s.back_share) return null;
    const two = (c) => c.correlation.toFixed(2);
    return "Share correlates " + two(s.receiver_share)
      + " with his next game, against " + two(s.qb_attempts)
      + " for a quarterback's attempts and " + two(s.back_share)
      + " for a back's share of carries.";
  });

  one("m-tendency", () => {
    const t = r.run_tendency;
    if (!t) return null;
    return "Not a coach's intentions: a team's own run-pass mix over its "
      + "last eight games barely predicts its next, correlating "
      + t.correlation + " across " + t.team_games.toLocaleString()
      + " team-games and missing the real rate by "
      + Math.round(t.typical_miss * 100) + " points of it.";
  });

  one("m-book", () => {
    const b = r.book;
    if (!b || !b.wagers) return null;
    const WORDS = ["no", "one", "two", "three", "four", "five", "six",
                   "seven", "eight", "nine", "ten"];
    const count = WORDS[b.wagers] || b.wagers.toLocaleString();
    const n = count + (b.wagers === 1 ? " pass-attempt wager" : " pass-attempt wagers");
    const graded = b.settled === 0
      ? "and neither has been graded. That is a disagreement about price, not a result."
      : "of which " + b.settled + " have been graded, which is far too few to tell.";
    return "Against a bookmaker's own implied probabilities it has priced "
      + n + ", about " + Math.round(b.points_above_book)
      + " points above the book, " + graded;
  });

  one("m-injury", () => {
    const i = r.injury;
    if (!i || !i.told) return null;
    return "the model asks for about " + i.told.gap.toFixed(2)
      + " of a target more for a player carrying something than for one who "
      + "is not, even after being told he is on the report";
  });
}

/* Row counts the Method prose quotes. Each of these was typed in when it was
   measured and then went stale as the tables grew -- the targets exam was
   claiming 7,105 while the table directly above it printed 7,100. They are
   read from results.json now so the prose cannot drift away from the table
   it sits next to. */
function methodCounts(r) {
  const counts = r.counts || {};
  const targets = (r.markets || []).find((m) => /target/i.test(m.market));
  const cal = (r.markets || []).find((m) => /attempt/i.test(m.market));
  const put = (id, value) => {
    const el = $(id);
    if (el && value != null) el.textContent = Number(value).toLocaleString();
  };
  put("m-quiet-rec", counts.quiet_receiver_games);
  put("m-quiet-back", counts.quiet_back_games);
  put("m-targets-exam", targets && targets.games_tested);
  put("m-cal-cases", cal && cal.calibration
    && cal.calibration.reduce((n, b) => n + b.cases, 0));
}

/* The record on loud disagreements, written out here rather than typed into
   the page. The sentence this replaces said the model was usually the one
   that was wrong when it disagreed loudly with a line, which no measurement
   ever supported and which the record contradicts. A number typed into prose
   is right for a week, so the verdict is derived too, not just the counts. */
function loudSentence(loud, sides) {
  const share = (right, n) => Math.round((100 * right) / n) + "%";
  const seen = "where the model and the line sit " + loud.gap
    + " or more apart it has gone " + loud.loud_right + " from "
    + loud.loud_settled + ", against "
    + share(loud.quiet_right, loud.quiet_settled) + " on the quieter legs";
  const head = !loud.resolves
    ? "And a loud disagreement is so far neither a warning nor a "
      + "recommendation: " + seen + ", on far too few either way to lean on."
    : (loud.loud_right / loud.loud_settled
        > loud.quiet_right / loud.quiet_settled
      ? "And a loud disagreement has turned out to be the model's better "
        + "side rather than its worse: " + seen + "."
      : "And a loud disagreement really is a warning: " + seen + ".");
  return head + sideCaveat(loud, sides);
}

/* A reader who stops here has the one cut of the record that does not
   resolve, and no idea another one does. Both halves are read from the
   data: how much of the failing side each group carries, and whether
   that side is failing by enough to be worth pointing at. */
function sideCaveat(loud, sides) {
  if (loud.loud_higher == null || loud.quiet_higher == null) return "";
  if (!sides || !sides.higher || !sides.lower) return "";
  const worst = sides.higher.sd <= sides.lower.sd ? "higher" : "lower";
  if (Math.abs(sides[worst].sd) < 2) return "";
  const named = worst === "higher" ? "Higher" : "Lower";

  /* loud_higher counts Higher legs, so the Lower count is what is left. */
  const failing = (higherCount, total) =>
    worst === "higher" ? higherCount : total - higherCount;
  const loudFail = failing(loud.loud_higher, loud.loud_settled);
  const quietFail = failing(loud.quiet_higher, loud.quiet_settled);
  const pct = (n, of) => Math.round((100 * n) / of) + "%";

  /* Carrying MORE of the failing side is what says this is not that
     split under another name. Carrying less would say the opposite, so
     the sentence is written both ways. */
  const heavier = loudFail / loud.loud_settled
    > quietFail / loud.quiet_settled;
  return " Loud legs are " + pct(loudFail, loud.loud_settled) + " " + named
    + " against " + pct(quietFail, loud.quiet_settled)
    + " of the quiet ones, so they carry "
    + (heavier
      ? "more of the side the record says is failing, not less: this is "
        + "not that split told again."
      : "less of the side the record says is failing, which means some of "
        + "this may be that split rather than the size of the "
        + "disagreement.")
    + " Either way, the cut that does resolve on this record is which "
    + "side was taken rather than how loudly — it is on the "
    + "Results page, under the record.";
}

/* The sharpest thing the record says, and the one a single tally hides.
   Over the first 350 settled props the Higher legs claimed 65% and landed
   51% while the Lower legs were near enough honest, and that split held in
   every market separately. Written from the data so it keeps tracking. */
function sideSplit(sides) {
  const host = $("side-split");
  if (!host || !sides || !sides.higher || !sides.lower) return;
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const say = (name, s) => name + " legs claimed " + pct(s.claimed)
    + " and landed " + pct(s.landed) + " over " + s.settled + " legs";
  const worse = sides.higher.sd <= sides.lower.sd ? sides.higher : sides.lower;
  const tail = Math.abs(worse.sd) >= 2
    ? " That gap is " + Math.abs(worse.sd).toFixed(1)
      + " standard deviations, so it is not a run of luck."
    : " Neither gap is big enough yet to be worth more than watching.";
  host.textContent = "The claim has not held up the same way on both sides "
    + "of the line: " + say("Higher", sides.higher) + ", while "
    + say("Lower", sides.lower).replace(/^Lower/, "Lower") + "." + tail;
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
    " priced cases. " + sweepCaveat(DATA.results) +
    " And being honest about its own uncertainty would not be an edge "
    + "anyway. A sportsbook is well calibrated too, and charges for the "
    + "privilege. Beating one needs the model to be right where the book "
    + "is wrong, which this has not shown.";
}

/* What this chart can and cannot see.
   It used to end "close enough to take the probabilities at face value",
   which was published next to a record showing one side's claims failing
   by fourteen points. The chart is not wrong; it answers a narrower
   question than its heading suggests. Every line in it is invented and
   placed around the model's OWN number, so a prediction that runs high
   carries its lines up with it and the bands never move. The board faces
   lines set by somebody else, and takes a side BECAUSE it disagrees with
   one -- which is the case this sweep cannot construct. The record can,
   so the caveat points there and repeats what it currently says. */
function sweepCaveat(results) {
  const plain = "Read that narrowly. Every line swept here is invented and "
    + "sits around the model's own number, so a prediction that runs high "
    + "lifts its own lines with it and these bands never notice. The board "
    + "meets lines set by somebody else and takes a side because it "
    + "disagrees with one, which is a case this chart cannot build.";
  const sides = (results || {}).sides;
  if (!sides || !sides.higher || !sides.lower) return plain;
  const worst = sides.higher.sd <= sides.lower.sd ? sides.higher : sides.lower;
  const name = worst === sides.higher ? "Higher" : "Lower";
  if (Math.abs(worst.sd) < 2) {
    return plain + " The record above can, and so far it agrees.";
  }
  const miss = ((worst.claimed - worst.landed) * 100).toFixed(0);
  return plain + " The record above can, and it disagrees: on the " + name
    + " side a claim has been running about " + miss
    + " points higher than it has landed.";
}

function pct(p) { return (p * 100).toFixed(0) + "%"; }
